import { createHmac } from "node:crypto";
import { db } from "@whatsapp-flow/db";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import {
	webhookDelivery,
	webhookEndpoint,
} from "@whatsapp-flow/db/schema/webhook";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, asc, eq, lte } from "drizzle-orm";
import { enqueueJob } from "./job-queue";
import { webhookDeliveryJobIdempotencyKey } from "./job-types";
import {
	FLOW_EXECUTION_WEBHOOK_EVENT_MAP,
	type WebhookEventType,
} from "./webhook-events";
import { fetchSafeOutboundWebhookUrl } from "./webhook-url-safety";

const MAX_WEBHOOK_ATTEMPTS = 5;

type EnqueueWebhookInput = {
	userId: string;
	deviceId: string;
	eventType: WebhookEventType;
	payload: Record<string, unknown>;
	flowId?: string | null;
};

function normalizeStringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && !!item)
		: [];
}

function endpointMatchesEvent(
	endpoint: typeof webhookEndpoint.$inferSelect,
	eventType: WebhookEventType,
) {
	const subscribed = normalizeStringArray(endpoint.subscribedEvents);
	return subscribed.includes("*") || subscribed.includes(eventType);
}

function endpointMatchesDevice(
	endpoint: typeof webhookEndpoint.$inferSelect,
	deviceId: string,
) {
	const deviceIds = normalizeStringArray(endpoint.deviceIds);
	return deviceIds.length === 0 || deviceIds.includes(deviceId);
}

function endpointMatchesFlow(
	endpoint: typeof webhookEndpoint.$inferSelect,
	eventType: WebhookEventType,
	flowId?: string | null,
) {
	if (!eventType.startsWith("flow.")) return true;
	const flowIds = normalizeStringArray(endpoint.flowIds);
	return flowIds.length === 0 || (!!flowId && flowIds.includes(flowId));
}

function serializeMessageForWebhook(message: {
	text?: string;
	type: string;
	messageKey?: import("baileys").WAMessageKey;
}) {
	return {
		type: message.type,
		text: message.text,
		messageKey: message.messageKey
			? {
					id: message.messageKey.id,
					remoteJid: message.messageKey.remoteJid,
					fromMe: message.messageKey.fromMe,
					participant: message.messageKey.participant,
				}
			: undefined,
	};
}

export async function enqueueWebhook(input: EnqueueWebhookInput) {
	try {
		const endpoints = await db
			.select()
			.from(webhookEndpoint)
			.where(
				and(
					eq(webhookEndpoint.userId, input.userId),
					eq(webhookEndpoint.isActive, true),
				),
			);

		if (endpoints.length === 0) return;

		const deliveriesIdBase = crypto.randomUUID();
		const deliveriesToInsert = endpoints
			.filter(
				(endpoint) =>
					endpointMatchesEvent(endpoint, input.eventType) &&
					endpointMatchesDevice(endpoint, input.deviceId) &&
					endpointMatchesFlow(endpoint, input.eventType, input.flowId),
			)
			.map((endpoint, idx) => ({
				id: `${deliveriesIdBase}-${idx}`,
				endpointId: endpoint.id,
				eventType: input.eventType,
				payload: input.payload,
				status: "pending" as const,
			}));

		if (deliveriesToInsert.length > 0) {
			const deliveries = await db
				.insert(webhookDelivery)
				.values(deliveriesToInsert)
				.returning({ id: webhookDelivery.id });

			await Promise.all(
				deliveries.map((delivery) => enqueueWebhookDeliveryJob(delivery.id)),
			);
		}
	} catch (error) {
		console.error("[Webhook] Failed to enqueue webhook event:", error);
	}
}

async function enqueueWebhookDeliveryJob(deliveryId: string) {
	await enqueueJob({
		kind: "webhook.deliver",
		payload: { deliveryId },
		idempotencyKey: webhookDeliveryJobIdempotencyKey(deliveryId),
		maxAttempts: MAX_WEBHOOK_ATTEMPTS,
	});
}

export async function enqueuePendingWebhookDeliveryJobs(limit = 50) {
	const pendingDeliveries = await db
		.select({ id: webhookDelivery.id })
		.from(webhookDelivery)
		.innerJoin(
			webhookEndpoint,
			eq(webhookDelivery.endpointId, webhookEndpoint.id),
		)
		.where(
			and(
				eq(webhookDelivery.status, "pending"),
				eq(webhookEndpoint.isActive, true),
				lte(webhookDelivery.nextAttemptAt, new Date()),
			),
		)
		.orderBy(asc(webhookDelivery.nextAttemptAt))
		.limit(limit);

	await Promise.all(
		pendingDeliveries.map((delivery) => enqueueWebhookDeliveryJob(delivery.id)),
	);
	return pendingDeliveries.length;
}

// Global dispatcher state so we don't start multiple
const globalDispatcherState = globalThis as typeof globalThis & {
	__webhookDispatcherStarted?: boolean;
};

