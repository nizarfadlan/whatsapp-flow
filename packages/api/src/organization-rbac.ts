import type { createDb } from "@whatsapp-flow/db";
import {
	tenant,
	tenantMember,
	tenantPermission,
	tenantRole,
	tenantRoleAssignment,
	tenantRolePermission,
} from "@whatsapp-flow/db/schema/tenant";
import { and, eq } from "drizzle-orm";

export const organizationPermissions = [
	{
		key: "organization.members.read",
		category: "Organization",
		description: "View organization members",
	},
	{
		key: "organization.members.manage",
		category: "Organization",
		description: "Manage organization members",
	},
	{
		key: "organization.roles.read",
		category: "Organization",
		description: "View organization roles",
	},
	{
		key: "organization.roles.assign",
		category: "Organization",
		description: "Assign organization roles",
	},
	{
		key: "organization.flows.read",
		category: "Flows",
		description: "View organization flows",
	},
	{
		key: "organization.flows.manage",
		category: "Flows",
		description: "Manage organization flows",
	},
	{
		key: "organization.flows.execute",
		category: "Flows",
		description: "Execute organization flows",
	},
	{
		key: "organization.devices.read",
		category: "Devices",
		description: "View organization devices",
	},
	{
		key: "organization.devices.manage",
		category: "Devices",
		description: "Manage organization devices",
	},
	{
		key: "organization.devices.connect",
		category: "Devices",
		description: "Connect organization devices",
	},
	{
		key: "organization.audit.read",
		category: "Audit",
		description: "View organization audit activity",
	},
] as const;

export type OrganizationPermissionKey =
	(typeof organizationPermissions)[number]["key"];

type OrganizationRoleDefinition = {
	key: string;
	name: string;
	description: string;
	permissions: readonly OrganizationPermissionKey[];
};

const allOrganizationPermissions = organizationPermissions.map(
	(item) => item.key,
);

export const organizationSystemRoles: readonly OrganizationRoleDefinition[] = [
	{
		key: "owner",
		name: "Owner",
		description: "Full organization administration",
		permissions: allOrganizationPermissions,
	},
	{
		key: "admin",
		name: "Admin",
		description: "Organization administration without ownership",
		permissions: [
			"organization.members.read",
			"organization.members.manage",
			"organization.roles.read",
			"organization.roles.assign",
			"organization.flows.read",
			"organization.flows.manage",
			"organization.flows.execute",
			"organization.devices.read",
			"organization.devices.manage",
			"organization.devices.connect",
			"organization.audit.read",
		],
	},
	{
		key: "operator",
		name: "Operator",
		description: "Operate organization flows and devices",
		permissions: [
			"organization.flows.read",
			"organization.flows.execute",
			"organization.devices.read",
			"organization.devices.connect",
		],
	},
	{
		key: "collaborator",
		name: "Collaborator",
		description: "Create and manage organization flows",
		permissions: [
			"organization.flows.read",
			"organization.flows.manage",
			"organization.flows.execute",
			"organization.devices.read",
		],
	},
	{
		key: "auditor",
		name: "Auditor",
		description: "Read-only organization audit access",
		permissions: [
			"organization.audit.read",
			"organization.flows.read",
			"organization.devices.read",
		],
	},
	{
		key: "viewer",
		name: "Viewer",
		description: "Read-only organization access",
		permissions: ["organization.flows.read", "organization.devices.read"],
	},
];

type Database = ReturnType<typeof createDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type OrganizationRbacDatabase = Database | Transaction;

export async function seedOrganizationRbac(
	db: OrganizationRbacDatabase,
	tenantId: string,
) {
	for (const permission of organizationPermissions) {
		await db
			.insert(tenantPermission)
			.values({
				id: crypto.randomUUID(),
				tenantId,
				...permission,
			})
			.onConflictDoUpdate({
				target: [tenantPermission.tenantId, tenantPermission.key],
				set: {
					description: permission.description,
					category: permission.category,
					updatedAt: new Date(),
				},
			});
	}

	for (const role of organizationSystemRoles) {
		await db
			.insert(tenantRole)
			.values({
				id: crypto.randomUUID(),
				tenantId,
				key: role.key,
				name: role.name,
				description: role.description,
				isSystem: true,
			})
			.onConflictDoUpdate({
				target: [tenantRole.tenantId, tenantRole.key],
				set: {
					name: role.name,
					description: role.description,
					isSystem: true,
					updatedAt: new Date(),
				},
			});
	}

	const [permissionRows, roleRows] = await Promise.all([
		db
			.select({ id: tenantPermission.id, key: tenantPermission.key })
			.from(tenantPermission)
			.where(eq(tenantPermission.tenantId, tenantId)),
		db
			.select({ id: tenantRole.id, key: tenantRole.key })
			.from(tenantRole)
			.where(eq(tenantRole.tenantId, tenantId)),
	]);
	const permissionIds = new Map(
		permissionRows.map((item) => [item.key, item.id]),
	);
	const roleIds = new Map(roleRows.map((item) => [item.key, item.id]));

	for (const role of organizationSystemRoles) {
		const roleId = roleIds.get(role.key);
		if (!roleId)
			throw new Error(`Organization role ${role.key} was not seeded`);
		await db
			.delete(tenantRolePermission)
			.where(
				and(
					eq(tenantRolePermission.tenantId, tenantId),
					eq(tenantRolePermission.roleId, roleId),
				),
			);
		if (role.permissions.length > 0) {
			await db.insert(tenantRolePermission).values(
				role.permissions.map((permissionKey) => {
					const permissionId = permissionIds.get(permissionKey);
					if (!permissionId) {
						throw new Error(
							`Organization permission ${permissionKey} was not seeded`,
						);
					}
					return { tenantId, roleId, permissionId };
				}),
			);
		}
	}

	return { permissionIds, roleIds };
}

export async function backfillOrganizationRbac(db: Database) {
	const tenantIds = await db.select({ tenantId: tenant.id }).from(tenant);

	for (const { tenantId } of tenantIds) {
		const { roleIds } = await seedOrganizationRbac(db, tenantId);
		const members = await db
			.select({ userId: tenantMember.userId, legacyRole: tenantMember.role })
			.from(tenantMember)
			.where(
				and(
					eq(tenantMember.tenantId, tenantId),
					eq(tenantMember.status, "active"),
				),
			);

		const ownerRoleId = roleIds.get("owner");
		const collaboratorRoleId = roleIds.get("collaborator");
		if (!ownerRoleId || !collaboratorRoleId) {
			throw new Error("Organization backfill roles were not seeded");
		}
		if (members.length > 0) {
			await db
				.insert(tenantRoleAssignment)
				.values(
					members.map((member) => ({
						tenantId,
						userId: member.userId,
						roleId:
							member.legacyRole === "owner" ? ownerRoleId : collaboratorRoleId,
					})),
				)
				.onConflictDoNothing();
		}
	}
}
