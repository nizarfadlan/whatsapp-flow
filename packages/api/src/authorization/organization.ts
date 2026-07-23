import { TRPCError } from "@trpc/server";
import {
	tenant,
	tenantMember,
	tenantPermission,
	tenantRole,
	tenantRoleAssignment,
	tenantRolePermission,
} from "@whatsapp-flow/db/schema/tenant";
import { and, eq } from "drizzle-orm";

type Database = ReturnType<typeof import("@whatsapp-flow/db").createDb>;

export type OrganizationPermissionKey = string;

export async function getActiveOrganizationMembership(
	db: Database,
	tenantId: string,
	userId: string,
) {
	const [membership] = await db
		.select({
			tenantId: tenantMember.tenantId,
			userId: tenantMember.userId,
			role: tenantMember.role,
			organization: {
				id: tenant.id,
				name: tenant.name,
				slug: tenant.slug,
				status: tenant.status,
			},
		})
		.from(tenantMember)
		.innerJoin(tenant, eq(tenant.id, tenantMember.tenantId))
		.where(
			and(
				eq(tenantMember.tenantId, tenantId),
				eq(tenantMember.userId, userId),
				eq(tenantMember.status, "active"),
				eq(tenant.status, "active"),
			),
		)
		.limit(1);

	return membership ?? null;
}

export async function requireActiveOrganizationMembership(
	db: Database,
	tenantId: string,
	userId: string,
) {
	const membership = await getActiveOrganizationMembership(
		db,
		tenantId,
		userId,
	);
	if (!membership) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
	}

	return membership;
}

export async function hasOrganizationPermission(
	db: Database,
	tenantId: string,
	userId: string,
	permissionKey: OrganizationPermissionKey,
) {
	const [permission] = await db
		.select({ key: tenantPermission.key })
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
			tenant,
			and(
				eq(tenant.id, tenantRoleAssignment.tenantId),
				eq(tenant.status, "active"),
			),
		)
		.innerJoin(
			tenantRole,
			and(
				eq(tenantRole.id, tenantRoleAssignment.roleId),
				eq(tenantRole.tenantId, tenantRoleAssignment.tenantId),
			),
		)
		.innerJoin(
			tenantRolePermission,
			and(
				eq(tenantRolePermission.tenantId, tenantRoleAssignment.tenantId),
				eq(tenantRolePermission.roleId, tenantRole.id),
			),
		)
		.innerJoin(
			tenantPermission,
			and(
				eq(tenantPermission.id, tenantRolePermission.permissionId),
				eq(tenantPermission.tenantId, tenantRoleAssignment.tenantId),
			),
		)
		.where(
			and(
				eq(tenantRoleAssignment.tenantId, tenantId),
				eq(tenantRoleAssignment.userId, userId),
				eq(tenantPermission.key, permissionKey),
			),
		)
		.limit(1);

	return Boolean(permission);
}

export async function requireOrganizationPermission(
	db: Database,
	tenantId: string,
	userId: string,
	permissionKey: OrganizationPermissionKey,
) {
	await requireActiveOrganizationMembership(db, tenantId, userId);
	if (!(await hasOrganizationPermission(db, tenantId, userId, permissionKey))) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Organization permission required",
		});
	}
}
