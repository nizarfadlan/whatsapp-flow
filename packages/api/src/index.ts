import { initTRPC, TRPCError } from "@trpc/server";
import { user } from "@whatsapp-flow/db/schema/auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
	type OrganizationPermissionKey,
	requireActiveOrganizationMembership,
	requireOrganizationPermission,
} from "./authorization/organization";
import type { Context } from "./context";
import { hasPermission, type PermissionKey } from "./rbac";

export type PlatformPermissionKey = PermissionKey;

export const t = initTRPC.context<Context>().create({
	errorFormatter({ shape, error }) {
		if (error.code !== "INTERNAL_SERVER_ERROR") return shape;

		const { stack: _stack, ...data } = shape.data;
		return {
			...shape,
			message: "Internal server error",
			data,
		};
	},
});

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

const organizationInput = z.object({ tenantId: z.string() }).passthrough();

export const organizationProcedure = protectedProcedure
	.input(organizationInput)
	.use(async ({ ctx, input, next }) => {
		const membership = await requireActiveOrganizationMembership(
			ctx.db,
			input.tenantId,
			ctx.currentUser.id,
		);

		return next({
			ctx: {
				...ctx,
				organization: membership.organization,
				organizationMembership: membership,
			},
		});
	});

export function organizationPermissionProcedure(
	permissionKey: OrganizationPermissionKey,
) {
	return organizationProcedure.use(async ({ ctx, next }) => {
		await requireOrganizationPermission(
			ctx.db,
			ctx.organization.id,
			ctx.currentUser.id,
			permissionKey,
		);

		return next({ ctx });
	});
}

export function platformPermissionProcedure(
	permissionKey: PlatformPermissionKey,
) {
	return protectedProcedure.use(async ({ ctx, next }) => {
		if (!(await hasPermission(ctx.db, ctx.currentUser, permissionKey))) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Permission required",
			});
		}

		return next({ ctx });
	});
}

export const permissionProcedure = platformPermissionProcedure;

export const platformAdminProcedure =
	platformPermissionProcedure("roles.manage");

// Compatibility alias for platform-level administration procedures.
export const adminProcedure = platformAdminProcedure;
