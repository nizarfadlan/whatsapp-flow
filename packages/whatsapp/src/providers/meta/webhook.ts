import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@whatsapp-flow/db";
import { contact as contactTable } from "@whatsapp-flow/db/schema/contact";
import { device } from "@whatsapp-flow/db/schema/device";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import { env } from "@whatsapp-flow/env/server";
import { and, eq, sql } from "drizzle-orm";
import type { ConnectionManagerEvents } from "../../types";
import { getMetaAppSecret } from "./transport";

type EmitDeviceMessage = (
	event: ConnectionManagerEvents["device:message"],
) => void;

type EmitInboxUpdated = (event: {
	deviceId: string;
	threadId?: string;
}) => void;

type MetaWebhookPayload = {
	entry?: {
		changes?: {
			value?: MetaWebhookValue;
		}[];
	}[];
};

type MetaWebhookValue = {
	metadata?: {
		display_phone_number?: string;
		phone_number_id?: string;
	};
	contacts?: {
		wa_id?: string;
		profile?: { name?: string };
	}[];
	messages?: MetaWebhookMessage[];
	statuses?: MetaWebhookStatus[];
};

type MetaWebhookMessage = {
	id?: string;
	from?: string;
	timestamp?: string;
	type?: string;
	text?: { body?: string };
	image?: {
		id?: string;
		caption?: string;
		mime_type?: string;
		sha256?: string;
	};
	video?: {
		id?: string;
		caption?: string;
		mime_type?: string;
		sha256?: string;
	};
	audio?: { id?: string; mime_type?: string; sha256?: string };
	document?: {
		id?: string;
		caption?: string;
		filename?: string;
		mime_type?: string;
		sha256?: string;
	};
	location?: {
		latitude?: number;
		longitude?: number;
		name?: string;
		address?: string;
	};
	button?: { text?: string; payload?: string };
	interactive?: {
		type?: string;
		button_reply?: { id?: string; title?: string };
		list_reply?: { id?: string; title?: string; description?: string };
	};
	reaction?: { message_id?: string; emoji?: string };
};

type MetaWebhookStatus = {
	id?: string;
	status?: string;
	timestamp?: string;
	errors?: {
		title?: string;
		message?: string;
		error_data?: { details?: string };
	}[];
};

export function verifyMetaWebhookChallenge(query: {
	mode?: string | null;
	verifyToken?: string | null;
	challenge?: string | null;
}) {
	const expected = env.META_WEBHOOK_VERIFY_TOKEN;
	if (!expected) return null;
	if (query.mode !== "subscribe" || !query.challenge || !query.verifyToken) {
		return null;
	}
	if (!safeEqual(query.verifyToken, expected)) return null;
	return query.challenge;
}

