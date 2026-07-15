import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { device } from "./device";

export const baileysMessageContent = pgTable(
	"baileys_message_content",
	{
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		remoteJid: text("remote_jid").notNull(),
		providerMessageId: text("provider_message_id").notNull(),
		fromMe: boolean("from_me").notNull(),
		participant: text("participant").default("").notNull(),
		content: jsonb("content").notNull(),
		providerTimestamp: timestamp("provider_timestamp"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("baileys_message_content_key_unique_idx").on(
			table.deviceId,
			table.remoteJid,
			table.providerMessageId,
			table.fromMe,
			table.participant,
		),
		index("baileys_message_content_device_timestamp_idx").on(
			table.deviceId,
			table.providerTimestamp,
		),
	],
);
