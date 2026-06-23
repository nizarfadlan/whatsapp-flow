import { relations, sql } from "drizzle-orm";
import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { webhookEndpoint } from "./webhook";

export const deviceStatusEnum = pgEnum("device_status", [
	"disconnected",
	"connecting",
	"connected",
	"banned",
]);

export const device = pgTable(
	"device",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		phoneNumber: text("phone_number"),
		status: deviceStatusEnum("status").default("disconnected").notNull(),
		sessionData: jsonb("session_data"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("device_userId_idx").on(table.userId)],
);

export const triggerTypeEnum = pgEnum("trigger_type", [
	"keyword",
	"any_message",
	"webhook",
	"schedule",
]);

export const flowStatusEnum = pgEnum("flow_status", [
	"draft",
	"active",
	"paused",
]);

export const flow = pgTable(
	"flow",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		deviceId: text("device_id").references(() => device.id, {
			onDelete: "set null",
		}),
		name: text("name").notNull(),
		description: text("description"),
		nodes: jsonb("nodes").default("[]").notNull(),
		edges: jsonb("edges").default("[]").notNull(),
		status: flowStatusEnum("status").default("draft").notNull(),
		triggerType: triggerTypeEnum("trigger_type").default("keyword").notNull(),
		triggerConfig: jsonb("trigger_config"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("flow_userId_idx").on(table.userId),
		index("flow_deviceId_idx").on(table.deviceId),
	],
);

export const flowRelations = relations(flow, ({ one, many }) => ({
	user: one(user, {
		fields: [flow.userId],
		references: [user.id],
	}),
	device: one(device, {
		fields: [flow.deviceId],
		references: [device.id],
	}),
	logs: many(flowExecutionLog),
	sessions: many(flowSession),
}));

export const executionStatusEnum = pgEnum("execution_status", [
	"running",
	"waiting",
	"completed",
	"failed",
]);

export const flowExecutionLog = pgTable(
	"flow_execution_log",
	{
		id: text("id").primaryKey(),
		flowId: text("flow_id")
			.notNull()
			.references(() => flow.id, { onDelete: "cascade" }),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		contactNumber: text("contact_number").notNull(),
		triggerSource: text("trigger_source").default("message").notNull(),
		status: executionStatusEnum("status").default("running").notNull(),
		error: text("error"),
		nodeResults: jsonb("node_results").default("[]").notNull(),
		startedAt: timestamp("started_at").defaultNow().notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("flow_execution_log_flowId_idx").on(table.flowId),
		index("flow_execution_log_deviceId_idx").on(table.deviceId),
		index("flow_execution_log_source_status_idx").on(
			table.triggerSource,
			table.status,
		),
	],
);

export const flowSessionStatusEnum = pgEnum("flow_session_status", [
	"waiting",
	"running",
	"completed",
	"expired",
	"failed",
]);

export const flowSession = pgTable(
	"flow_session",
	{
		id: text("id").primaryKey(),
		flowId: text("flow_id")
			.notNull()
			.references(() => flow.id, { onDelete: "cascade" }),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		contactNumber: text("contact_number").notNull(),
		executionLogId: text("execution_log_id")
			.notNull()
			.references(() => flowExecutionLog.id, { onDelete: "cascade" }),
		status: flowSessionStatusEnum("status").default("waiting").notNull(),
		waitingNodeId: text("waiting_node_id").notNull(),
		nextNodeIds: jsonb("next_node_ids").default("[]").notNull(),
		variables: jsonb("variables").default("{}").notNull(),
		nodeResults: jsonb("node_results").default("[]").notNull(),
		expiresAt: timestamp("expires_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		uniqueIndex("flow_session_active_contact_unique_idx")
			.on(table.deviceId, table.contactNumber)
			.where(sql`${table.status} in ('waiting', 'running')`),
		index("flow_session_contact_status_idx").on(
			table.deviceId,
			table.contactNumber,
			table.status,
		),
		index("flow_session_flowId_idx").on(table.flowId),
		index("flow_session_executionLogId_idx").on(table.executionLogId),
		index("flow_session_expiresAt_idx").on(table.expiresAt),
	],
);

export const flowExecutionLogRelations = relations(
	flowExecutionLog,
	({ one, many }) => ({
		flow: one(flow, {
			fields: [flowExecutionLog.flowId],
			references: [flow.id],
		}),
		device: one(device, {
			fields: [flowExecutionLog.deviceId],
			references: [device.id],
		}),
		sessions: many(flowSession),
		webhookEndpoints: many(webhookEndpoint),
	}),
);

export const flowSessionRelations = relations(flowSession, ({ one }) => ({
	flow: one(flow, {
		fields: [flowSession.flowId],
		references: [flow.id],
	}),
	device: one(device, {
		fields: [flowSession.deviceId],
		references: [device.id],
	}),
	executionLog: one(flowExecutionLog, {
		fields: [flowSession.executionLogId],
		references: [flowExecutionLog.id],
	}),
}));

export const deviceRelations = relations(device, ({ one, many }) => ({
	user: one(user, {
		fields: [device.userId],
		references: [user.id],
	}),
	flows: many(flow),
	sessions: many(flowSession),
}));
