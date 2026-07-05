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

export const jobStatusEnum = pgEnum("job_status", [
	"pending",
	"running",
	"succeeded",
	"failed",
	"dead",
	"cancelled",
]);

export const jobQueue = pgTable(
	"job_queue",
	{
		id: text("id").primaryKey(),
		kind: text("kind").notNull(),
		status: jobStatusEnum("status").default("pending").notNull(),
		priority: integer("priority").default(0).notNull(),
		payload: jsonb("payload").notNull(),
		idempotencyKey: text("idempotency_key"),
		attempts: integer("attempts").default(0).notNull(),
		maxAttempts: integer("max_attempts").default(5).notNull(),
		runAt: timestamp("run_at").defaultNow().notNull(),
		lockedBy: text("locked_by"),
		lockedAt: timestamp("locked_at"),
		leaseUntil: timestamp("lease_until"),
		lastError: text("last_error"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("job_queue_status_run_priority_idx").on(
			table.status,
			table.runAt,
			table.priority,
		),
		index("job_queue_lease_until_idx").on(table.leaseUntil),
		index("job_queue_kind_status_run_idx").on(
			table.kind,
			table.status,
			table.runAt,
		),
		uniqueIndex("job_queue_idempotency_key_unique_idx")
			.on(table.idempotencyKey)
			.where(sql`${table.idempotencyKey} is not null`),
	],
);
