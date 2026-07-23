import { TRPCError } from "@trpc/server";
import { user } from "@whatsapp-flow/db/schema/auth";
import {
	tenant,
	tenantMember,
	tenantPermission,
	tenantRole,
	tenantRoleAssignment,
	tenantRolePermission,
} from "@whatsapp-flow/db/schema/tenant";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAuditLog } from "../audit-log";
import {
	organizationPermissionProcedure,
	platformAdminProcedure,
	protectedProcedure,
	router,
} from "../index";
import { seedOrganizationRbac } from "../organization-rbac";

const organizationInput = z.object({ tenantId: z.string().min(1) });
const organizationSlugSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(2)
	.max(63)
	.regex(
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
		"Slug must use lowercase letters, numbers, and hyphens",
	);

const assignRolesInput = organizationInput
	.extend({
		userId: z.string().min(1),
		roleIds: z.array(z.string().min(1)).max(20).optional(),
		roleKeys: z.array(z.string().min(1)).max(20).optional(),
	})
	.superRefine((value, ctx) => {
		if ((value.roleIds === undefined) === (value.roleKeys === undefined)) {
			ctx.addIssue({
				code: "custom",
				message: "Provide exactly one of roleIds or roleKeys",
			});
		}
	});

async function listTenantRoles(
	db: Parameters<typeof seedOrganizationRbac>[0],
	tenantId: string,
) {
	const [roles, mappings] = await Promise.all([
		db
			.select({
				id: tenantRole.id,
				key: tenantRole.key,
				name: tenantRole.name,
				description: tenantRole.description,
				isSystem: tenantRole.isSystem,
			})
			.from(tenantRole)
			.where(eq(tenantRole.tenantId, tenantId))
			.orderBy(asc(tenantRole.name)),
		db
			.select({
				roleId: tenantRolePermission.roleId,
				permissionKey: tenantPermission.key,
			})
			.from(tenantRolePermission)
			.innerJoin(
				tenantPermission,
				and(
					eq(tenantPermission.id, tenantRolePermission.permissionId),
					eq(tenantPermission.tenantId, tenantRolePermission.tenantId),
				),
			)
			.where(eq(tenantRolePermission.tenantId, tenantId)),
	]);
	const permissionsByRole = new Map<string, string[]>();
	for (const mapping of mappings) {
		const permissions = permissionsByRole.get(mapping.roleId) ?? [];
		permissions.push(mapping.permissionKey);
		permissionsByRole.set(mapping.roleId, permissions);
	}
	return roles.map((role) => ({
		...role,
		permissions: (permissionsByRole.get(role.id) ?? []).sort(),
	}));
}

