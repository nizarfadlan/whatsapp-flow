import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const role = pgTable(
	"role",
	{
		id: text("id").primaryKey(),
		key: text("key").notNull().unique(),
		name: text("name").notNull(),
		description: text("description"),
		isSystem: boolean("is_system").default(false).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("role_key_idx").on(table.key)],
);

export const permission = pgTable(
	"permission",
	{
		key: text("key").primaryKey(),
		description: text("description").notNull(),
		category: text("category").notNull(),
	},
	(table) => [index("permission_category_idx").on(table.category)],
);

export const rolePermission = pgTable(
	"role_permission",
	{
		roleId: text("role_id")
			.notNull()
			.references(() => role.id, { onDelete: "cascade" }),
		permissionKey: text("permission_key")
			.notNull()
			.references(() => permission.key, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.roleId, table.permissionKey] }),
		index("role_permission_permission_idx").on(table.permissionKey),
	],
);

export const userRoleAssignment = pgTable(
	"user_role_assignment",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		roleId: text("role_id")
			.notNull()
			.references(() => role.id, { onDelete: "cascade" }),
		assignedByUserId: text("assigned_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		assignedAt: timestamp("assigned_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.roleId] }),
		index("user_role_assignment_role_idx").on(table.roleId),
	],
);

export const userInvitation = pgTable(
	"user_invitation",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		roleId: text("role_id")
			.notNull()
			.references(() => role.id, { onDelete: "restrict" }),
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
		index("user_invitation_email_idx").on(table.email),
		index("user_invitation_status_idx").on(table.status),
		index("user_invitation_role_idx").on(table.roleId),
	],
);

export const roleRelations = relations(role, ({ many }) => ({
	permissions: many(rolePermission),
	users: many(userRoleAssignment),
	invitations: many(userInvitation),
}));

export const permissionRelations = relations(permission, ({ many }) => ({
	roles: many(rolePermission),
}));

export const rolePermissionRelations = relations(rolePermission, ({ one }) => ({
	role: one(role, {
		fields: [rolePermission.roleId],
		references: [role.id],
	}),
	permission: one(permission, {
		fields: [rolePermission.permissionKey],
		references: [permission.key],
	}),
}));

export const userRoleAssignmentRelations = relations(
	userRoleAssignment,
	({ one }) => ({
		user: one(user, {
			fields: [userRoleAssignment.userId],
			references: [user.id],
		}),
		role: one(role, {
			fields: [userRoleAssignment.roleId],
			references: [role.id],
		}),
		assignedBy: one(user, {
			fields: [userRoleAssignment.assignedByUserId],
			references: [user.id],
		}),
	}),
);

export const userInvitationRelations = relations(userInvitation, ({ one }) => ({
	role: one(role, {
		fields: [userInvitation.roleId],
		references: [role.id],
	}),
	invitedBy: one(user, {
		fields: [userInvitation.invitedByUserId],
		references: [user.id],
	}),
	acceptedBy: one(user, {
		fields: [userInvitation.acceptedByUserId],
		references: [user.id],
	}),
}));
