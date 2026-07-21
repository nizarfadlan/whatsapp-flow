import { relations } from "drizzle-orm";
import {
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const tenantMemberRoleEnum = pgEnum("tenant_member_role", [
	"owner",
	"member",
]);

export const tenant = pgTable(
	"tenant",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("tenant_created_by_user_idx").on(table.createdByUserId)],
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

export const tenantRelations = relations(tenant, ({ many, one }) => ({
	createdBy: one(user, {
		fields: [tenant.createdByUserId],
		references: [user.id],
	}),
	members: many(tenantMember),
	invitations: many(tenantInvitation),
}));

export const tenantMemberRelations = relations(tenantMember, ({ one }) => ({
	tenant: one(tenant, {
		fields: [tenantMember.tenantId],
		references: [tenant.id],
	}),
	user: one(user, {
		fields: [tenantMember.userId],
		references: [user.id],
	}),
}));