export async function handleMetaWebhook(input: {
	rawBody: string;
	signature: string | null;
	emitDeviceMessage: EmitDeviceMessage;
	emitInboxUpdated?: EmitInboxUpdated;
}) {
	const payload = JSON.parse(input.rawBody) as MetaWebhookPayload;
	const values = getWebhookValues(payload);
	let processed = 0;
	let statusUpdates = 0;

	console.info("Meta WhatsApp webhook received", { valueCount: values.length });

	for (const value of values) {
		const phoneNumberId = value.metadata?.phone_number_id;
		if (!phoneNumberId) continue;

		const deviceRow = await getMetaDeviceByPhoneNumberId(phoneNumberId);
		if (!deviceRow) {
			console.warn(
				"Meta WhatsApp webhook ignored for unknown phone number ID",
				{
					phoneNumberId,
				},
			);
			continue;
		}

		const appSecret =
			(await getMetaAppSecret(deviceRow.id)) ?? env.META_APP_SECRET;
		if (
			!appSecret ||
			!verifyMetaWebhookSignature(input.rawBody, input.signature, appSecret)
		) {
			console.warn("Meta WhatsApp webhook signature verification failed", {
				deviceId: deviceRow.id,
				phoneNumberId,
				hasSignature: Boolean(input.signature),
				hasAppSecret: Boolean(appSecret),
			});
			throw new Error("Invalid Meta webhook signature");
		}

		await db
			.update(device)
			.set({ lastWebhookAt: new Date() })
			.where(eq(device.id, deviceRow.id));

		const deliveryUpdates = await updateDeliveryStatuses(
			deviceRow.id,
			value.statuses ?? [],
		);
		statusUpdates += deliveryUpdates.count;
		for (const threadId of deliveryUpdates.threadIds) {
			input.emitInboxUpdated?.({ deviceId: deviceRow.id, threadId });
		}

		if (deviceRow.status !== "connected") {
			console.info(
				"Meta WhatsApp inbound messages ignored for disconnected device",
				{
					deviceId: deviceRow.id,
					phoneNumberId,
					status: deviceRow.status,
				},
			);
			continue;
		}

		const contacts = new Map(
			(value.contacts ?? [])
				.filter((contact) => contact.wa_id)
				.map((contact) => [contact.wa_id as string, contact.profile?.name]),
		);

		for (const message of value.messages ?? []) {
			const from = message.from;
			if (!from || !message.id) continue;
			const reserved = await reserveInboundMetaMessage({
				deviceId: deviceRow.id,
				from,
				contactName: contacts.get(from),
				message,
			});
			if (!reserved) {
				console.info("Meta WhatsApp duplicate message ignored", {
					deviceId: deviceRow.id,
					providerMessageId: message.id,
				});
				continue;
			}

			input.emitDeviceMessage({
				deviceId: deviceRow.id,
				provider: "meta_cloud",
				contact: {
					jid: toPhoneJid(from),
					number: from,
					name: contacts.get(from),
					providerContactId: from,
				},
				message: {
					text: extractMetaMessageText(message),
					type: message.type ?? "unknown",
					raw: message,
					providerMessageId: message.id,
				},
			});
			processed++;
		}
	}

	console.info("Meta WhatsApp webhook processed", {
		messageCount: processed,
		statusUpdateCount: statusUpdates,
	});

	return { processed };
}

export function verifyMetaWebhookSignature(
	rawBody: string,
	signatureHeader: string | null,
	appSecret: string,
) {
	const expectedPrefix = "sha256=";
	if (!signatureHeader?.startsWith(expectedPrefix)) return false;
	const received = signatureHeader.slice(expectedPrefix.length);
	const computed = createHmac("sha256", appSecret)
		.update(rawBody)
		.digest("hex");
	return safeEqual(received, computed);
}

async function getMetaDeviceByPhoneNumberId(phoneNumberId: string) {
	const [deviceRow] = await db
		.select({ id: device.id, status: device.status })
		.from(device)
		.where(
			and(
				eq(device.provider, "meta_cloud"),
				eq(device.externalId, phoneNumberId),
			),
		)
		.limit(1);

	return deviceRow ?? null;
}

function getWebhookValues(payload: MetaWebhookPayload) {
	const values: MetaWebhookValue[] = [];
	for (const entry of payload.entry ?? []) {
		for (const change of entry.changes ?? []) {
			if (change.value) values.push(change.value);
		}
	}
	return values;
}

async function updateDeliveryStatuses(
	deviceId: string,
	statuses: MetaWebhookStatus[],
) {
	let count = 0;
	const threadIds = new Set<string>();
	for (const status of statuses) {
		if (!status.id || !status.status) continue;
		const [messageRow] = await db
			.select({ id: inboxMessage.id, threadId: inboxMessage.threadId })
			.from(inboxMessage)
			.innerJoin(inboxThread, eq(inboxMessage.threadId, inboxThread.id))
			.where(
				and(
					eq(inboxThread.deviceId, deviceId),
					eq(inboxMessage.providerMessageId, status.id),
				),
			)
			.limit(1);
		if (!messageRow) continue;

		await db
			.update(inboxMessage)
			.set(statusToInboxUpdates(status))
			.where(eq(inboxMessage.id, messageRow.id));
		threadIds.add(messageRow.threadId);
		count++;
	}
	return { count, threadIds: [...threadIds] };
}