export function startWebhookDispatcher() {
	if (globalDispatcherState.__webhookDispatcherStarted) return;
	globalDispatcherState.__webhookDispatcherStarted = true;

	const tick = async () => {
		try {
			await enqueuePendingWebhookDeliveryJobs();
		} catch (error) {
			console.error("[Webhook worker] Polling error:", error);
		} finally {
			setTimeout(tick, 10_000);
		}
	};

	void tick();

	// We need device.userId. So we fetch device info during event.
	connectionManager.on("device:message", async (ev) => {
		try {
			const d = await db
				.select({ userId: device.userId })
				.from(device)
				.where(eq(device.id, ev.deviceId))
				.limit(1);
			if (d[0]) {
				await enqueueWebhook({
					userId: d[0].userId,
					deviceId: ev.deviceId,
					eventType: "message.received",
					payload: {
						eventType: "message.received",
						deviceId: ev.deviceId,
						contact: ev.contact,
						message: serializeMessageForWebhook(ev.message),
					},
				});
			}
		} catch (_err) {}
	});

	connectionManager.on("device:status", async (ev) => {
		try {
			const d = await db
				.select({ userId: device.userId })
				.from(device)
				.where(eq(device.id, ev.deviceId))
				.limit(1);
			if (d[0]) {
				await enqueueWebhook({
					userId: d[0].userId,
					deviceId: ev.deviceId,
					eventType: "device.status_changed",
					payload: {
						eventType: "device.status_changed",
						deviceId: ev.deviceId,
						status: ev.status,
						phoneNumber: ev.phoneNumber,
					},
				});
			}
		} catch (_err) {}
	});

	connectionManager.on("flow:execution-event", async (ev) => {
		try {
			const eventType = FLOW_EXECUTION_WEBHOOK_EVENT_MAP[ev.type];
			if (!eventType) return;

			const rows = await db
				.select({ userId: flow.userId, flowName: flow.name })
				.from(flow)
				.where(eq(flow.id, ev.flowId))
				.limit(1);
			const flowRow = rows[0];
			if (!flowRow) return;

			await enqueueWebhook({
				userId: flowRow.userId,
				deviceId: ev.deviceId,
				flowId: ev.flowId,
				eventType,
				payload: {
					eventType,
					deviceId: ev.deviceId,
					flowId: ev.flowId,
					flowName: flowRow.flowName,
					executionLogId: ev.executionLogId,
					sessionId: ev.sessionId,
					contactNumber: ev.contactNumber,
					nodeId: ev.nodeId,
					message: ev.message,
					data: ev.payload,
					createdAt: ev.createdAt,
				},
			});
		} catch (_err) {}
	});
}

export async function processWebhookDeliveryJob(input: { deliveryId: string }) {
	const [row] = await db
		.select({ delivery: webhookDelivery, endpoint: webhookEndpoint })
		.from(webhookDelivery)
		.innerJoin(
			webhookEndpoint,
			eq(webhookDelivery.endpointId, webhookEndpoint.id),
		)
		.where(eq(webhookDelivery.id, input.deliveryId))
		.limit(1);

	if (!row) return;
	const result = await processWebhookDelivery(row.delivery, row.endpoint);
	if (result.status === "pending") {
		throw new Error("Webhook delivery failed; retry scheduled");
	}
	if (result.status === "failed") {
		throw new Error("Webhook delivery failed permanently");
	}
}

async function processWebhookDelivery(
	delivery: typeof webhookDelivery.$inferSelect,
	endpoint: typeof webhookEndpoint.$inferSelect,
) {
	if (!endpoint.isActive) return { status: "skipped" as const };

	let statusCode: number | null = null;
	let responseBody = "";
	let isSuccess = false;

	const attemptCount = delivery.attempts + 1;
	const bodyString = JSON.stringify(delivery.payload);

	const signature = createHmac("sha256", endpoint.secret)
		.update(bodyString)
		.digest("hex");

	try {
		const response = await fetchSafeOutboundWebhookUrl(
			endpoint.url,
			bodyString,
			{
				"Content-Type": "application/json",
				"X-Webhook-Signature": signature,
				"User-Agent": "WhatsAppFlow-Webhook/1.0",
			},
		);

		statusCode = response.status;

		const text = await response.text();
		responseBody = text ? text.slice(0, 1024) : "";

		isSuccess = statusCode >= 200 && statusCode < 300;
	} catch (error) {
		statusCode = 0; // indicates network/timeout
		responseBody = error instanceof Error ? error.message : "Unknown Error";
	}

	let nextStatus: "pending" | "success" | "failed" = "pending";
	const nextAttemptAt = new Date();

	if (isSuccess) {
		nextStatus = "success";
	} else if (attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
		nextStatus = "failed";
	} else {
		// Exponential backoff base 15 secs
		// e.g. delay: 30s, 60s, 120s, 240s
		const delaySeconds = 15 * 2 ** attemptCount;
		nextAttemptAt.setSeconds(nextAttemptAt.getSeconds() + delaySeconds);
	}

	await db
		.update(webhookDelivery)
		.set({
			status: nextStatus,
			statusCode,
			responseBody,
			attempts: attemptCount,
			nextAttemptAt,
		})
		.where(eq(webhookDelivery.id, delivery.id));

	return { status: nextStatus };
}
