import { relations, sql } from "drizzle-orm";
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
import { webhookEndpoint } from "./webhook";

export const deviceStatusEnum = pgEnum("device_status", [
	"disconnected",
	"connecting",
	"connected",
	"banned",
]);

export const deviceProviderEnum = pgEnum("device_provider", [
	"baileys",
	"meta_cloud",
]);

export const device = pgTable(
	"device",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		provider: deviceProviderEnum("provider").default("baileys").notNull(),
		externalId: text("external_id"),
		phoneNumber: text("phone_number"),
		businessAccountId: text("business_account_id"),
		displayPhoneNumber: text("display_phone_number"),
		status: deviceStatusEnum("status").default("disconnected").notNull(),
		statusReason: text("status_reason"),
		lastError: text("last_error"),
		sessionData: jsonb("session_data"),
		providerConfig: jsonb("provider_config"),
		capabilities: jsonb("capabilities"),
		lastConnectedAt: timestamp("last_connected_at"),
		lastWebhookAt: timestamp("last_webhook_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("device_userId_idx").on(table.userId),
		index("device_provider_external_idx").on(table.provider, table.externalId),
		index("device_user_provider_idx").on(table.userId, table.provider),
		uniqueIndex("device_provider_external_unique_idx")
			.on(table.provider, table.externalId)
			.where(sql`${table.externalId} is not null`),
	],
);

export const deviceProviderSecret = pgTable(
	"device_provider_secret",
	{
		id: text("id").primaryKey(),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		provider: deviceProviderEnum("provider").notNull(),
		key: text("key").notNull(),
		encryptedValue: text("encrypted_value").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("device_provider_secret_device_key_unique_idx").on(
			table.deviceId,
			table.key,
		),
		index("device_provider_secret_device_idx").on(table.deviceId),
	],
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

export const flowNodeSecret = pgTable(
	"flow_node_secret",
	{
		id: text("id").primaryKey(),
		flowId: text("flow_id")
			.notNull()
			.references(() => flow.id, { onDelete: "cascade" }),
		nodeId: text("node_id").notNull(),
		key: text("key").notNull(),
		encryptedValue: text("encrypted_value").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("flow_node_secret_flow_node_key_unique_idx").on(
			table.flowId,
			table.nodeId,
			table.key,
		),
		index("flow_node_secret_flow_idx").on(table.flowId),
		index("flow_node_secret_flow_node_idx").on(table.flowId, table.nodeId),
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
	secrets: many(flowNodeSecret),
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
		contactNumber: text("contact_number"),
		contactKey: text("contact_key").notNull(),
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
		index("flow_execution_log_device_contact_key_idx").on(
			table.deviceId,
			table.contactKey,
		),
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
		contactNumber: text("contact_number"),
		contactKey: text("contact_key").notNull(),
		executionLogId: text("execution_log_id")
			.notNull()
			.references(() => flowExecutionLog.id, { onDelete: "cascade" }),
		status: flowSessionStatusEnum("status").default("waiting").notNull(),
		waitingNodeId: text("waiting_node_id").notNull(),
		nextNodeIds: jsonb("next_node_ids").default("[]").notNull(),
		waitContext: jsonb("wait_context"),
		waitingProviderMessageId: text("waiting_provider_message_id"),
		variables: jsonb("variables").default("{}").notNull(),
		nodeResults: jsonb("node_results").default("[]").notNull(),
		expiresAt: timestamp("expires_at"),
		claimJobId: text("claim_job_id"),
		claimedAt: timestamp("claimed_at"),
		recoveryCount: integer("recovery_count").default(0).notNull(),
		lastRecoveryAt: timestamp("last_recovery_at"),
		failureCode: text("failure_code"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		uniqueIndex("flow_session_active_contact_key_unique_idx")
			.on(table.deviceId, table.contactKey)
			.where(sql`${table.status} in ('waiting', 'running')`),
		index("flow_session_contact_key_status_idx").on(
			table.deviceId,
			table.contactKey,
			table.status,
		),
		index("flow_session_contact_status_idx").on(
			table.deviceId,
			table.contactNumber,
			table.status,
		),
		index("flow_session_device_waiting_provider_status_idx").on(
			table.deviceId,
			table.waitingProviderMessageId,
			table.status,
		),
		index("flow_session_flowId_idx").on(table.flowId),
		index("flow_session_executionLogId_idx").on(table.executionLogId),
		index("flow_session_expiresAt_idx").on(table.expiresAt),
		index("flow_session_claim_job_idx").on(table.claimJobId),
		index("flow_session_status_expiresAt_idx").on(
			table.status,
			table.expiresAt,
		),
		index("flow_session_status_claimedAt_idx").on(
			table.status,
			table.claimedAt,
		),
	],
);

export const flowExecutionEvent = pgTable(
	"flow_execution_event",
	{
		id: text("id").primaryKey(),
		executionLogId: text("execution_log_id")
			.notNull()
			.references(() => flowExecutionLog.id, { onDelete: "cascade" }),
		flowId: text("flow_id")
			.notNull()
			.references(() => flow.id, { onDelete: "cascade" }),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		sessionId: text("session_id").references(() => flowSession.id, {
			onDelete: "set null",
		}),
		contactNumber: text("contact_number"),
		contactKey: text("contact_key").notNull(),
		type: text("type").notNull(),
		nodeId: text("node_id"),
		message: text("message"),
		payload: jsonb("payload").default("{}").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("flow_execution_event_log_created_idx").on(
			table.executionLogId,
			table.createdAt,
		),
		index("flow_execution_event_flow_created_idx").on(
			table.flowId,
			table.createdAt,
		),
		index("flow_execution_event_session_created_idx").on(
			table.sessionId,
			table.createdAt,
		),
		index("flow_execution_event_device_contact_key_created_idx").on(
			table.deviceId,
			table.contactKey,
			table.createdAt,
		),
		index("flow_execution_event_device_contact_created_idx").on(
			table.deviceId,
			table.contactNumber,
			table.createdAt,
		),
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
		events: many(flowExecutionEvent),
		webhookEndpoints: many(webhookEndpoint),
	}),
);

export const flowSessionRelations = relations(flowSession, ({ one, many }) => ({
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
	events: many(flowExecutionEvent),
}));

export const flowExecutionEventRelations = relations(
	flowExecutionEvent,
	({ one }) => ({
		flow: one(flow, {
			fields: [flowExecutionEvent.flowId],
			references: [flow.id],
		}),
		device: one(device, {
			fields: [flowExecutionEvent.deviceId],
			references: [device.id],
		}),
		executionLog: one(flowExecutionLog, {
			fields: [flowExecutionEvent.executionLogId],
			references: [flowExecutionLog.id],
		}),
		session: one(flowSession, {
			fields: [flowExecutionEvent.sessionId],
			references: [flowSession.id],
		}),
	}),
);

export const deviceRelations = relations(device, ({ one, many }) => ({
	user: one(user, {
		fields: [device.userId],
		references: [user.id],
	}),
	flows: many(flow),
	sessions: many(flowSession),
	providerSecrets: many(deviceProviderSecret),
}));

export const deviceProviderSecretRelations = relations(
	deviceProviderSecret,
	({ one }) => ({
		device: one(device, {
			fields: [deviceProviderSecret.deviceId],
			references: [device.id],
		}),
	}),
);