function statusToInboxUpdates(status: MetaWebhookStatus) {
	const at = status.timestamp
		? new Date(Number(status.timestamp) * 1000)
		: new Date();
	const error = status.errors?.[0];
	return {
		deliveryStatus: status.status,
		error: error?.error_data?.details ?? error?.message ?? error?.title ?? null,
		updatedAt: new Date(),
		...(status.status === "sent" ? { sentAt: at } : {}),
		...(status.status === "delivered" ? { deliveredAt: at } : {}),
		...(status.status === "read" ? { readAt: at } : {}),
	};
}

async function reserveInboundMetaMessage(input: {
	deviceId: string;
	from: string;
	contactName?: string;
	message: MetaWebhookMessage;
}) {
	const now = new Date();
	const chatJid = toPhoneJid(input.from);
	const text = extractMetaMessageText(input.message);
	const [savedContact] = await db
		.insert(contactTable)
		.values({
			id: crypto.randomUUID(),
			deviceId: input.deviceId,
			jid: chatJid,
			phoneNumber: input.from,
			name: input.contactName ?? null,
			pushName: input.contactName ?? null,
			profileName: input.contactName ?? null,
			providerContactId: input.from,
			source: "message",
		})
		.onConflictDoUpdate({
			target: [contactTable.deviceId, contactTable.jid],
			set: {
				phoneNumber: input.from,
				name: input.contactName ?? null,
				pushName: input.contactName ?? null,
				profileName: input.contactName ?? null,
				providerContactId: input.from,
				updatedAt: now,
			},
		})
		.returning({ id: contactTable.id });

	const [savedThread] = await db
		.insert(inboxThread)
		.values({
			id: crypto.randomUUID(),
			deviceId: input.deviceId,
			chatType: "private",
			chatJid,
			contactId: savedContact?.id ?? null,
			contactNumber: input.from,
			contactName: input.contactName ?? null,
			lastMessageText: text ?? `[${input.message.type ?? "unknown"}]`,
			lastMessageAt: now,
			unreadCount: 0,
		})
		.onConflictDoUpdate({
			target: [inboxThread.deviceId, inboxThread.chatJid],
			set: {
				chatType: "private",
				contactId: savedContact?.id ?? null,
				contactNumber: input.from,
				contactName: input.contactName ?? null,
			},
		})
		.returning({ id: inboxThread.id });

	const threadId = savedThread?.id;
	if (!threadId || !input.message.id) return false;

	const [insertedMessage] = await db
		.insert(inboxMessage)
		.values({
			id: crypto.randomUUID(),
			threadId,
			direction: "inbound",
			messageType: input.message.type ?? "unknown",
			text: text ?? null,
			providerMessageId: input.message.id,
			deliveryStatus: "received",
			raw: input.message as Record<string, unknown>,
		})
		.onConflictDoNothing()
		.returning({ id: inboxMessage.id });

	if (!insertedMessage) return false;

	await db
		.update(inboxThread)
		.set({
			lastMessageText: text ?? `[${input.message.type ?? "unknown"}]`,
			lastMessageAt: now,
			unreadCount: sql`${inboxThread.unreadCount} + 1`,
			updatedAt: now,
		})
		.where(eq(inboxThread.id, threadId));

	return true;
}

function extractMetaMessageText(message: MetaWebhookMessage) {
	return (
		message.text?.body ??
		message.image?.caption ??
		message.video?.caption ??
		message.document?.caption ??
		message.button?.text ??
		message.interactive?.button_reply?.title ??
		message.interactive?.list_reply?.title ??
		message.reaction?.emoji ??
		message.location?.name ??
		undefined
	);
}

function toPhoneJid(phoneNumber: string) {
	return `${phoneNumber}@s.whatsapp.net`;
}

function safeEqual(a: string, b: string) {
	const aBuffer = Buffer.from(a);
	const bBuffer = Buffer.from(b);
	if (aBuffer.length !== bBuffer.length) return false;
	return timingSafeEqual(aBuffer, bBuffer);
}
