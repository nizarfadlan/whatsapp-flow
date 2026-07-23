import { relations } from "drizzle-orm";
import {
	boolean,
	foreignKey,
	index,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const tenantStatusEnum = pgEnum("tenant_status", ["active", "archived"]);

export const tenantMemberRoleEnum = pgEnum("tenant_member_role", [
	"owner",
	"member",
]);

export const tenantMemberStatusEnum = pgEnum("tenant_member_status", [
	"active",
	"suspended",
	"removed",
]);

export const tenantMemberSourceEnum = pgEnum("tenant_member_source", [
	"legacy",
	"manual",
	"invite",
	"oidc_jit",
]);

export const tenant = pgTable(
	"tenant",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").unique(),
		status: tenantStatusEnum("status").default("active").notNull(),
		archivedAt: timestamp("archived_at"),
		archivedByUserId: text("archived_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("tenant_created_by_user_idx").on(table.createdByUserId),
		index("tenant_status_idx").on(table.status),
	],
);

export const tenantMember = pgTable(
	"tenant_member",
	{
		tenantId: text("tenant_id")
			.notNull()
			.references(() => tenant.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: tenantMemberRoleEnum("role").default("member").notNull(),
		status: tenantMemberStatusEnum("status").default("active").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("tenant_member_tenant_user_unique_idx").on(
			table.tenantId,
			table.userId,
		),
		index("tenant_member_user_tenant_idx").on(table.userId, table.tenantId),
		index("tenant_member_tenant_status_idx").on(table.tenantId, table.status),
	],
);

export const tenantMemberProvenance = pgTable(
	"tenant_member_provenance",
	{
		tenantId: text("tenant_id")
			.notNull()
			.references(() => tenant.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		source: tenantMemberSourceEnum("source").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.tenantId, table.userId, table.source] }),
		foreignKey({
			name: "tenant_member_provenance_member_fk",
			columns: [table.tenantId, table.userId],
			foreignColumns: [tenantMember.tenantId, tenantMember.userId],
		}).onDelete("cascade"),
		index("tenant_member_provenance_user_tenant_idx").on(
			table.userId,
			table.tenantId,
		),
	],
);

export const tenantRole = pgTable(
	"tenant_role",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id")
			.notNull()
			.references(() => tenant.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		isSystem: boolean("is_system").default(false).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("tenant_role_tenant_key_unique_idx").on(
			table.tenantId,
			table.key,
		),
		uniqueIndex("tenant_role_id_tenant_unique_idx").on(
			table.id,
			table.tenantId,
		),
		index("tenant_role_tenant_idx").on(table.tenantId),
	],
);

export const tenantPermission = pgTable(
	"tenant_permission",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id")
			.notNull()
			.references(() => tenant.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		description: text("description").notNull(),
		category: text("category").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("tenant_permission_tenant_key_unique_idx").on(
			table.tenantId,
			table.key,
		),
		uniqueIndex("tenant_permission_id_tenant_unique_idx").on(
			table.id,
			table.tenantId,
		),
		index("tenant_permission_tenant_category_idx").on(
			table.tenantId,
			table.category,
		),
	],
);

export const tenantRolePermission = pgTable(
	"tenant_role_permission",
	{
		tenantId: text("tenant_id")
			.notNull()
			.references(() => tenant.id, { onDelete: "cascade" }),
		roleId: text("role_id").notNull(),
		permissionId: text("permission_id").notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.tenantId, table.roleId, table.permissionId],
		}),
		foreignKey({
			name: "tenant_role_permission_role_fk",
			columns: [table.roleId, table.tenantId],
			foreignColumns: [tenantRole.id, tenantRole.tenantId],
		}).onDelete("cascade"),
		foreignKey({
			name: "tenant_role_permission_permission_fk",
			columns: [table.permissionId, table.tenantId],
			foreignColumns: [tenantPermission.id, tenantPermission.tenantId],
		}).onDelete("cascade"),
		index("tenant_role_permission_permission_idx").on(
			table.tenantId,
			table.permissionId,
		),
	],
);

export const tenantRoleAssignment = pgTable(
	"tenant_role_assignment",
	{
		tenantId: text("tenant_id")
			.notNull()
			.references(() => tenant.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		roleId: text("role_id").notNull(),
		assignedByUserId: text("assigned_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		assignedAt: timestamp("assigned_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.tenantId, table.userId, table.roleId] }),
		foreignKey({
			name: "tenant_role_assignment_member_fk",
			columns: [table.tenantId, table.userId],
			foreignColumns: [tenantMember.tenantId, tenantMember.userId],
		}).onDelete("cascade"),
		foreignKey({
			name: "tenant_role_assignment_role_fk",
			columns: [table.roleId, table.tenantId],
			foreignColumns: [tenantRole.id, tenantRole.tenantId],
		}).onDelete("cascade"),
		index("tenant_role_assignment_role_idx").on(table.tenantId, table.roleId),
		index("tenant_role_assignment_user_tenant_idx").on(
			table.userId,
			table.tenantId,
		),
	],
);

