import { TRPCError } from "@trpc/server";
import { user } from "@whatsapp-flow/db/schema/auth";
import {
	role,
	rolePermission,
	userRoleAssignment,
} from "@whatsapp-flow/db/schema/rbac";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { writeAuditLog } from "../audit-log";
import { permissionProcedure, protectedProcedure, router } from "../index";
import {
	countActiveAdminEquivalentUsers,
	getEffectivePermissions,
	type PermissionKey,
	permissions,
	seedRbac,
} from "../rbac";

const permissionKeys = permissions.map((item) => item.key) as [
	PermissionKey,
	...PermissionKey[],
];
const permissionKeySchema = z.enum(permissionKeys);

const roleInputSchema = z.object({
	key: z
		.string()
		.trim()
		.min(2)
		.max(64)
		.regex(/^[a-z0-9._-]+$/),
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(500).optional(),
});

async function listRoleRows(db: Parameters<typeof seedRbac>[0]) {
	const [roles, mappings] = await Promise.all([
		db.select().from(role).orderBy(asc(role.isSystem), asc(role.name)),
		db
			.select({
				roleId: rolePermission.roleId,
				permissionKey: rolePermission.permissionKey,
			})
			.from(rolePermission),
	]);
	const permissionMap = new Map<string, string[]>();
	for (const item of mappings) {
		const list = permissionMap.get(item.roleId) ?? [];
		list.push(item.permissionKey);
		permissionMap.set(item.roleId, list);
	}
	return roles.map((item) => ({
		...item,
		permissions: permissionMap.get(item.id) ?? [],
	}));
}

async function ensureRoleExists(
	db: Parameters<typeof seedRbac>[0],
	roleId: string,
) {
	const [row] = await db
		.select()
		.from(role)
		.where(eq(role.id, roleId))
		.limit(1);
	if (!row)
		throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
	return row;
}

async function ensureCanRemoveAdminEquivalent(
	db: Parameters<typeof seedRbac>[0],
	roleId: string,
) {
	const [adminPermission] = await db
		.select({ roleId: rolePermission.roleId })
		.from(rolePermission)
		.where(
			and(
				eq(rolePermission.roleId, roleId),
				eq(rolePermission.permissionKey, "roles.manage"),
			),
		)
		.limit(1);
	if (!adminPermission) return;

	const adminCount = await countActiveAdminEquivalentUsers(db);
	const assignedRows = await db
		.select({ userId: userRoleAssignment.userId })
		.from(userRoleAssignment)
		.innerJoin(user, eq(userRoleAssignment.userId, user.id))
		.where(
			and(eq(userRoleAssignment.roleId, roleId), eq(user.status, "active")),
		)
		.groupBy(userRoleAssignment.userId);

	if (adminCount <= assignedRows.length) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "At least one active admin-equivalent user is required",
		});
	}
}

