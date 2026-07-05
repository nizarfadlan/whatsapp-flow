import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { createDb } from "@whatsapp-flow/db";
import { account, session, user } from "@whatsapp-flow/db/schema/auth";
import {
	role,
	userInvitation,
	userRoleAssignment,
} from "@whatsapp-flow/db/schema/rbac";
import { env } from "@whatsapp-flow/env/server";
import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { writeAuditLog } from "../audit-log";
import { sendInviteEmail } from "../email";
import {
	permissionProcedure,
	protectedProcedure,
	publicProcedure,
	router,
} from "../index";

const roleSchema = z.enum(["admin", "member"]);
const statusSchema = z.enum(["active", "suspended"]);
const inviteTokenBytes = 32;
const inviteExpiresInMs = 1000 * 60 * 60 * 24 * 7;
const listUsersInputSchema = z.object({
	query: z.string().trim().max(160).optional(),
	role: z.enum(["admin", "member", "all"]).default("all"),
	status: z.enum(["active", "suspended", "all"]).default("all"),
	limit: z.number().int().min(1).max(100).default(25),
	offset: z.number().int().min(0).default(0),
});

function safeUser(row: typeof user.$inferSelect) {
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		emailVerified: row.emailVerified,
		image: row.image,
		role: row.role,
		status: row.status,
		suspendedAt: row.suspendedAt,
		suspendedByUserId: row.suspendedByUserId,
		suspensionReason: row.suspensionReason,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function listWhere(input: z.infer<typeof listUsersInputSchema>) {
	const conditions = [];
	if (input.role !== "all") {
		conditions.push(eq(user.role, input.role));
	}
	if (input.status !== "all") {
		conditions.push(eq(user.status, input.status));
	}
	if (input.query) {
		const pattern = `%${input.query}%`;
		conditions.push(or(ilike(user.name, pattern), ilike(user.email, pattern)));
	}
	return conditions.length > 0 ? and(...conditions) : undefined;
}

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
	const baseUrl = env.PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL;
	return `${baseUrl.replace(/\/$/, "")}/login?invite=${encodeURIComponent(token)}`;
}

async function countActiveAdmins(db: ReturnType<typeof createDb>) {
	const [row] = await db
		.select({ total: count() })
		.from(user)
		.where(and(eq(user.role, "admin"), eq(user.status, "active")))
		.limit(1);
	return Number(row?.total ?? 0);
}

async function getUserOrThrow(db: ReturnType<typeof createDb>, userId: string) {
	const [target] = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (!target) {
		throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
	}
	return target;
}

async function ensureCanRemoveActiveAdmin(
	db: ReturnType<typeof createDb>,
	target: typeof user.$inferSelect,
) {
	if (target.role !== "admin" || target.status !== "active") return;
	const adminCount = await countActiveAdmins(db);
	if (adminCount <= 1) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "At least one active persisted admin user is required",
		});
	}
}

