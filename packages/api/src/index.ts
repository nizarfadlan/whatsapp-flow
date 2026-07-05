import { initTRPC, TRPCError } from "@trpc/server";
import { user } from "@whatsapp-flow/db/schema/auth";
import { env } from "@whatsapp-flow/env/server";
import { eq } from "drizzle-orm";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
	if (!ctx.session) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Authentication required",
			cause: "No session",
		});
	}

	const [currentUser] = await ctx.db
		.select({
			id: user.id,
			email: user.email,
			role: user.role,
			status: user.status,
		})
		.from(user)
		.where(eq(user.id, ctx.session.user.id))
		.limit(1);

	if (!currentUser) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found" });
	}
	if (currentUser.status === "suspended") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Account suspended",
		});
	}

	return next({
		ctx: {
			...ctx,
			session: ctx.session,
			currentUser,
		},
	});
});

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const adminEmails = new Set(
		env.ADMIN_EMAILS?.split(",")
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean) ?? [],
	);
	const isAdmin =
		ctx.currentUser.role === "admin" ||
		adminEmails.has(ctx.currentUser.email.toLowerCase());

	if (!isAdmin) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Admin access required",
		});
	}

	return next({ ctx });
});
