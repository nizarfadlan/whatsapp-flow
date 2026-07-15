import { createHmac } from "node:crypto";
import { db } from "@whatsapp-flow/db";
import {
	chatGroup,
	contact as contactTable,
	groupParticipant,
} from "@whatsapp-flow/db/schema/contact";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import {
	webhookDelivery,
	webhookEndpoint,
} from "@whatsapp-flow/db/schema/webhook";
import {
	type ConnectionManagerEvents,
	connectionManager,
	derivePrivateIdentityKey,
} from "@whatsapp-flow/whatsapp";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { logger } from "../observability/logger";
import { enrichInboundMedia, type WebhookMedia } from "./inbound-media";
import { enqueueJob } from "./job-queue";
import { webhookDeliveryJobIdempotencyKey } from "./job-types";
import {
	FLOW_EXECUTION_WEBHOOK_EVENT_MAP,
	type WebhookEventType,
} from "./webhook-events";
import { fetchSafeOutboundWebhookUrl } from "./webhook-url-safety";

const MAX_WEBHOOK_ATTEMPTS = 5;

type WebhookPayload = Record<string, unknown>;
type WebhookPayloadFactory = () => WebhookPayload | Promise<WebhookPayload>;

type EnqueueWebhookInput = {
	userId: string;
	deviceId: string;
	eventType: WebhookEventType;
	payload: WebhookPayload | WebhookPayloadFactory;
	flowId?: string | null;
};

