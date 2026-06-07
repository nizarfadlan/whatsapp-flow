import { relations } from "drizzle-orm";
import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

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
}));

export const executionStatusEnum = pgEnum("execution_status", [
	"running",
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
		status: executionStatusEnum("status").default("running").notNull(),
		error: text("error"),
		nodeResults: jsonb("node_results").default("[]").notNull(),
		startedAt: timestamp("started_at").defaultNow().notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("flow_execution_log_flowId_idx").on(table.flowId),
		index("flow_execution_log_deviceId_idx").on(table.deviceId),
	],
);

export const flowExecutionLogRelations = relations(
	flowExecutionLog,
	({ one }) => ({
		flow: one(flow, {
			fields: [flowExecutionLog.flowId],
			references: [flow.id],
		}),
		device: one(device, {
			fields: [flowExecutionLog.deviceId],
			references: [device.id],
		}),
	}),
);

export const deviceRelations = relations(device, ({ one, many }) => ({
	user: one(user, {
		fields: [device.userId],
		references: [user.id],
	}),
	flows: many(flow),
}));