export const userRouter = router({
	getInvite: publicProcedure
		.input(z.object({ token: z.string().min(16) }))
		.query(async ({ ctx, input }) => {
			const [invite] = await ctx.db
				.select({
					id: userInvitation.id,
					email: userInvitation.email,
					status: userInvitation.status,
					expiresAt: userInvitation.expiresAt,
					roleName: role.name,
				})
				.from(userInvitation)
				.innerJoin(role, eq(userInvitation.roleId, role.id))
				.where(eq(userInvitation.tokenHash, hashInviteToken(input.token)))
				.limit(1);

			if (!invite) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
			}
			if (invite.status !== "pending" || invite.expiresAt < new Date()) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invite is no longer valid",
				});
			}

			return {
				email: invite.email,
				roleName: invite.roleName,
				expiresAt: invite.expiresAt,
			};
		}),

	acceptInvite: protectedProcedure
		.input(z.object({ token: z.string().min(16) }))
		.mutation(async ({ ctx, input }) => {
			const tokenHash = hashInviteToken(input.token);
			const [invite] = await ctx.db
				.select({
					id: userInvitation.id,
					email: userInvitation.email,
					roleId: userInvitation.roleId,
					status: userInvitation.status,
					expiresAt: userInvitation.expiresAt,
					roleKey: role.key,
					roleName: role.name,
				})
				.from(userInvitation)
				.innerJoin(role, eq(userInvitation.roleId, role.id))
				.where(eq(userInvitation.tokenHash, tokenHash))
				.limit(1);

			if (!invite) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
			}
			if (invite.status !== "pending" || invite.expiresAt < new Date()) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invite is no longer valid",
				});
			}
			if (
				normalizeEmail(ctx.currentUser.email) !== normalizeEmail(invite.email)
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Invite email does not match the signed-in user",
				});
			}

			await ctx.db
				.insert(userRoleAssignment)
				.values({
					userId: ctx.currentUser.id,
					roleId: invite.roleId,
					assignedByUserId: null,
				})
				.onConflictDoNothing();
			if (invite.roleKey === "admin" || invite.roleKey === "member") {
				await ctx.db
					.update(user)
					.set({ role: invite.roleKey, updatedAt: new Date() })
					.where(eq(user.id, ctx.currentUser.id));
			}
			await ctx.db
				.update(userInvitation)
				.set({
					status: "accepted",
					acceptedByUserId: ctx.currentUser.id,
					acceptedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(userInvitation.id, invite.id));

			await writeAuditLog(ctx, {
				action: "user.invite_accepted",
				targetType: "user",
				targetId: ctx.currentUser.id,
				targetDisplay: ctx.currentUser.email,
				after: { roleId: invite.roleId, roleName: invite.roleName },
			});

			return { success: true };
		}),

	createInvite: permissionProcedure("users.manage")
		.input(
			z.object({
				email: z.email(),
				roleId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const email = normalizeEmail(input.email);
			const [existingUser] = await ctx.db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.email, email))
				.limit(1);
			if (existingUser) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "A user with this email already exists",
				});
			}

			const [targetRole] = await ctx.db
				.select({ id: role.id, key: role.key, name: role.name })
				.from(role)
				.where(eq(role.id, input.roleId))
				.limit(1);
			if (!targetRole) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
			}

			const token = createInviteToken();
			const [created] = await ctx.db
				.insert(userInvitation)
				.values({
					id: crypto.randomUUID(),
					email,
					roleId: targetRole.id,
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
					roleName: targetRole.name,
					expiresAt: created.expiresAt,
					invitedByEmail: ctx.currentUser.email,
				},
				{ db: ctx.db },
			);
			await ctx.db
				.update(userInvitation)
				.set({
					emailSentAt: emailResult.sent ? new Date() : null,
					emailError: emailResult.sent ? null : emailResult.error,
					updatedAt: new Date(),
				})
				.where(eq(userInvitation.id, created.id));

			await writeAuditLog(ctx, {
				action: "user.invited",
				targetType: "user_invitation",
				targetId: created.id,
				targetDisplay: email,
				after: { email, roleId: targetRole.id, roleKey: targetRole.key },
			});

			return {
				id: created.id,
				email: created.email,
				roleId: created.roleId,
				roleName: targetRole.name,
				expiresAt: created.expiresAt,
				token,
				inviteLink,
				emailSent: emailResult.sent,
				emailError: emailResult.sent ? null : emailResult.error,
			};
		}),

	listInvites: permissionProcedure("users.read").query(async ({ ctx }) => {
		return ctx.db
			.select({
				id: userInvitation.id,
				email: userInvitation.email,
				status: userInvitation.status,
				expiresAt: userInvitation.expiresAt,
				createdAt: userInvitation.createdAt,
				acceptedAt: userInvitation.acceptedAt,
				revokedAt: userInvitation.revokedAt,
				emailSentAt: userInvitation.emailSentAt,
				emailError: userInvitation.emailError,
				roleName: role.name,
			})
			.from(userInvitation)
			.innerJoin(role, eq(userInvitation.roleId, role.id))
			.orderBy(desc(userInvitation.createdAt))
			.limit(50);
	}),

	revokeInvite: permissionProcedure("users.manage")
		.input(z.object({ inviteId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const [revoked] = await ctx.db
				.update(userInvitation)
				.set({
					status: "revoked",
					revokedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(userInvitation.id, input.inviteId))
				.returning();
			if (!revoked) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
			}
			await writeAuditLog(ctx, {
				action: "user.invite_revoked",
				targetType: "user_invitation",
				targetId: revoked.id,
				targetDisplay: revoked.email,
			});
			return { success: true };
		}),

	list: permissionProcedure("users.read")
		.input(listUsersInputSchema)
		.query(async ({ ctx, input }) => {
			const where = listWhere(input);
			const [totalRow, rows] = await Promise.all([
				ctx.db.select({ total: count() }).from(user).where(where),
				ctx.db
					.select()
					.from(user)
					.where(where)
					.orderBy(desc(user.createdAt))
					.limit(input.limit)
					.offset(input.offset),
			]);
			const ids = rows.map((row) => row.id);
			const sessionCounts = new Map<string, number>();
			const accountCounts = new Map<string, number>();

			if (ids.length > 0) {
				const [sessionRows, accountRows] = await Promise.all([
					ctx.db
						.select({ userId: session.userId, total: count() })
						.from(session)
						.where(inArray(session.userId, ids))
						.groupBy(session.userId),
					ctx.db
						.select({ userId: account.userId, total: count() })
						.from(account)
						.where(inArray(account.userId, ids))
						.groupBy(account.userId),
				]);
				for (const row of sessionRows) {
					sessionCounts.set(row.userId, Number(row.total));
				}
				for (const row of accountRows) {
					accountCounts.set(row.userId, Number(row.total));
				}
			}

			return {
				users: rows.map((row) => ({
					...safeUser(row),
					sessionCount: sessionCounts.get(row.id) ?? 0,
					accountCount: accountCounts.get(row.id) ?? 0,
					isCurrentUser: row.id === ctx.session.user.id,
				})),
				total: Number(totalRow[0]?.total ?? 0),
			};
		}),

	updateRole: permissionProcedure("roles.assign")
		.input(z.object({ userId: z.string().min(1), role: roleSchema }))
		.mutation(async ({ ctx, input }) => {
			const target = await getUserOrThrow(ctx.db, input.userId);

			if (target.id === ctx.session.user.id && input.role === "member") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot demote your own admin account",
				});
			}
			if (target.role === "admin" && input.role === "member") {
				await ensureCanRemoveActiveAdmin(ctx.db, target);
			}

			const [updated] = await ctx.db
				.update(user)
				.set({ role: input.role, updatedAt: new Date() })
				.where(eq(user.id, input.userId))
				.returning();

			if (!updated) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "User role was not updated",
				});
			}

			await ctx.db
				.delete(userRoleAssignment)
				.where(
					and(
						eq(userRoleAssignment.userId, updated.id),
						inArray(userRoleAssignment.roleId, ["role_admin", "role_member"]),
					),
				);
			await ctx.db
				.insert(userRoleAssignment)
				.values({
					userId: updated.id,
					roleId: updated.role === "admin" ? "role_admin" : "role_member",
					assignedByUserId: ctx.session.user.id,
				})
				.onConflictDoNothing();

			await writeAuditLog(ctx, {
				action: "user.role_updated",
				targetType: "user",
				targetId: updated.id,
				targetDisplay: updated.email,
				before: { role: target.role },
				after: { role: updated.role },
			});

			return {
				...safeUser(updated),
				isCurrentUser: updated.id === ctx.session.user.id,
			};
		}),

	revokeSessions: permissionProcedure("users.revoke_sessions")
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			if (input.userId === ctx.session.user.id) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot revoke your own active sessions here",
				});
			}
			const target = await getUserOrThrow(ctx.db, input.userId);
			const revoked = await ctx.db
				.delete(session)
				.where(eq(session.userId, input.userId))
				.returning({ id: session.id });

			await writeAuditLog(ctx, {
				action: "user.sessions_revoked",
				targetType: "user",
				targetId: target.id,
				targetDisplay: target.email,
				metadata: { revoked: revoked.length },
			});

			return { success: true, revoked: revoked.length };
		}),

	suspend: permissionProcedure("users.suspend")
		.input(
			z.object({
				userId: z.string().min(1),
				reason: z.string().trim().min(1).max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.userId === ctx.session.user.id) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot suspend your own account",
				});
			}
			const target = await getUserOrThrow(ctx.db, input.userId);
			await ensureCanRemoveActiveAdmin(ctx.db, target);

			const now = new Date();
			const [updated] = await ctx.db
				.update(user)
				.set({
					status: statusSchema.parse("suspended"),
					suspendedAt: now,
					suspendedByUserId: ctx.session.user.id,
					suspensionReason: input.reason,
					updatedAt: now,
				})
				.where(eq(user.id, input.userId))
				.returning();
			const revoked = await ctx.db
				.delete(session)
				.where(eq(session.userId, input.userId))
				.returning({ id: session.id });

			if (!updated) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "User was not suspended",
				});
			}

			await writeAuditLog(ctx, {
				action: "user.suspended",
				targetType: "user",
				targetId: updated.id,
				targetDisplay: updated.email,
				before: { status: target.status },
				after: {
					status: updated.status,
					suspendedAt: updated.suspendedAt,
					suspendedByUserId: updated.suspendedByUserId,
				},
				reason: input.reason,
				metadata: { revoked: revoked.length },
			});

			return { ...safeUser(updated), revoked: revoked.length };
		}),

	reactivate: permissionProcedure("users.suspend")
		.input(
			z.object({
				userId: z.string().min(1),
				reason: z.string().trim().max(500).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const target = await getUserOrThrow(ctx.db, input.userId);
			const [updated] = await ctx.db
				.update(user)
				.set({
					status: "active",
					suspendedAt: null,
					suspendedByUserId: null,
					suspensionReason: null,
					updatedAt: new Date(),
				})
				.where(eq(user.id, input.userId))
				.returning();

			if (!updated) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "User was not reactivated",
				});
			}

			await writeAuditLog(ctx, {
				action: "user.reactivated",
				targetType: "user",
				targetId: updated.id,
				targetDisplay: updated.email,
				before: {
					status: target.status,
					suspendedAt: target.suspendedAt,
					suspensionReason: target.suspensionReason,
				},
				after: { status: updated.status },
				reason: input.reason,
			});

			return safeUser(updated);
		}),
});
