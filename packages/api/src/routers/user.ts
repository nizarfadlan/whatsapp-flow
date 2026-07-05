import { TRPCError } from "@trpc/server";
import type { createDb } from "@whatsapp-flow/db";
import { account, session, user } from "@whatsapp-flow/db/schema/auth";
import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "../index";

const roleSchema = z.enum(["admin", "member"]);
const listUsersInputSchema = z.object({
	query: z.string().trim().max(160).optional(),
	role: z.enum(["admin", "member", "all"]).default("all"),
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
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function listWhere(input: z.infer<typeof listUsersInputSchema>) {
	const conditions = [];
	if (input.role !== "all") {
		conditions.push(eq(user.role, input.role));
	}
	if (input.query) {
		const pattern = `%${input.query}%`;
		conditions.push(or(ilike(user.name, pattern), ilike(user.email, pattern)));
	}
	return conditions.length > 0 ? and(...conditions) : undefined;
}

async function countAdmins(db: ReturnType<typeof createDb>) {
	const [row] = await db
		.select({ total: count() })
		.from(user)
		.where(eq(user.role, "admin"));
	return Number(row?.total ?? 0);
}

export const userRouter = router({
	list: adminProcedure
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

	updateRole: adminProcedure
		.input(z.object({ userId: z.string().min(1), role: roleSchema }))
		.mutation(async ({ ctx, input }) => {
			const [target] = await ctx.db
				.select()
				.from(user)
				.where(eq(user.id, input.userId))
				.limit(1);

			if (!target) {
				throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
			}
			if (target.id === ctx.session.user.id && input.role === "member") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot demote your own admin account",
				});
			}
			if (target.role === "admin" && input.role === "member") {
				const adminCount = await countAdmins(ctx.db);
				if (adminCount <= 1) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "At least one persisted admin user is required",
					});
				}
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

			return {
				...safeUser(updated),
				isCurrentUser: updated.id === ctx.session.user.id,
			};
		}),

	revokeSessions: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			if (input.userId === ctx.session.user.id) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot revoke your own active sessions here",
				});
			}

			const revoked = await ctx.db
				.delete(session)
				.where(eq(session.userId, input.userId))
				.returning({ id: session.id });

			return { success: true, revoked: revoked.length };
		}),
});
