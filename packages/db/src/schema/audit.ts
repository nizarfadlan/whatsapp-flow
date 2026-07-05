import {
	bigint,
	bigserial,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const auditLog = pgTable(
	"audit_log",
	{
		id: text("id").primaryKey(),
		sequence: bigserial("sequence", { mode: "number" }).notNull(),
		actorUserId: text("actor_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		actorEmail: text("actor_email"),
		action: text("action").notNull(),
		targetType: text("target_type").notNull(),
		targetId: text("target_id"),
		targetDisplay: text("target_display"),
		before: jsonb("before"),
		after: jsonb("after"),
		reason: text("reason"),
		requestIp: text("request_ip"),
		requestUserAgent: text("request_user_agent"),
		metadata: jsonb("metadata"),
		previousHash: text("previous_hash"),
		entryHash: text("entry_hash"),
		hashAlgorithm: text("hash_algorithm").default("sha256-v1").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("audit_log_sequence_unique_idx").on(table.sequence),
		index("audit_log_created_at_idx").on(table.createdAt),
		index("audit_log_actor_created_idx").on(table.actorUserId, table.createdAt),
		index("audit_log_target_idx").on(table.targetType, table.targetId),
		index("audit_log_action_idx").on(table.action),
	],
);

export const auditExport = pgTable(
	"audit_export",
	{
		id: text("id").primaryKey(),
		actorUserId: text("actor_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		actorEmail: text("actor_email"),
		filters: jsonb("filters").notNull(),
		format: text("format").notNull(),
		status: text("status").notNull(),
		rowCount: integer("row_count").default(0).notNull(),
		fromSequence: bigint("from_sequence", { mode: "number" }),
		toSequence: bigint("to_sequence", { mode: "number" }),
		manifestHash: text("manifest_hash"),
		storageKey: text("storage_key"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		completedAt: timestamp("completed_at"),
		error: text("error"),
	},
	(table) => [
		index("audit_export_actor_created_idx").on(
			table.actorUserId,
			table.createdAt,
		),
		index("audit_export_status_idx").on(table.status),
	],
);
