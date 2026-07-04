import { initTRPC, TRPCError } from "@trpc/server";
import { user } from "@whatsapp-flow/db/schema/auth";
import { env } from "@whatsapp-flow/env/server";
import { eq } from "drizzle-orm";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Authentication required",
			cause: "No session",
		});
	}
	return next({
		ctx: {
			...ctx,
			session: ctx.session,
		},
	});
});

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const [currentUser] = await ctx.db
		.select({ email: user.email, role: user.role })
		.from(user)
		.where(eq(user.id, ctx.session.user.id))
		.limit(1);
	const adminEmails = new Set(
		env.ADMIN_EMAILS?.split(",")
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean) ?? [],
	);
	const isAdmin =
		currentUser?.role === "admin" ||
		(currentUser?.email
			? adminEmails.has(currentUser.email.toLowerCase())
			: false);

	if (!isAdmin) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Admin access required",
		});
	}

	return next({ ctx });
});
