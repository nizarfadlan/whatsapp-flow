import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { user } from "@whatsapp-flow/db/schema/auth";
import {
	device,
	deviceAccessGrant,
	flow,
	flowAccessGrant,
} from "@whatsapp-flow/db/schema/device";
import {
	tenant,
	tenantInvitation,
	tenantMember,
} from "@whatsapp-flow/db/schema/tenant";
import { env } from "@whatsapp-flow/env/server";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { writeAuditLog } from "../audit-log";
import { sendInviteEmail } from "../email";
import {
	organizationPermissionProcedure,
	protectedProcedure,
	publicProcedure,
	router,
} from "../index";

const inviteTokenBytes = 32;
const inviteExpiresInMs = 1000 * 60 * 60 * 24 * 7;

function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

function createInviteToken() {
	return randomBytes(inviteTokenBytes).toString("base64url");
}

function hashInviteToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

function createInviteLink(token: string) {
	const baseUrl = env.PUBLIC_BASE_URL ?? env.AUTH_URL;
	return `${baseUrl.replace(/\/$/, "")}/login?invite=${encodeURIComponent(token)}`;
}

async function requireTenantOwner(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	tenantId: string,
	userId: string,
) {
	const [membership] = await db
		.select({ id: tenant.id, name: tenant.name })
		.from(tenantMember)
		.innerJoin(tenant, eq(tenant.id, tenantMember.tenantId))
		.where(
			and(
				eq(tenantMember.tenantId, tenantId),
				eq(tenantMember.userId, userId),
				eq(tenantMember.role, "owner"),
			),
		)
		.limit(1);

	if (!membership) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
	}

	return membership;
}

async function requireActiveTenantMember(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	tenantId: string,
	userId: string,
) {
	const [member] = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: tenantMember.role,
		})
		.from(tenantMember)
		.innerJoin(user, eq(user.id, tenantMember.userId))
		.innerJoin(tenant, eq(tenant.id, tenantMember.tenantId))
		.where(
			and(
				eq(tenantMember.tenantId, tenantId),
				eq(tenantMember.userId, userId),
				eq(tenantMember.status, "active"),
				eq(tenant.status, "active"),
				eq(user.status, "active"),
			),
		)
		.limit(1);

	if (!member) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
	}

	return member;
}

