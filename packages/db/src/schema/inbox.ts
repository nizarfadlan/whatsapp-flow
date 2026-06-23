import { relations } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { chatGroup, contact } from "./contact";
import { device } from "./device";

export const messageDirectionEnum = pgEnum("message_direction", [
	"inbound",
	"outbound",
]);

export const chatTypeEnum = pgEnum("chat_type", [
	"private",
	"group",
	"channel",
	"broadcast",
]);

export const inboxThread = pgTable(
	"inbox_thread",
	{
		id: text("id").primaryKey(),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		chatType: chatTypeEnum("chat_type").default("private").notNull(),
		// chatJid = JID of the conversation: contactJid for private, groupJid for groups
		chatJid: text("chat_jid"),
		// FK links to contact/group records (optional, set async)
		contactId: text("contact_id").references(() => contact.id, {
			onDelete: "set null",
		}),
		groupId: text("group_id").references(() => chatGroup.id, {
			onDelete: "set null",
		}),
		groupJid: text("group_jid"),
		// Denormalised fields for quick display
		contactNumber: text("contact_number"),
		contactName: text("contact_name"),
		lastMessageText: text("last_message_text"),
		lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
		unreadCount: integer("unread_count").default(0).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("inbox_thread_device_chat_jid_unique_idx").on(
			table.deviceId,
			table.chatJid,
		),
		index("inbox_thread_device_contact_idx").on(
			table.deviceId,
			table.contactNumber,
		),
		index("inbox_thread_deviceId_idx").on(table.deviceId),
		index("inbox_thread_chatType_idx").on(table.chatType),
		index("inbox_thread_contactId_idx").on(table.contactId),
		index("inbox_thread_groupId_idx").on(table.groupId),
		index("inbox_thread_lastMessageAt_idx").on(table.lastMessageAt),
	],
);

export const inboxMessage = pgTable(
	"inbox_message",
	{
		id: text("id").primaryKey(),
		threadId: text("thread_id")
			.notNull()
			.references(() => inboxThread.id, { onDelete: "cascade" }),
		direction: messageDirectionEnum("direction").notNull(),
		messageType: text("message_type").default("text").notNull(),
		text: text("text"),
		raw: jsonb("raw"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("inbox_message_threadId_idx").on(table.threadId),
		index("inbox_message_createdAt_idx").on(table.createdAt),
	],
);

export const inboxThreadRelations = relations(inboxThread, ({ one, many }) => ({
	messages: many(inboxMessage),
	contact: one(contact, {
		fields: [inboxThread.contactId],
		references: [contact.id],
	}),
	group: one(chatGroup, {
		fields: [inboxThread.groupId],
		references: [chatGroup.id],
	}),
}));

export const inboxMessageRelations = relations(inboxMessage, ({ one }) => ({
	thread: one(inboxThread, {
		fields: [inboxMessage.threadId],
		references: [inboxThread.id],
	}),
}));
