import { createHmac } from "node:crypto";
import { db } from "@whatsapp-flow/db";
import { device } from "@whatsapp-flow/db/schema/device";
import {
	webhookDelivery,
	webhookEndpoint,
} from "@whatsapp-flow/db/schema/webhook";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

const MAX_WEBHOOK_ATTEMPTS = 5;

export async function enqueueWebhook(
	userId: string,
	deviceId: string,
	eventType: string,
	payload: unknown,
) {
	try {
		// Find active endpoints for this user that apply to this device
		// Either global (deviceId is null) or specific (deviceId matches)
		const endpoints = await db
			.select()
			.from(webhookEndpoint)
			.where(
				and(
					eq(webhookEndpoint.userId, userId),
					eq(webhookEndpoint.isActive, true),
					or(
						isNull(webhookEndpoint.deviceId),
						eq(webhookEndpoint.deviceId, deviceId),
					),
				),
			);

		if (endpoints.length === 0) return;

		const deliveriesIdBase = crypto.randomUUID();
		const deliveriesToInsert = endpoints
			.filter((ep) => {
				const subscribed = Array.isArray(ep.subscribedEvents)
					? ep.subscribedEvents
					: [];
				return subscribed.includes("*") || subscribed.includes(eventType);
			})
			.map((ep, idx) => ({
				id: `${deliveriesIdBase}-${idx}`,
				endpointId: ep.id,
				eventType,
				payload: payload as Record<string, unknown>,
				status: "pending" as const,
			}));

		if (deliveriesToInsert.length > 0) {
			await db.insert(webhookDelivery).values(deliveriesToInsert);
		}
	} catch (error) {
		console.error("[Webhook] Failed to enqueue webhook event:", error);
	}
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
			// Find pending deliveries that are ready to attempt
			const pendingDeliveries = await db
				.select({
					delivery: webhookDelivery,
					endpoint: webhookEndpoint,
				})
				.from(webhookDelivery)
				.innerJoin(
					webhookEndpoint,
					eq(webhookDelivery.endpointId, webhookEndpoint.id),
				)
				.where(
					and(
						eq(webhookDelivery.status, "pending"),
						lte(webhookDelivery.nextAttemptAt, new Date()),
					),
				)
				.orderBy(asc(webhookDelivery.nextAttemptAt))
				.limit(50);

			for (const { delivery, endpoint } of pendingDeliveries) {
				await processWebhookDelivery(delivery, endpoint);
			}
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
				await enqueueWebhook(d[0].userId, ev.deviceId, "message.received", {
					contact: ev.contact,
					message: ev.message,
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
				await enqueueWebhook(
					d[0].userId,
					ev.deviceId,
					"device.status_changed",
					{
						status: ev.status,
						phoneNumber: ev.phoneNumber,
					},
				);
			}
		} catch (_err) {}
	});
}

async function processWebhookDelivery(
	delivery: typeof webhookDelivery.$inferSelect,
	endpoint: typeof webhookEndpoint.$inferSelect,
) {
	let statusCode: number | null = null;
	let responseBody = "";
	let isSuccess = false;

	const attemptCount = delivery.attempts + 1;
	const bodyString = JSON.stringify(delivery.payload);

	const signature = createHmac("sha256", endpoint.secret)
		.update(bodyString)
		.digest("hex");

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10_000);

		const response = await fetch(endpoint.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Webhook-Signature": signature,
				"User-Agent": "WhatsAppFlow-Webhook/1.0",
			},
			body: bodyString,
			signal: controller.signal,
		});

		clearTimeout(timeout);
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
}