export const rbacRouter = router({
	me: protectedProcedure.query(async ({ ctx }) => {
		const effective = await getEffectivePermissions(ctx.db, ctx.currentUser);
		return {
			permissions: [...effective].sort(),
		};
	}),

	listPermissions: permissionProcedure("roles.read").query(async () => {
		return permissions;
	}),

	listRoles: permissionProcedure("roles.read").query(async ({ ctx }) => {
		await seedRbac(ctx.db);
		return listRoleRows(ctx.db);
	}),

	createRole: permissionProcedure("roles.manage")
		.input(roleInputSchema)
		.mutation(async ({ ctx, input }) => {
			const [created] = await ctx.db
				.insert(role)
				.values({
					id: crypto.randomUUID(),
					key: input.key,
					name: input.name,
					description: input.description ?? null,
					isSystem: false,
				})
				.returning();
			if (!created) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Role was not created",
				});
			}
			await writeAuditLog(ctx, {
				action: "role.created",
				targetType: "role",
				targetId: created.id,
				targetDisplay: created.name,
				after: created,
			});
			return created;
		}),

	updateRole: permissionProcedure("roles.manage")
		.input(
			z
				.object({ roleId: z.string().min(1) })
				.merge(roleInputSchema.omit({ key: true })),
		)
		.mutation(async ({ ctx, input }) => {
			const existing = await ensureRoleExists(ctx.db, input.roleId);
			const [updated] = await ctx.db
				.update(role)
				.set({
					name: input.name,
					description: input.description ?? null,
					updatedAt: new Date(),
				})
				.where(eq(role.id, input.roleId))
				.returning();
			await writeAuditLog(ctx, {
				action: "role.updated",
				targetType: "role",
				targetId: input.roleId,
				targetDisplay: updated?.name ?? existing.name,
				before: existing,
				after: updated,
			});
			return updated;
		}),

	deleteRole: permissionProcedure("roles.manage")
		.input(z.object({ roleId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const existing = await ensureRoleExists(ctx.db, input.roleId);
			if (existing.isSystem) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "System roles cannot be deleted",
				});
			}
			await ensureCanRemoveAdminEquivalent(ctx.db, existing.id);
			await ctx.db.delete(role).where(eq(role.id, existing.id));
			await writeAuditLog(ctx, {
				action: "role.deleted",
				targetType: "role",
				targetId: existing.id,
				targetDisplay: existing.name,
				before: existing,
			});
			return { success: true };
		}),

	setRolePermissions: permissionProcedure("roles.manage")
		.input(
			z.object({
				roleId: z.string().min(1),
				permissions: z.array(permissionKeySchema).default([]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const existing = await ensureRoleExists(ctx.db, input.roleId);
			if (existing.isSystem) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "System role permissions cannot be changed",
				});
			}
			if (!input.permissions.includes("roles.manage")) {
				await ensureCanRemoveAdminEquivalent(ctx.db, existing.id);
			}
			const beforeRows = await ctx.db
				.select({ permissionKey: rolePermission.permissionKey })
				.from(rolePermission)
				.where(eq(rolePermission.roleId, input.roleId));
			await ctx.db
				.delete(rolePermission)
				.where(eq(rolePermission.roleId, input.roleId));
			if (input.permissions.length > 0) {
				await ctx.db
					.insert(rolePermission)
					.values(
						input.permissions.map((permissionKey) => ({
							roleId: input.roleId,
							permissionKey,
						})),
					)
					.onConflictDoNothing();
			}
			await writeAuditLog(ctx, {
				action: "role.permissions_updated",
				targetType: "role",
				targetId: input.roleId,
				targetDisplay: existing.name,
				before: {
					permissions: beforeRows.map((row) => row.permissionKey).sort(),
				},
				after: { permissions: [...input.permissions].sort() },
			});
			return { success: true };
		}),

	assignRoleToUser: permissionProcedure("roles.assign")
		.input(z.object({ userId: z.string().min(1), roleId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const [target] = await ctx.db
				.select({ id: user.id, email: user.email })
				.from(user)
				.where(eq(user.id, input.userId))
				.limit(1);
			if (!target) {
				throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
			}
			const targetRole = await ensureRoleExists(ctx.db, input.roleId);
			await ctx.db
				.insert(userRoleAssignment)
				.values({
					userId: input.userId,
					roleId: input.roleId,
					assignedByUserId: ctx.session.user.id,
				})
				.onConflictDoNothing();
			await writeAuditLog(ctx, {
				action: "role.assigned",
				targetType: "user",
				targetId: target.id,
				targetDisplay: target.email,
				after: { roleId: targetRole.id, roleKey: targetRole.key },
			});
			return { success: true };
		}),

	removeRoleFromUser: permissionProcedure("roles.assign")
		.input(z.object({ userId: z.string().min(1), roleId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			if (input.userId === ctx.session.user.id) {
				await ensureCanRemoveAdminEquivalent(ctx.db, input.roleId);
			}
			const targetRole = await ensureRoleExists(ctx.db, input.roleId);
			await ensureCanRemoveAdminEquivalent(ctx.db, input.roleId);
			await ctx.db
				.delete(userRoleAssignment)
				.where(
					and(
						eq(userRoleAssignment.userId, input.userId),
						eq(userRoleAssignment.roleId, input.roleId),
					),
				);
			await writeAuditLog(ctx, {
				action: "role.removed",
				targetType: "user",
				targetId: input.userId,
				before: { roleId: targetRole.id, roleKey: targetRole.key },
			});
			return { success: true };
		}),

	listUserRoles: permissionProcedure("roles.read")
		.input(z.object({ userIds: z.array(z.string()).max(100) }))
		.query(async ({ ctx, input }) => {
			if (input.userIds.length === 0) return [];
			return ctx.db
				.select({
					userId: userRoleAssignment.userId,
					roleId: role.id,
					roleKey: role.key,
					roleName: role.name,
				})
				.from(userRoleAssignment)
				.innerJoin(role, eq(userRoleAssignment.roleId, role.id))
				.where(inArray(userRoleAssignment.userId, input.userIds));
		}),
});
