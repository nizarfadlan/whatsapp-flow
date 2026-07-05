import { TRPCError } from "@trpc/server";
import type { createDb } from "@whatsapp-flow/db";
import { user } from "@whatsapp-flow/db/schema/auth";
import {
	permission,
	role,
	rolePermission,
	userRoleAssignment,
} from "@whatsapp-flow/db/schema/rbac";
import { env } from "@whatsapp-flow/env/server";
import { and, count, eq, inArray } from "drizzle-orm";
import type { Context } from "./context";

export const permissions = [
	{ key: "users.read", category: "Users", description: "View users" },
	{
		key: "users.manage",
		category: "Users",
		description: "Manage user profiles",
	},
	{
		key: "users.suspend",
		category: "Users",
		description: "Suspend and reactivate users",
	},
	{
		key: "users.revoke_sessions",
		category: "Users",
		description: "Revoke user sessions",
	},
	{ key: "roles.read", category: "Roles", description: "View roles" },
	{ key: "roles.manage", category: "Roles", description: "Manage roles" },
	{
		key: "roles.assign",
		category: "Roles",
		description: "Assign roles to users",
	},
	{ key: "audit.read", category: "Audit", description: "View audit logs" },
	{ key: "audit.export", category: "Audit", description: "Export audit logs" },
	{
		key: "audit.verify",
		category: "Audit",
		description: "Verify audit integrity",
	},
	{ key: "devices.read", category: "Devices", description: "View devices" },
	{ key: "devices.manage", category: "Devices", description: "Manage devices" },
	{
		key: "devices.connect",
		category: "Devices",
		description: "Connect devices",
	},
	{ key: "devices.delete", category: "Devices", description: "Delete devices" },
	{ key: "flows.read", category: "Flows", description: "View flows" },
	{ key: "flows.manage", category: "Flows", description: "Manage flows" },
	{ key: "flows.execute", category: "Flows", description: "Execute flows" },
	{ key: "webhooks.read", category: "Webhooks", description: "View webhooks" },
	{
		key: "webhooks.manage",
		category: "Webhooks",
		description: "Manage webhooks",
	},
	{ key: "inbox.read", category: "Inbox", description: "View inbox" },
	{ key: "inbox.send", category: "Inbox", description: "Send inbox messages" },
	{ key: "inbox.manage", category: "Inbox", description: "Manage inbox" },
	{ key: "settings.read", category: "Settings", description: "View settings" },
	{
		key: "settings.manage",
		category: "Settings",
		description: "Manage settings",
	},
	{ key: "metrics.read", category: "Operations", description: "View metrics" },
	{ key: "jobs.read", category: "Operations", description: "View jobs" },
	{ key: "jobs.manage", category: "Operations", description: "Manage jobs" },
] as const;

export type PermissionKey = (typeof permissions)[number]["key"];

const allPermissionKeys = permissions.map(
	(item) => item.key,
) as PermissionKey[];
const memberPermissionKeys: PermissionKey[] = [
	"devices.read",
	"devices.manage",
	"devices.connect",
	"flows.read",
	"flows.manage",
	"flows.execute",
	"webhooks.read",
	"webhooks.manage",
	"inbox.read",
	"inbox.send",
	"inbox.manage",
	"settings.read",
];
const auditorPermissionKeys: PermissionKey[] = [
	"audit.read",
	"audit.export",
	"audit.verify",
	"users.read",
	"metrics.read",
];
const operatorPermissionKeys: PermissionKey[] = [
	"devices.read",
	"flows.read",
	"webhooks.read",
	"inbox.read",
	"metrics.read",
	"jobs.read",
	"jobs.manage",
];

export const systemRoles = [
	{
		id: "role_admin",
		key: "admin",
		name: "Admin",
		description: "Full administrative access",
		permissions: allPermissionKeys,
	},
	{
		id: "role_member",
		key: "member",
		name: "Member",
		description: "Standard application access",
		permissions: memberPermissionKeys,
	},
	{
		id: "role_auditor",
		key: "auditor",
		name: "Auditor",
		description: "Audit and compliance visibility",
		permissions: auditorPermissionKeys,
	},
	{
		id: "role_operator",
		key: "operator",
		name: "Operator",
		description: "Operational visibility and job management",
		permissions: operatorPermissionKeys,
	},
] as const;