export const tenantRouter = router({
	listMembers: protectedProcedure
		.input(z.object({ tenantId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await requireTenantOwner(ctx.db, input.tenantId, ctx.currentUser.id);
			return ctx.db
				.select({
					id: user.id,
					name: user.name,
					email: user.email,
					image: user.image,
					role: tenantMember.role,
					createdAt: tenantMember.createdAt,
				})
				.from(tenantMember)
				.innerJoin(user, eq(user.id, tenantMember.userId))
				.where(
					and(
						eq(tenantMember.tenantId, input.tenantId),
						eq(user.status, "active"),
					),
				)
				.orderBy(desc(tenantMember.createdAt));
		}),

	createInvite: protectedProcedure
		.input(
			z.object({
				tenantId: z.string().min(1),
				email: z.email(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tenantRecord = await requireTenantOwner(
				ctx.db,
				input.tenantId,
				ctx.currentUser.id,
			);
			const email = normalizeEmail(input.email);
			const [existingMember] = await ctx.db
				.select({ id: user.id })
				.from(tenantMember)
				.innerJoin(user, eq(user.id, tenantMember.userId))
				.where(
					and(eq(tenantMember.tenantId, input.tenantId), eq(user.email, email)),
				)
				.limit(1);
			if (existingMember) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "User is already a tenant member",
				});
			}

			const [existingInvite] = await ctx.db
				.select({ id: tenantInvitation.id })
				.from(tenantInvitation)
				.where(
					and(
						eq(tenantInvitation.tenantId, input.tenantId),
						eq(tenantInvitation.email, email),
						eq(tenantInvitation.status, "pending"),
					),
				)
				.limit(1);
			if (existingInvite) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "A pending invitation already exists for this email",
				});
			}

			const token = createInviteToken();
			const [created] = await ctx.db
				.insert(tenantInvitation)
				.values({
					id: crypto.randomUUID(),
					tenantId: input.tenantId,
					email,
					tokenHash: hashInviteToken(token),
					status: "pending",
					invitedByUserId: ctx.currentUser.id,
					expiresAt: new Date(Date.now() + inviteExpiresInMs),
				})
				.returning();
			if (!created) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Invite was not created",
				});
			}

			const inviteLink = createInviteLink(token);
			const emailResult = await sendInviteEmail(
				{
					to: email,
					inviteLink,
					roleName: `member of ${tenantRecord.name}`,
					expiresAt: created.expiresAt,
					invitedByEmail: ctx.currentUser.email,
				},
				{ db: ctx.db },
			);
			await ctx.db
				.update(tenantInvitation)
				.set({
					emailSentAt: emailResult.sent ? new Date() : null,
					emailError: emailResult.sent ? null : emailResult.error,
					updatedAt: new Date(),
				})
				.where(eq(tenantInvitation.id, created.id));

			await writeAuditLog(ctx, {
				action: "tenant.invited",
				targetType: "tenant_invitation",
				targetId: created.id,
				targetDisplay: email,
				after: { tenantId: input.tenantId, email },
			});

			return {
				id: created.id,
				email: created.email,
				expiresAt: created.expiresAt,
				token,
				inviteLink,
				emailSent: emailResult.sent,
				emailError: emailResult.sent ? null : emailResult.error,
			};
		}),

	listInvites: protectedProcedure
		.input(z.object({ tenantId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await requireTenantOwner(ctx.db, input.tenantId, ctx.currentUser.id);
			return ctx.db
				.select({
					id: tenantInvitation.id,
					email: tenantInvitation.email,
					status: tenantInvitation.status,
					expiresAt: tenantInvitation.expiresAt,
					createdAt: tenantInvitation.createdAt,
					acceptedAt: tenantInvitation.acceptedAt,
					revokedAt: tenantInvitation.revokedAt,
					emailSentAt: tenantInvitation.emailSentAt,
					emailError: tenantInvitation.emailError,
				})
				.from(tenantInvitation)
				.where(eq(tenantInvitation.tenantId, input.tenantId))
				.orderBy(desc(tenantInvitation.createdAt))
				.limit(50);
		}),

	revokeInvite: protectedProcedure
		.input(
			z.object({ tenantId: z.string().min(1), inviteId: z.string().min(1) }),
		)
		.mutation(async ({ ctx, input }) => {
			await requireTenantOwner(ctx.db, input.tenantId, ctx.currentUser.id);
			const [revoked] = await ctx.db
				.update(tenantInvitation)
				.set({
					status: "revoked",
					revokedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(tenantInvitation.id, input.inviteId),
						eq(tenantInvitation.tenantId, input.tenantId),
					),
				)
				.returning();
			if (!revoked) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
			}

			await writeAuditLog(ctx, {
				action: "tenant.invite_revoked",
				targetType: "tenant_invitation",
				targetId: revoked.id,
				targetDisplay: revoked.email,
			});
			return { success: true };
		}),

	getInvite: publicProcedure
		.input(z.object({ token: z.string().min(16) }))
		.query(async ({ ctx, input }) => {
			const [invite] = await ctx.db
				.select({
					expiresAt: tenantInvitation.expiresAt,
					status: tenantInvitation.status,
					revokedAt: tenantInvitation.revokedAt,
				})
				.from(tenantInvitation)
				.where(eq(tenantInvitation.tokenHash, hashInviteToken(input.token)))
				.limit(1);
			if (
				invite?.status !== "pending" ||
				invite.revokedAt ||
				invite.expiresAt < new Date()
			) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
			}

			return { valid: true };
		}),

	acceptInvite: protectedProcedure
		.input(z.object({ token: z.string().min(16) }))
		.mutation(async ({ ctx, input }) => {
			const tokenHash = hashInviteToken(input.token);
			const [invite] = await ctx.db
				.select({
					id: tenantInvitation.id,
					email: tenantInvitation.email,
				})
				.from(tenantInvitation)
				.where(eq(tenantInvitation.tokenHash, tokenHash))
				.limit(1);
			if (!invite) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
			}
			if (
				normalizeEmail(ctx.currentUser.email) !== normalizeEmail(invite.email)
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Invite email does not match the signed-in user",
				});
			}

			const acceptedInvite = await ctx.db.transaction(async (tx) => {
				const acceptedAt = new Date();
				const [acceptedInvite] = await tx
					.update(tenantInvitation)
					.set({
						status: "accepted",
						acceptedByUserId: ctx.currentUser.id,
						acceptedAt,
						updatedAt: acceptedAt,
					})
					.where(
						and(
							eq(tenantInvitation.id, invite.id),
							eq(tenantInvitation.tokenHash, tokenHash),
							eq(tenantInvitation.status, "pending"),
							isNull(tenantInvitation.revokedAt),
							gt(tenantInvitation.expiresAt, acceptedAt),
						),
					)
					.returning({
						id: tenantInvitation.id,
						tenantId: tenantInvitation.tenantId,
					});
				if (!acceptedInvite) return null;

				await tx
					.insert(tenantMember)
					.values({
						tenantId: acceptedInvite.tenantId,
						userId: ctx.currentUser.id,
					})
					.onConflictDoNothing();
				return acceptedInvite;
			});
			if (!acceptedInvite) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
			}

			await writeAuditLog(ctx, {
				action: "tenant.invite_accepted",
				targetType: "tenant_member",
				targetId: ctx.currentUser.id,
				targetDisplay: ctx.currentUser.email,
				after: { tenantId: acceptedInvite.tenantId, role: "member" },
			});
			return { success: true, tenantId: acceptedInvite.tenantId };
		}),

	removeMember: protectedProcedure
		.input(z.object({ tenantId: z.string().min(1), userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireTenantOwner(ctx.db, input.tenantId, ctx.currentUser.id);
			const [target] = await ctx.db
				.select({ id: user.id, email: user.email, role: tenantMember.role })
				.from(tenantMember)
				.innerJoin(user, eq(user.id, tenantMember.userId))
				.where(
					and(
						eq(tenantMember.tenantId, input.tenantId),
						eq(tenantMember.userId, input.userId),
					),
				)
				.limit(1);
			if (!target) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
			}
			if (target.role === "owner") {
				const [ownerCount] = await ctx.db
					.select({ total: count() })
					.from(tenantMember)
					.where(
						and(
							eq(tenantMember.tenantId, input.tenantId),
							eq(tenantMember.role, "owner"),
						),
					)
					.limit(1);
				if (Number(ownerCount?.total ?? 0) <= 1) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "At least one tenant owner is required",
					});
				}
			}

			await ctx.db
				.delete(tenantMember)
				.where(
					and(
						eq(tenantMember.tenantId, input.tenantId),
						eq(tenantMember.userId, input.userId),
					),
				);
			await writeAuditLog(ctx, {
				action: "tenant.member_removed",
				targetType: "tenant_member",
				targetId: target.id,
				targetDisplay: target.email,
				before: { tenantId: input.tenantId, role: target.role },
			});
			return { success: true };
		}),

	listFlowGrants: organizationPermissionProcedure("organization.flows.manage")
		.input(z.object({ tenantId: z.string().min(1), flowId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const [found] = await ctx.db
				.select({ id: flow.id })
				.from(flow)
				.where(
					and(
						eq(flow.id, input.flowId),
						eq(flow.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			if (!found)
				throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
			return ctx.db
				.select({
					userId: flowAccessGrant.userId,
					name: user.name,
					email: user.email,
					image: user.image,
					capability: flowAccessGrant.capability,
					createdAt: flowAccessGrant.createdAt,
					updatedAt: flowAccessGrant.updatedAt,
				})
				.from(flowAccessGrant)
				.innerJoin(user, eq(user.id, flowAccessGrant.userId))
				.where(
					and(
						eq(flowAccessGrant.flowId, found.id),
						eq(flowAccessGrant.tenantId, ctx.organization.id),
						eq(user.status, "active"),
					),
				)
				.orderBy(desc(flowAccessGrant.createdAt));
		}),

	grantFlowAccess: organizationPermissionProcedure("organization.flows.manage")
		.input(
			z.object({
				tenantId: z.string().min(1),
				flowId: z.string().min(1),
				userId: z.string().min(1),
				capability: z.enum(["viewer", "editor"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [found] = await ctx.db
				.select({ id: flow.id })
				.from(flow)
				.where(
					and(
						eq(flow.id, input.flowId),
						eq(flow.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			if (!found)
				throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
			const member = await requireActiveTenantMember(
				ctx.db,
				ctx.organization.id,
				input.userId,
			);
			const [grant] = await ctx.db
				.insert(flowAccessGrant)
				.values({
					id: crypto.randomUUID(),
					flowId: found.id,
					tenantId: ctx.organization.id,
					userId: member.id,
					capability: input.capability,
					grantedByUserId: ctx.currentUser.id,
				})
				.onConflictDoUpdate({
					target: [flowAccessGrant.flowId, flowAccessGrant.userId],
					set: {
						capability: input.capability,
						grantedByUserId: ctx.currentUser.id,
						updatedAt: new Date(),
					},
				})
				.returning();
			if (!grant)
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Flow grant was not created",
				});
			await writeAuditLog(ctx, {
				action: "flow.access_granted",
				targetType: "flow_access_grant",
				targetId: grant.id,
				targetDisplay: member.email,
				after: {
					flowId: found.id,
					tenantId: ctx.organization.id,
					capability: grant.capability,
				},
			});
			return grant;
		}),

	revokeFlowAccess: organizationPermissionProcedure("organization.flows.manage")
		.input(
			z.object({
				tenantId: z.string().min(1),
				flowId: z.string().min(1),
				userId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [found] = await ctx.db
				.select({ id: flow.id })
				.from(flow)
				.where(
					and(
						eq(flow.id, input.flowId),
						eq(flow.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			if (!found)
				throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
			const [revoked] = await ctx.db
				.delete(flowAccessGrant)
				.where(
					and(
						eq(flowAccessGrant.flowId, found.id),
						eq(flowAccessGrant.tenantId, ctx.organization.id),
						eq(flowAccessGrant.userId, input.userId),
					),
				)
				.returning();
			if (!revoked)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Flow grant not found",
				});
			await writeAuditLog(ctx, {
				action: "flow.access_revoked",
				targetType: "flow_access_grant",
				targetId: revoked.id,
				before: {
					flowId: found.id,
					tenantId: ctx.organization.id,
					userId: revoked.userId,
					capability: revoked.capability,
				},
			});
			return { success: true };
		}),

	listDeviceGrants: organizationPermissionProcedure(
		"organization.devices.manage",
	)
		.input(
			z.object({ tenantId: z.string().min(1), deviceId: z.string().min(1) }),
		)
		.query(async ({ ctx, input }) => {
			const [found] = await ctx.db
				.select({ id: device.id })
				.from(device)
				.where(
					and(
						eq(device.id, input.deviceId),
						eq(device.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			if (!found)
				throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
			return ctx.db
				.select({
					userId: deviceAccessGrant.userId,
					name: user.name,
					email: user.email,
					image: user.image,
					capability: deviceAccessGrant.capability,
					createdAt: deviceAccessGrant.createdAt,
					updatedAt: deviceAccessGrant.updatedAt,
				})
				.from(deviceAccessGrant)
				.innerJoin(user, eq(user.id, deviceAccessGrant.userId))
				.where(
					and(
						eq(deviceAccessGrant.deviceId, found.id),
						eq(deviceAccessGrant.tenantId, ctx.organization.id),
						eq(user.status, "active"),
					),
				)
				.orderBy(desc(deviceAccessGrant.createdAt));
		}),

	grantDeviceAccess: organizationPermissionProcedure(
		"organization.devices.manage",
	)
		.input(
			z.object({
				tenantId: z.string().min(1),
				deviceId: z.string().min(1),
				userId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [found] = await ctx.db
				.select({ id: device.id })
				.from(device)
				.where(
					and(
						eq(device.id, input.deviceId),
						eq(device.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			if (!found)
				throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
			const member = await requireActiveTenantMember(
				ctx.db,
				ctx.organization.id,
				input.userId,
			);
			const [grant] = await ctx.db
				.insert(deviceAccessGrant)
				.values({
					id: crypto.randomUUID(),
					deviceId: found.id,
					tenantId: ctx.organization.id,
					userId: member.id,
					capability: "deploy",
					grantedByUserId: ctx.currentUser.id,
				})
				.onConflictDoUpdate({
					target: [deviceAccessGrant.deviceId, deviceAccessGrant.userId],
					set: { grantedByUserId: ctx.currentUser.id, updatedAt: new Date() },
				})
				.returning();
			if (!grant)
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Device grant was not created",
				});
			await writeAuditLog(ctx, {
				action: "device.access_granted",
				targetType: "device_access_grant",
				targetId: grant.id,
				targetDisplay: member.email,
				after: {
					deviceId: found.id,
					tenantId: ctx.organization.id,
					capability: "deploy",
				},
			});
			return grant;
		}),

	revokeDeviceAccess: organizationPermissionProcedure(
		"organization.devices.manage",
	)
		.input(
			z.object({
				tenantId: z.string().min(1),
				deviceId: z.string().min(1),
				userId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [found] = await ctx.db
				.select({ id: device.id })
				.from(device)
				.where(
					and(
						eq(device.id, input.deviceId),
						eq(device.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			if (!found)
				throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
			const [revoked] = await ctx.db
				.delete(deviceAccessGrant)
				.where(
					and(
						eq(deviceAccessGrant.deviceId, found.id),
						eq(deviceAccessGrant.tenantId, ctx.organization.id),
						eq(deviceAccessGrant.userId, input.userId),
					),
				)
				.returning();
			if (!revoked)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Device grant not found",
				});
			await writeAuditLog(ctx, {
				action: "device.access_revoked",
				targetType: "device_access_grant",
				targetId: revoked.id,
				before: {
					deviceId: found.id,
					tenantId: ctx.organization.id,
					userId: revoked.userId,
					capability: revoked.capability,
				},
			});
			return { success: true };
		}),
});
