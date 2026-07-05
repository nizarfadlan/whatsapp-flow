import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const auditLog = pgTable(
	"audit_log",
	{
		id: text("id").primaryKey(),
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
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("audit_log_created_at_idx").on(table.createdAt),
		index("audit_log_actor_created_idx").on(table.actorUserId, table.createdAt),
		index("audit_log_target_idx").on(table.targetType, table.targetId),
		index("audit_log_action_idx").on(table.action),
	],
);
