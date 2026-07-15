import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { device } from "./device";

export const contactSourceEnum = pgEnum("contact_source", [
	"sync",
	"manual",
	"message",
]);

export const contact = pgTable(
	"contact",
	{
		id: text("id").primaryKey(),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		jid: text("jid").notNull(),
		identityKey: text("identity_key").notNull(),
		phoneNumber: text("phone_number"),
		name: text("name"),
		pushName: text("push_name"),
		profileName: text("profile_name"),
		providerContactId: text("provider_contact_id"),
		isWaContact: boolean("is_wa_contact").default(true).notNull(),
		isBlocked: boolean("is_blocked").default(false).notNull(),
		source: contactSourceEnum("source").default("sync").notNull(),
		avatarUrl: text("avatar_url"),
		lid: text("lid"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("contact_device_identity_key_unique_idx").on(
			table.deviceId,
			table.identityKey,
		),
		uniqueIndex("contact_device_phone_unique_idx")
			.on(table.deviceId, table.phoneNumber)
			.where(sql`${table.phoneNumber} is not null`),
		uniqueIndex("contact_device_lid_unique_idx")
			.on(table.deviceId, table.lid)
			.where(sql`${table.lid} is not null`),
		uniqueIndex("contact_device_jid_unique_idx").on(table.deviceId, table.jid),
		index("contact_deviceId_idx").on(table.deviceId),
		index("contact_device_phone_idx").on(table.deviceId, table.phoneNumber),
		index("contact_device_lid_idx").on(table.deviceId, table.lid),
		index("contact_device_provider_contact_idx").on(
			table.deviceId,
			table.providerContactId,
		),
	],
);

export const groupSourceEnum = pgEnum("group_source", ["sync", "manual"]);

export const chatGroup = pgTable(
	"chat_group",
	{
		id: text("id").primaryKey(),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		jid: text("jid").notNull(),
		subject: text("subject").notNull(),
		description: text("description"),
		ownerJid: text("owner_jid"),
		participantCount: integer("participant_count").default(0).notNull(),
		isMember: boolean("is_member").default(true).notNull(),
		source: groupSourceEnum("source").default("sync").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("chat_group_device_jid_unique_idx").on(
			table.deviceId,
			table.jid,
		),
		index("chat_group_deviceId_idx").on(table.deviceId),
	],
);

export const tag = pgTable(
	"tag",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("tag_user_name_unique_idx").on(
			table.userId,
			sql`lower(${table.name})`,
		),
		index("tag_user_idx").on(table.userId),
	],
);

export const contactTag = pgTable(
	"contact_tag",
	{
		contactId: text("contact_id")
			.notNull()
			.references(() => contact.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tag.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.contactId, table.tagId] }),
		index("contact_tag_tag_idx").on(table.tagId),
	],
);

export const groupTag = pgTable(
	"group_tag",
	{
		groupId: text("group_id")
			.notNull()
			.references(() => chatGroup.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tag.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.groupId, table.tagId] }),
		index("group_tag_tag_idx").on(table.tagId),
	],
);

export const groupParticipantRoleEnum = pgEnum("group_participant_role", [
	"member",
	"admin",
	"superadmin",
]);

export const groupParticipant = pgTable(
	"group_participant",
	{
		id: text("id").primaryKey(),
		groupId: text("group_id")
			.notNull()
			.references(() => chatGroup.id, { onDelete: "cascade" }),
		jid: text("jid").notNull(),
		role: groupParticipantRoleEnum("role").default("member").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("group_participant_group_jid_unique_idx").on(
			table.groupId,
			table.jid,
		),
		index("group_participant_groupId_idx").on(table.groupId),
	],
);

export const contactRelations = relations(contact, ({ one, many }) => ({
	device: one(device, {
		fields: [contact.deviceId],
		references: [device.id],
	}),
	tags: many(contactTag),
}));

export const chatGroupRelations = relations(chatGroup, ({ one, many }) => ({
	device: one(device, {
		fields: [chatGroup.deviceId],
		references: [device.id],
	}),
	participants: many(groupParticipant),
	tags: many(groupTag),
}));

export const tagRelations = relations(tag, ({ one, many }) => ({
	user: one(user, {
		fields: [tag.userId],
		references: [user.id],
	}),
	contacts: many(contactTag),
	groups: many(groupTag),
}));

export const contactTagRelations = relations(contactTag, ({ one }) => ({
	contact: one(contact, {
		fields: [contactTag.contactId],
		references: [contact.id],
	}),
	tag: one(tag, {
		fields: [contactTag.tagId],
		references: [tag.id],
	}),
}));

export const groupTagRelations = relations(groupTag, ({ one }) => ({
	group: one(chatGroup, {
		fields: [groupTag.groupId],
		references: [chatGroup.id],
	}),
	tag: one(tag, {
		fields: [groupTag.tagId],
		references: [tag.id],
	}),
}));

export const groupParticipantRelations = relations(
	groupParticipant,
	({ one }) => ({
		group: one(chatGroup, {
			fields: [groupParticipant.groupId],
			references: [chatGroup.id],
		}),
	}),
);

export const channelSourceEnum = pgEnum("channel_source", ["sync", "manual"]);

export const channel = pgTable(
	"channel",
	{
		id: text("id").primaryKey(),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		jid: text("jid").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		ownerJid: text("owner_jid"),
		subscribersCount: integer("subscribers_count").default(0).notNull(),
		isSubscribed: boolean("is_subscribed").default(true).notNull(),
		verificationStatus: text("verification_status"),
		source: channelSourceEnum("source").default("sync").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("channel_device_jid_unique_idx").on(table.deviceId, table.jid),
		index("channel_deviceId_idx").on(table.deviceId),
	],
);

export const channelRelations = relations(channel, ({ one }) => ({
	device: one(device, {
		fields: [channel.deviceId],
		references: [device.id],
	}),
}));