export const tenantInvitation = pgTable(
	"tenant_invitation",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id")
			.notNull()
			.references(() => tenant.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		status: text("status").default("pending").notNull(),
		invitedByUserId: text("invited_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		acceptedByUserId: text("accepted_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		expiresAt: timestamp("expires_at").notNull(),
		acceptedAt: timestamp("accepted_at"),
		revokedAt: timestamp("revoked_at"),
		emailSentAt: timestamp("email_sent_at"),
		emailError: text("email_error"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("tenant_invitation_tenant_status_idx").on(
			table.tenantId,
			table.status,
		),
		index("tenant_invitation_email_idx").on(table.email),
	],
);

export const tenantInvitationRelations = relations(
	tenantInvitation,
	({ one }) => ({
		tenant: one(tenant, {
			fields: [tenantInvitation.tenantId],
			references: [tenant.id],
		}),
		invitedBy: one(user, {
			fields: [tenantInvitation.invitedByUserId],
			references: [user.id],
		}),
		acceptedBy: one(user, {
			fields: [tenantInvitation.acceptedByUserId],
			references: [user.id],
		}),
	}),
);

export const tenantRelations = relations(tenant, ({ many, one }) => ({
	createdBy: one(user, {
		fields: [tenant.createdByUserId],
		references: [user.id],
	}),
	archivedBy: one(user, {
		fields: [tenant.archivedByUserId],
		references: [user.id],
	}),
	members: many(tenantMember),
	invitations: many(tenantInvitation),
	roles: many(tenantRole),
	permissions: many(tenantPermission),
}));

export const tenantMemberRelations = relations(
	tenantMember,
	({ many, one }) => ({
		tenant: one(tenant, {
			fields: [tenantMember.tenantId],
			references: [tenant.id],
		}),
		user: one(user, {
			fields: [tenantMember.userId],
			references: [user.id],
		}),
		provenance: many(tenantMemberProvenance),
		roleAssignments: many(tenantRoleAssignment),
	}),
);

export const tenantMemberProvenanceRelations = relations(
	tenantMemberProvenance,
	({ one }) => ({
		tenant: one(tenant, {
			fields: [tenantMemberProvenance.tenantId],
			references: [tenant.id],
		}),
		member: one(tenantMember, {
			fields: [tenantMemberProvenance.tenantId, tenantMemberProvenance.userId],
			references: [tenantMember.tenantId, tenantMember.userId],
		}),
	}),
);

export const tenantRoleRelations = relations(tenantRole, ({ many, one }) => ({
	tenant: one(tenant, {
		fields: [tenantRole.tenantId],
		references: [tenant.id],
	}),
	permissions: many(tenantRolePermission),
	assignments: many(tenantRoleAssignment),
}));

export const tenantPermissionRelations = relations(
	tenantPermission,
	({ many, one }) => ({
		tenant: one(tenant, {
			fields: [tenantPermission.tenantId],
			references: [tenant.id],
		}),
		roles: many(tenantRolePermission),
	}),
);

export const tenantRolePermissionRelations = relations(
	tenantRolePermission,
	({ one }) => ({
		tenant: one(tenant, {
			fields: [tenantRolePermission.tenantId],
			references: [tenant.id],
		}),
		role: one(tenantRole, {
			fields: [tenantRolePermission.roleId, tenantRolePermission.tenantId],
			references: [tenantRole.id, tenantRole.tenantId],
		}),
		permission: one(tenantPermission, {
			fields: [
				tenantRolePermission.permissionId,
				tenantRolePermission.tenantId,
			],
			references: [tenantPermission.id, tenantPermission.tenantId],
		}),
	}),
);

export const tenantRoleAssignmentRelations = relations(
	tenantRoleAssignment,
	({ one }) => ({
		tenant: one(tenant, {
			fields: [tenantRoleAssignment.tenantId],
			references: [tenant.id],
		}),
		member: one(tenantMember, {
			fields: [tenantRoleAssignment.tenantId, tenantRoleAssignment.userId],
			references: [tenantMember.tenantId, tenantMember.userId],
		}),
		role: one(tenantRole, {
			fields: [tenantRoleAssignment.roleId, tenantRoleAssignment.tenantId],
			references: [tenantRole.id, tenantRole.tenantId],
		}),
		assignedBy: one(user, {
			fields: [tenantRoleAssignment.assignedByUserId],
			references: [user.id],
		}),
	}),
);