export const organizationRouter = router({
	listMine: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select({
				id: tenant.id,
				name: tenant.name,
				slug: tenant.slug,
				status: tenant.status,
				createdAt: tenant.createdAt,
			})
			.from(tenantMember)
			.innerJoin(tenant, eq(tenant.id, tenantMember.tenantId))
			.where(
				and(
					eq(tenantMember.userId, ctx.currentUser.id),
					eq(tenantMember.status, "active"),
					eq(tenant.status, "active"),
				),
			)
			.orderBy(asc(tenant.name));
	}),

	getBySlug: protectedProcedure
		.input(z.object({ slug: organizationSlugSchema }))
		.query(async ({ ctx, input }) => {
			const [organization] = await ctx.db
				.select({
					id: tenant.id,
					name: tenant.name,
					slug: tenant.slug,
					status: tenant.status,
					createdAt: tenant.createdAt,
				})
				.from(tenantMember)
				.innerJoin(tenant, eq(tenant.id, tenantMember.tenantId))
				.where(
					and(
						eq(tenantMember.userId, ctx.currentUser.id),
						eq(tenantMember.status, "active"),
						eq(tenant.status, "active"),
						eq(tenant.slug, input.slug),
					),
				)
				.limit(1);
			if (!organization) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Organization not found",
				});
			}
			return organization;
		}),

	create: platformAdminProcedure
		.input(
			z.object({
				name: z.string().trim().min(1).max(120),
				slug: organizationSlugSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const created = await ctx.db.transaction(async (tx) => {
				const [organization] = await tx
					.insert(tenant)
					.values({
						id: crypto.randomUUID(),
						name: input.name,
						slug: input.slug,
						status: "active",
						createdByUserId: ctx.currentUser.id,
					})
					.returning();
				if (!organization) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Organization was not created",
					});
				}
				await tx.insert(tenantMember).values({
					tenantId: organization.id,
					userId: ctx.currentUser.id,
					role: "owner",
					status: "active",
				});
				const { roleIds } = await seedOrganizationRbac(tx, organization.id);
				const ownerRoleId = roleIds.get("owner");
				if (!ownerRoleId) throw new Error("Owner role was not seeded");
				await tx.insert(tenantRoleAssignment).values({
					tenantId: organization.id,
					userId: ctx.currentUser.id,
					roleId: ownerRoleId,
					assignedByUserId: ctx.currentUser.id,
				});
				await writeAuditLog(
					ctx,
					{
						action: "organization.created",
						targetType: "tenant",
						targetId: organization.id,
						targetDisplay: organization.name,
						after: { slug: organization.slug, status: organization.status },
					},
					tx,
				);
				return organization;
			});
			return created;
		}),

	listMembers: organizationPermissionProcedure("organization.members.read")
		.input(organizationInput)
		.query(async ({ ctx }) => {
			const [members, assignments] = await Promise.all([
				ctx.db
					.select({
						userId: user.id,
						name: user.name,
						email: user.email,
						image: user.image,
						membershipStatus: tenantMember.status,
						legacyRole: tenantMember.role,
						joinedAt: tenantMember.createdAt,
					})
					.from(tenantMember)
					.innerJoin(user, eq(user.id, tenantMember.userId))
					.where(eq(tenantMember.tenantId, ctx.organization.id))
					.orderBy(desc(tenantMember.createdAt)),
				ctx.db
					.select({
						userId: tenantRoleAssignment.userId,
						roleKey: tenantRole.key,
						roleName: tenantRole.name,
					})
					.from(tenantRoleAssignment)
					.innerJoin(
						tenantRole,
						and(
							eq(tenantRole.id, tenantRoleAssignment.roleId),
							eq(tenantRole.tenantId, tenantRoleAssignment.tenantId),
						),
					)
					.where(eq(tenantRoleAssignment.tenantId, ctx.organization.id)),
			]);
			const rolesByUser = new Map<
				string,
				Array<{ key: string; name: string }>
			>();
			for (const assignment of assignments) {
				const roles = rolesByUser.get(assignment.userId) ?? [];
				roles.push({ key: assignment.roleKey, name: assignment.roleName });
				rolesByUser.set(assignment.userId, roles);
			}
			return members.map((member) => ({
				...member,
				roles: (rolesByUser.get(member.userId) ?? []).sort((a, b) =>
					a.key.localeCompare(b.key),
				),
			}));
		}),

	listRoles: organizationPermissionProcedure("organization.roles.read")
		.input(organizationInput)
		.query(async ({ ctx }) => listTenantRoles(ctx.db, ctx.organization.id)),

	assignRoles: organizationPermissionProcedure("organization.roles.assign")
		.input(assignRolesInput)
		.mutation(async ({ ctx, input }) => {
			const requestedValues = [
				...new Set(input.roleIds ?? input.roleKeys ?? []),
			];
			const isRoleIdInput = input.roleIds !== undefined;
			const requestedRoles =
				requestedValues.length === 0
					? []
					: await ctx.db
							.select({
								id: tenantRole.id,
								key: tenantRole.key,
								name: tenantRole.name,
							})
							.from(tenantRole)
							.where(
								and(
									eq(tenantRole.tenantId, ctx.organization.id),
									isRoleIdInput
										? inArray(tenantRole.id, requestedValues)
										: inArray(tenantRole.key, requestedValues),
								),
							);
			if (requestedRoles.length !== requestedValues.length) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Every role must belong to this organization",
				});
			}

			await ctx.db.transaction(async (tx) => {
				await tx.execute(
					sql`select pg_advisory_xact_lock(hashtext(${ctx.organization.id}))`,
				);
				const [member] = await tx
					.select({
						userId: tenantMember.userId,
						email: user.email,
					})
					.from(tenantMember)
					.innerJoin(user, eq(user.id, tenantMember.userId))
					.where(
						and(
							eq(tenantMember.tenantId, ctx.organization.id),
							eq(tenantMember.userId, input.userId),
							eq(tenantMember.status, "active"),
						),
					)
					.limit(1);
				if (!member) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Member not found",
					});
				}

				const existingAssignments = await tx
					.select({
						roleId: tenantRoleAssignment.roleId,
						roleKey: tenantRole.key,
					})
					.from(tenantRoleAssignment)
					.innerJoin(
						tenantRole,
						and(
							eq(tenantRole.id, tenantRoleAssignment.roleId),
							eq(tenantRole.tenantId, tenantRoleAssignment.tenantId),
						),
					)
					.where(
						and(
							eq(tenantRoleAssignment.tenantId, ctx.organization.id),
							eq(tenantRoleAssignment.userId, input.userId),
						),
					);
				const targetHasOwnerRole = existingAssignments.some(
					(assignment) => assignment.roleKey === "owner",
				);
				const requestedOwnerRole = requestedRoles.some(
					(role) => role.key === "owner",
				);
				const changesOwnerRole = targetHasOwnerRole !== requestedOwnerRole;
				if (changesOwnerRole) {
					const [actorOwnerRole] = await tx
						.select({ userId: tenantRoleAssignment.userId })
						.from(tenantRoleAssignment)
						.innerJoin(
							tenantMember,
							and(
								eq(tenantMember.tenantId, tenantRoleAssignment.tenantId),
								eq(tenantMember.userId, tenantRoleAssignment.userId),
								eq(tenantMember.status, "active"),
							),
						)
						.innerJoin(
							tenantRole,
							and(
								eq(tenantRole.id, tenantRoleAssignment.roleId),
								eq(tenantRole.tenantId, tenantRoleAssignment.tenantId),
								eq(tenantRole.key, "owner"),
							),
						)
						.where(
							and(
								eq(tenantRoleAssignment.tenantId, ctx.organization.id),
								eq(tenantRoleAssignment.userId, ctx.currentUser.id),
							),
						)
						.limit(1);
					if (!actorOwnerRole) {
						throw new TRPCError({
							code: "FORBIDDEN",
							message: "Only an active Owner can change the Owner role",
						});
					}
				}

				const removesOwner =
					existingAssignments.some(
						(assignment) => assignment.roleKey === "owner",
					) && !requestedRoles.some((role) => role.key === "owner");
				if (removesOwner) {
					const otherOwners = await tx
						.select({ userId: tenantRoleAssignment.userId })
						.from(tenantRoleAssignment)
						.innerJoin(
							tenantMember,
							and(
								eq(tenantMember.tenantId, tenantRoleAssignment.tenantId),
								eq(tenantMember.userId, tenantRoleAssignment.userId),
								eq(tenantMember.status, "active"),
							),
						)
						.innerJoin(
							tenantRole,
							and(
								eq(tenantRole.id, tenantRoleAssignment.roleId),
								eq(tenantRole.tenantId, tenantRoleAssignment.tenantId),
								eq(tenantRole.key, "owner"),
							),
						)
						.where(eq(tenantRoleAssignment.tenantId, ctx.organization.id));
					if (!otherOwners.some((owner) => owner.userId !== input.userId)) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "At least one assigned Owner role is required",
						});
					}
				}

				await tx
					.delete(tenantRoleAssignment)
					.where(
						and(
							eq(tenantRoleAssignment.tenantId, ctx.organization.id),
							eq(tenantRoleAssignment.userId, input.userId),
						),
					);
				if (requestedRoles.length > 0) {
					await tx.insert(tenantRoleAssignment).values(
						requestedRoles.map((role) => ({
							tenantId: ctx.organization.id,
							userId: member.userId,
							roleId: role.id,
							assignedByUserId: ctx.currentUser.id,
						})),
					);
				}
				await writeAuditLog(
					ctx,
					{
						action: "organization.roles_assigned",
						targetType: "tenant_member",
						targetId: member.userId,
						targetDisplay: member.email,
						before: {
							roles: existingAssignments.map((role) => role.roleKey).sort(),
						},
						after: { roles: requestedRoles.map((role) => role.key).sort() },
						metadata: { tenantId: ctx.organization.id },
					},
					tx,
				);
				return { member, existingAssignments };
			});
			return {
				success: true,
				roles: requestedRoles.map((role) => ({
					key: role.key,
					name: role.name,
				})),
			};
		}),
});