type Database = ReturnType<typeof createDb>;
type CurrentUser = { id: string; email: string; role: "admin" | "member" };

export async function seedRbac(db: Database) {
	await db
		.insert(permission)
		.values([...permissions])
		.onConflictDoUpdate({
			target: permission.key,
			set: {
				description: permission.description,
				category: permission.category,
			},
		});

	for (const item of systemRoles) {
		await db
			.insert(role)
			.values({
				id: item.id,
				key: item.key,
				name: item.name,
				description: item.description,
				isSystem: true,
			})
			.onConflictDoUpdate({
				target: role.key,
				set: {
					name: item.name,
					description: item.description,
					isSystem: true,
					updatedAt: new Date(),
				},
			});
		await db.delete(rolePermission).where(eq(rolePermission.roleId, item.id));
		if (item.permissions.length > 0) {
			await db
				.insert(rolePermission)
				.values(
					item.permissions.map((permissionKey) => ({
						roleId: item.id,
						permissionKey,
					})),
				)
				.onConflictDoNothing();
		}
	}

	await backfillUserRoles(db);
}

export async function backfillUserRoles(db: Database) {
	const rows = await db
		.select({ id: user.id, legacyRole: user.role })
		.from(user);
	for (const row of rows) {
		await db
			.insert(userRoleAssignment)
			.values({
				userId: row.id,
				roleId: row.legacyRole === "admin" ? "role_admin" : "role_member",
			})
			.onConflictDoNothing();
	}
}

export function isBootstrapAdmin(currentUser: Pick<CurrentUser, "email">) {
	const adminEmails = new Set(
		env.ADMIN_EMAILS?.split(",")
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean) ?? [],
	);
	return adminEmails.has(currentUser.email.toLowerCase());
}

export async function getEffectivePermissions(
	db: Database,
	currentUser: CurrentUser,
) {
	if (currentUser.role === "admin" || isBootstrapAdmin(currentUser)) {
		return new Set<PermissionKey>(allPermissionKeys);
	}

	const rows = await db
		.select({ permissionKey: rolePermission.permissionKey })
		.from(userRoleAssignment)
		.innerJoin(role, eq(userRoleAssignment.roleId, role.id))
		.innerJoin(rolePermission, eq(role.id, rolePermission.roleId))
		.where(eq(userRoleAssignment.userId, currentUser.id));

	return new Set(rows.map((row) => row.permissionKey as PermissionKey));
}

export async function hasPermission(
	db: Database,
	currentUser: CurrentUser,
	permissionKey: PermissionKey,
) {
	const effective = await getEffectivePermissions(db, currentUser);
	return effective.has(permissionKey);
}

export async function requirePermission(
	ctx: Context & { currentUser: CurrentUser },
	permissionKey: PermissionKey,
) {
	if (!(await hasPermission(ctx.db, ctx.currentUser, permissionKey))) {
		throw new TRPCError({ code: "FORBIDDEN", message: "Permission required" });
	}
}

export async function countActiveAdminEquivalentUsers(db: Database) {
	const rows = await db
		.select({ userId: userRoleAssignment.userId })
		.from(userRoleAssignment)
		.innerJoin(
			rolePermission,
			eq(userRoleAssignment.roleId, rolePermission.roleId),
		)
		.innerJoin(user, eq(userRoleAssignment.userId, user.id))
		.where(
			and(
				eq(rolePermission.permissionKey, "roles.manage"),
				eq(user.status, "active"),
			),
		)
		.groupBy(userRoleAssignment.userId);
	return rows.length;
}

export async function userHasAnyRole(
	db: Database,
	userId: string,
	roleIds: string[],
) {
	if (roleIds.length === 0) return false;
	const [row] = await db
		.select({ total: count() })
		.from(userRoleAssignment)
		.where(
			and(
				eq(userRoleAssignment.userId, userId),
				inArray(userRoleAssignment.roleId, roleIds),
			),
		)
		.limit(1);
	return Number(row?.total ?? 0) > 0;
}
