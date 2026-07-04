import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { device } from "./device";

export const webhookEndpoint = pgTable(
	"webhook_endpoint",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		deviceId: text("device_id").references(() => device.id, {
			onDelete: "cascade",
		}),
		name: text("name").notNull(),
		url: text("url").notNull(),
		secret: text("secret").notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		subscribedEvents: jsonb("subscribed_events").default('["*"]').notNull(),
		deviceIds: jsonb("device_ids").default("[]").notNull(),
		flowIds: jsonb("flow_ids").default("[]").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("webhook_endpoint_userId_idx").on(table.userId),
		index("webhook_endpoint_deviceId_idx").on(table.deviceId),
	],
);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
	"pending",
	"success",
	"failed",
]);

export const webhookDelivery = pgTable(
	"webhook_delivery",
	{
		id: text("id").primaryKey(),
		endpointId: text("endpoint_id")
			.notNull()
			.references(() => webhookEndpoint.id, { onDelete: "cascade" }),
		eventType: text("event_type").notNull(),
		payload: jsonb("payload").notNull(),
		status: webhookDeliveryStatusEnum("status").default("pending").notNull(),
		statusCode: integer("status_code"),
		responseBody: text("response_body"),
		attempts: integer("attempts").default(0).notNull(),
		nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("webhook_delivery_endpointId_idx").on(table.endpointId),
		index("webhook_delivery_status_nextAttemptAt_idx").on(
			table.status,
			table.nextAttemptAt,
		),
	],
);

export const webhookEndpointRelations = relations(
	webhookEndpoint,
	({ one, many }) => ({
		user: one(user, {
			fields: [webhookEndpoint.userId],
			references: [user.id],
		}),
		device: one(device, {
			fields: [webhookEndpoint.deviceId],
			references: [device.id],
		}),
		deliveries: many(webhookDelivery),
	}),
);

export const webhookDeliveryRelations = relations(
	webhookDelivery,
	({ one }) => ({
		endpoint: one(webhookEndpoint, {
			fields: [webhookDelivery.endpointId],
			references: [webhookEndpoint.id],
		}),
	}),
);