type DeviceMessageEvent = ConnectionManagerEvents["device:message"];
type ChatType = "private" | "group" | "channel" | "broadcast";
type Identity = {
	jid?: string;
	number?: string;
	phoneNumber?: string;
	lid?: string;
	username?: string;
	identityKey?: string;
	name?: string | null;
	providerContactId?: string;
	identifier?: string;
	resolved?: boolean;
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

export async function buildMessageReceivedPayload(ev: DeviceMessageEvent) {
	const chat = normalizeChat(ev);
	const contact = await enrichIdentity(ev.deviceId, withIdentifier(ev.contact));
	const sender = await enrichIdentity(ev.deviceId, normalizeSender(ev));
	const group = chat.isGroup
		? await normalizeGroup(ev, chat.jid, sender)
		: undefined;
	const mediaResult = await enrichInboundMedia({
		deviceId: ev.deviceId,
		provider: ev.provider ?? "baileys",
		providerMessageId:
			ev.message.providerMessageId ?? ev.message.messageKey?.id ?? undefined,
		messageType: ev.message.type,
		raw: ev.message.raw,
	});
	const mentions = await resolveMentions(
		ev.deviceId,
		extractMentionJids(ev.message.raw),
	);

	return {
		eventType: "message.received",
		deviceId: ev.deviceId,
		provider: ev.provider,
		contact,
		chat,
		sender,
		group,
		message: serializeMessageForWebhook(ev.message, {
			media: mediaResult.media,
			mentions,
		}),
	};
}

function serializeMessageForWebhook(
	message: DeviceMessageEvent["message"],
	extra: { media: WebhookMedia | null; mentions: Identity[] },
) {
	return {
		type: message.type,
		text: message.text,
		providerMessageId: message.providerMessageId,
		messageKey: message.messageKey
			? {
					id: message.messageKey.id,
					remoteJid: message.messageKey.remoteJid,
					fromMe: message.messageKey.fromMe,
					participant: message.messageKey.participant,
				}
			: undefined,
		media: extra.media ?? undefined,
		mentions: extra.mentions.length > 0 ? extra.mentions : undefined,
	};
}

function normalizeChat(ev: DeviceMessageEvent) {
	if (ev.chat) return ev.chat;
	const jid = ev.message.messageKey?.remoteJid ?? ev.contact.jid;
	const type = getChatType(jid);
	return { jid, type, isGroup: type === "group" };
}

function normalizeSender(ev: DeviceMessageEvent): Identity {
	if (ev.sender) return withIdentifier(ev.sender);
	const participant = ev.message.messageKey?.participant;
	if (participant) return withIdentifier(identityFromJid(participant));
	return withIdentifier({
		jid: ev.contact.jid,
		number: ev.contact.number,
		phoneNumber: ev.contact.number,
		lid: ev.contact.lid,
		username: ev.contact.username,
		identityKey: ev.contact.identityKey,
		name: ev.contact.name,
		providerContactId: ev.contact.providerContactId,
	});
}

async function normalizeGroup(
	ev: DeviceMessageEvent,
	groupJid: string,
	sender: Identity,
) {
	const [groupRow] = await db
		.select({
			id: chatGroup.id,
			subject: chatGroup.subject,
			participantCount: chatGroup.participantCount,
		})
		.from(chatGroup)
		.where(
			and(eq(chatGroup.deviceId, ev.deviceId), eq(chatGroup.jid, groupJid)),
		)
		.limit(1);

	const senderParticipant = await enrichGroupParticipant(groupRow?.id, sender);
	const eventGroupName =
		ev.group?.name === groupJid ? undefined : ev.group?.name;
	return {
		jid: groupJid,
		name: groupRow?.subject ?? eventGroupName,
		participantCount: ev.group?.participantCount ?? groupRow?.participantCount,
		senderParticipant,
	};
}

async function enrichGroupParticipant(
	groupId: string | undefined,
	sender: Identity,
) {
	if (!groupId || !sender.jid) return sender;
	const [participant] = await db
		.select({ role: groupParticipant.role })
		.from(groupParticipant)
		.where(
			and(
				eq(groupParticipant.groupId, groupId),
				eq(groupParticipant.jid, sender.jid),
			),
		)
		.limit(1);
	return { ...sender, role: participant?.role ?? "member" };
}

async function enrichIdentity(
	deviceId: string,
	identity: Identity,
): Promise<Identity> {
	const number = identity.number ?? identity.phoneNumber;
	const identityKey =
		identity.identityKey ??
		derivePrivateIdentityKey({ jid: identity.jid, number, lid: identity.lid });
	const candidates = [
		eq(contactTable.identityKey, identityKey),
		number ? eq(contactTable.phoneNumber, number) : undefined,
		identity.lid ? eq(contactTable.lid, identity.lid) : undefined,
		identity.providerContactId
			? eq(contactTable.providerContactId, identity.providerContactId)
			: undefined,
		identity.jid ? eq(contactTable.jid, identity.jid) : undefined,
	].filter((condition): condition is NonNullable<typeof condition> =>
		Boolean(condition),
	);

	if (candidates.length > 0) {
		const orderClauses = [
			sql`when ${contactTable.identityKey} = ${identityKey} then 1`,
			...(number
				? [sql`when ${contactTable.phoneNumber} = ${number} then 2`]
				: []),
			...(identity.lid
				? [sql`when ${contactTable.lid} = ${identity.lid} then 3`]
				: []),
			...(identity.providerContactId
				? [
						sql`when ${contactTable.providerContactId} = ${identity.providerContactId} then 4`,
					]
				: []),
			...(identity.jid
				? [sql`when ${contactTable.jid} = ${identity.jid} then 5`]
				: []),
		];

		const [row] = await db
			.select({
				jid: contactTable.jid,
				identityKey: contactTable.identityKey,
				phoneNumber: contactTable.phoneNumber,
				lid: contactTable.lid,
				name: contactTable.name,
				pushName: contactTable.pushName,
				profileName: contactTable.profileName,
				providerContactId: contactTable.providerContactId,
			})
			.from(contactTable)
			.where(and(eq(contactTable.deviceId, deviceId), or(...candidates)))
			.orderBy(sql`case ${sql.join(orderClauses, sql` `)} else 6 end`)
			.limit(1);

		if (row) {
			return withIdentifier({
				jid: identity.jid ?? row.jid,
				number: number ?? row.phoneNumber ?? undefined,
				phoneNumber: number ?? row.phoneNumber ?? undefined,
				lid: identity.lid ?? row.lid ?? undefined,
				username: identity.username,
				identityKey: row.identityKey,
				name: identity.name ?? row.name ?? row.pushName ?? row.profileName,
				providerContactId:
					identity.providerContactId ?? row.providerContactId ?? undefined,
				resolved: true,
			});
		}
	}

	return withIdentifier({
		...identity,
		number,
		phoneNumber: number,
		identityKey,
		resolved: false,
	});
}

async function resolveMentions(deviceId: string, mentionedJids: string[]) {
	const unique = [...new Set(mentionedJids.filter(Boolean))];
	return Promise.all(
		unique.map((jid) => enrichIdentity(deviceId, identityFromJid(jid))),
	);
}

function identityFromJid(jid: string): Identity {
	if (jid.endsWith("@lid")) {
		return withIdentifier({
			jid,
			lid: jid,
			identityKey: derivePrivateIdentityKey({ jid, lid: jid }),
		});
	}
	const number =
		jid.endsWith("@s.whatsapp.net") || !jid.includes("@")
			? normalizeContactNumber(jid)
			: undefined;
	return withIdentifier({
		jid,
		number,
		phoneNumber: number,
		identityKey: derivePrivateIdentityKey({ jid, number }),
	});
}

function withIdentifier<T extends Identity>(
	identity: T,
): T & { identifier: string } {
	return {
		...identity,
		phoneNumber: identity.phoneNumber ?? identity.number,
		identifier:
			identity.identifier ??
			identity.identityKey ??
			identity.number ??
			identity.phoneNumber ??
			identity.lid ??
			identity.jid ??
			identity.providerContactId ??
			"unknown",
	};
}

function extractMentionJids(raw: unknown) {
	const mentions = new Set<string>();
	collectMentionJids(raw, mentions);
	return [...mentions];
}

function collectMentionJids(value: unknown, mentions: Set<string>, depth = 0) {
	if (!value || typeof value !== "object" || depth > 5) return;
	const record = value as Record<string, unknown>;
	const mentionedJid = record.mentionedJid;
	if (Array.isArray(mentionedJid)) {
		for (const item of mentionedJid) {
			if (typeof item === "string" && item) mentions.add(item);
		}
	}
	for (const item of Object.values(record)) {
		if (item && typeof item === "object")
			collectMentionJids(item, mentions, depth + 1);
	}
}

function getChatType(jid: string): ChatType {
	if (jid.endsWith("@g.us")) return "group";
	if (jid.endsWith("@newsletter")) return "channel";
	if (jid.endsWith("@broadcast")) return "broadcast";
	return "private";
}

function normalizeContactNumber(jid: string) {
	return jid.split("@")[0]?.split(":")[0] ?? jid;
}

export async function buildWebhookDeliveryRows(
	input: EnqueueWebhookInput,
	endpoints: (typeof webhookEndpoint.$inferSelect)[],
	idBase = crypto.randomUUID(),
) {
	const matchedEndpoints = endpoints.filter(
		(endpoint) =>
			endpointMatchesEvent(endpoint, input.eventType) &&
			endpointMatchesDevice(endpoint, input.deviceId) &&
			endpointMatchesFlow(endpoint, input.eventType, input.flowId),
	);
	if (matchedEndpoints.length === 0) return [];

	const payload =
		typeof input.payload === "function" ? await input.payload() : input.payload;
	return matchedEndpoints.map((endpoint, index) => ({
		id: `${idBase}-${index}`,
		endpointId: endpoint.id,
		eventType: input.eventType,
		payload,
		status: "pending" as const,
	}));
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

		const deliveriesToInsert = await buildWebhookDeliveryRows(input, endpoints);

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
		logger.error("webhook.enqueue.failed", {
			error,
			operation: "enqueue_webhook",
			eventType: input.eventType,
			deviceId: input.deviceId,
			flowId: input.flowId,
		});
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
			logger.error("webhook.dispatcher.poll_failed", {
				error,
				operation: "enqueue_pending_deliveries",
			});
		} finally {
			setTimeout(tick, 10_000);
		}
	};

	void tick();

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
					payload: () => buildMessageReceivedPayload(ev),
				});
			}
		} catch (error) {
			logger.error("webhook.listener.failed", {
				error,
				operation: "message_received_listener",
				eventType: "message.received",
				deviceId: ev.deviceId,
			});
		}
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
		} catch (error) {
			logger.error("webhook.listener.failed", {
				error,
				operation: "device_status_listener",
				eventType: "device.status_changed",
				deviceId: ev.deviceId,
			});
		}
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
					contactKey: ev.contactKey,
					nodeId: ev.nodeId,
					message: ev.message,
					data: ev.payload,
					createdAt: ev.createdAt,
				},
			});
		} catch (error) {
			logger.error("webhook.listener.failed", {
				error,
				operation: "flow_execution_listener",
				flowId: ev.flowId,
				deviceId: ev.deviceId,
			});
		}
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
		statusCode = 0;
		responseBody = error instanceof Error ? error.message : "Unknown Error";
	}

	let nextStatus: "pending" | "success" | "failed" = "pending";
	const nextAttemptAt = new Date();

	if (isSuccess) {
		nextStatus = "success";
	} else if (attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
		nextStatus = "failed";
	} else {
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
