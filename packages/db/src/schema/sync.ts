import { sql } from "drizzle-orm";
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
import { user } from "./auth";
import { device } from "./device";
import { jobQueue } from "./job";

export const deviceSyncResourceEnum = pgEnum("device_sync_resource", [
	"contacts",
	"groups",
	"newsletters",
]);

export const deviceSyncModeEnum = pgEnum("device_sync_mode", [
	"normal",
	"repair",
]);

export const deviceSyncStatusEnum = pgEnum("device_sync_status", [
	"queued",
	"running",
	"succeeded",
	"partial",
	"failed",
	"cancelled",
]);

export const deviceSyncRun = pgTable(
	"device_sync_run",
	{
		id: text("id").primaryKey(),
		requestId: text("request_id").notNull(),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		requestedByUserId: text("requested_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		resource: deviceSyncResourceEnum("resource").notNull(),
		scopeKey: text("scope_key").default("all").notNull(),
		mode: deviceSyncModeEnum("mode").default("normal").notNull(),
		status: deviceSyncStatusEnum("status").default("queued").notNull(),
		jobId: text("job_id").references(() => jobQueue.id, {
			onDelete: "set null",
		}),
		claimAttempt: integer("claim_attempt"),
		progress: integer("progress").default(0).notNull(),
		discoveredCount: integer("discovered_count").default(0).notNull(),
		processedCount: integer("processed_count").default(0).notNull(),
		createdCount: integer("created_count").default(0).notNull(),
		updatedCount: integer("updated_count").default(0).notNull(),
		skippedCount: integer("skipped_count").default(0).notNull(),
		failedCount: integer("failed_count").default(0).notNull(),
		checkpoint: jsonb("checkpoint"),
		lastError: text("last_error"),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("device_sync_run_active_scope_unique_idx")
			.on(table.deviceId, table.resource, table.scopeKey)
			.where(sql`${table.status} in ('queued', 'running')`),
		index("device_sync_run_request_idx").on(table.requestId),
		index("device_sync_run_device_created_idx").on(
			table.deviceId,
			table.createdAt,
		),
		index("device_sync_run_status_created_idx").on(
			table.status,
			table.createdAt,
		),
		index("device_sync_run_job_idx").on(table.jobId),
	],
);
