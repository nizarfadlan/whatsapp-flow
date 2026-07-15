import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

type SelectQueue = unknown[][];

let selectQueue: SelectQueue = [];

mock.module("@whatsapp-flow/db", () => ({
	db: {
		select: () => ({
			from() {
				return this;
			},
			innerJoin() {
				return this;
			},
			where() {
				return this;
			},
			orderBy() {
				return this;
			},
			limit() {
				return Promise.resolve(selectQueue.shift() ?? []);
			},
		}),
	},
}));

const { buildMessageReceivedPayload, buildWebhookDeliveryRows } = await import(
	"./webhook-dispatcher"
);

type WebhookEndpoint = Parameters<typeof buildWebhookDeliveryRows>[1][number];

function webhookEndpoint(
	input: Partial<WebhookEndpoint> = {},
): WebhookEndpoint {
	return {
		id: "endpoint_1",
		subscribedEvents: ["*"],
		deviceIds: [],
		flowIds: [],
		...input,
	} as WebhookEndpoint;
}

beforeEach(() => {
	selectQueue = [];
});

describe("lazy webhook payload evaluation", () => {
	test("does not build a payload when no endpoint matches", async () => {
		const payloadFactory = mock(() => Promise.resolve({ message: "unused" }));

		const rows = await buildWebhookDeliveryRows(
			{
				userId: "user_1",
				deviceId: "device_1",
				eventType: "message.received",
				payload: payloadFactory,
			},
			[],
			"delivery",
		);

		expect(rows).toEqual([]);
		expect(payloadFactory).toHaveBeenCalledTimes(0);
	});

	test("builds one payload for all matching endpoints", async () => {
		const payloadFactory = mock(() => Promise.resolve({ message: "hello" }));

		const rows = await buildWebhookDeliveryRows(
			{
				userId: "user_1",
				deviceId: "device_1",
				eventType: "message.received",
				payload: payloadFactory,
			},
			[
				webhookEndpoint({ id: "endpoint_1" }),
				webhookEndpoint({ id: "endpoint_2" }),
			],
			"delivery",
		);

		expect(payloadFactory).toHaveBeenCalledTimes(1);
		expect(rows).toEqual([
			{
				id: "delivery-0",
				endpointId: "endpoint_1",
				eventType: "message.received",
				payload: { message: "hello" },
				status: "pending",
			},
			{
				id: "delivery-1",
				endpointId: "endpoint_2",
				eventType: "message.received",
				payload: { message: "hello" },
				status: "pending",
			},
		]);
	});
});

describe("message.received webhook payload contract", () => {
	test("keeps compatibility fields and adds private chat/sender context", async () => {
		selectQueue = [
			[
				{
					jid: "6281234567890@s.whatsapp.net",
					identityKey: "phone:6281234567890",
					phoneNumber: "6281234567890",
					lid: null,
					name: "Customer",
					pushName: "Customer Push",
					profileName: null,
					providerContactId: "6281234567890",
				},
			],
			[
				{
					jid: "6281234567890@s.whatsapp.net",
					identityKey: "phone:6281234567890",
					phoneNumber: "6281234567890",
					lid: null,
					name: "Customer",
					pushName: "Customer Push",
					profileName: null,
					providerContactId: "6281234567890",
				},
			],
		];

		const payload = await buildMessageReceivedPayload({
			deviceId: "dev_123",
			inboxMessageId: "inbox_1",
			threadId: "thread_1",
			provider: "baileys",
			contact: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
				name: "Customer",
			},
			chat: {
				jid: "6281234567890@s.whatsapp.net",
				type: "private",
				isGroup: false,
			},
			sender: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
				name: "Customer",
			},
			message: {
				text: "Hi",
				type: "conversation",
				raw: { message: { conversation: "Hi" } },
				messageKey: {
					id: "ABCD1234",
					remoteJid: "6281234567890@s.whatsapp.net",
					fromMe: false,
				},
				providerMessageId: "ABCD1234",
			},
		});

		expect(payload).toMatchObject({
			eventType: "message.received",
			deviceId: "dev_123",
			provider: "baileys",
			contact: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
				phoneNumber: "6281234567890",
				identityKey: "phone:6281234567890",
				identifier: "phone:6281234567890",
				resolved: true,
			},
			chat: {
				jid: "6281234567890@s.whatsapp.net",
				type: "private",
				isGroup: false,
			},
			sender: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
				phoneNumber: "6281234567890",
				identityKey: "phone:6281234567890",
				name: "Customer",
				identifier: "phone:6281234567890",
				resolved: true,
			},
			message: {
				type: "conversation",
				text: "Hi",
				providerMessageId: "ABCD1234",
				messageKey: {
					id: "ABCD1234",
					remoteJid: "6281234567890@s.whatsapp.net",
					fromMe: false,
				},
			},
		});
		expect("group" in payload).toBe(true);
		expect(payload.group).toBeUndefined();
	});

	test("adds group sender participant data without using sender name as group name", async () => {
		selectQueue = [
			[],
			[
				{
					jid: "6281234567890@s.whatsapp.net",
					identityKey: "phone:6281234567890",
					phoneNumber: "6281234567890",
					lid: null,
					name: "Sender Name",
					pushName: null,
					profileName: null,
					providerContactId: null,
				},
			],
			[
				{
					id: "group_1",
					subject: "Support Group",
					participantCount: 42,
				},
			],
			[{ role: "admin" }],
		];

		const payload = await buildMessageReceivedPayload({
			deviceId: "dev_123",
			inboxMessageId: "inbox_1",
			threadId: "thread_1",
			provider: "baileys",
			contact: {
				jid: "120363000000000000@g.us",
			},
			chat: {
				jid: "120363000000000000@g.us",
				type: "group",
				isGroup: true,
			},
			sender: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
				name: "Sender Name",
			},
			group: {
				jid: "120363000000000000@g.us",
				name: "120363000000000000@g.us",
			},
			message: {
				text: "Group hello",
				type: "conversation",
				raw: { message: { conversation: "Group hello" } },
				messageKey: {
					id: "MSG1",
					remoteJid: "120363000000000000@g.us",
					participant: "6281234567890@s.whatsapp.net",
					fromMe: false,
				},
				providerMessageId: "MSG1",
			},
		});

		expect(payload.group).toMatchObject({
			jid: "120363000000000000@g.us",
			name: "Support Group",
			participantCount: 42,
			senderParticipant: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
				phoneNumber: "6281234567890",
				identityKey: "phone:6281234567890",
				name: "Sender Name",
				role: "admin",
				identifier: "phone:6281234567890",
			},
		});
		expect(payload.group?.name).not.toBe("Sender Name");
		expect(payload.group?.name).not.toBe("120363000000000000@g.us");
	});

	test("keeps unresolved LID mentions as fallback identifiers", async () => {
		selectQueue = [
			[],
			[],
			[
				{
					id: "group_1",
					subject: "Support Group",
					participantCount: 10,
				},
			],
			[],
			[],
			[],
		];

		const payload = await buildMessageReceivedPayload({
			deviceId: "dev_123",
			inboxMessageId: "inbox_1",
			threadId: "thread_1",
			provider: "baileys",
			contact: { jid: "120363000000000000@g.us" },
			chat: {
				jid: "120363000000000000@g.us",
				type: "group",
				isGroup: true,
			},
			sender: { jid: "6281234567890@s.whatsapp.net" },
			message: {
				text: "Halo @user",
				type: "extendedTextMessage",
				raw: {
					message: {
						extendedTextMessage: {
							text: "Halo @user",
							contextInfo: {
								mentionedJid: ["6289999999999@s.whatsapp.net", "987654321@lid"],
							},
						},
					},
				},
				messageKey: {
					id: "MSG2",
					remoteJid: "120363000000000000@g.us",
					participant: "6281234567890@s.whatsapp.net",
					fromMe: false,
				},
				providerMessageId: "MSG2",
			},
		});

		expect(payload.message.mentions).toEqual([
			expect.objectContaining({
				jid: "6289999999999@s.whatsapp.net",
				number: "6289999999999",
				phoneNumber: "6289999999999",
				identityKey: "phone:6289999999999",
				identifier: "phone:6289999999999",
				resolved: false,
			}),
			expect.objectContaining({
				jid: "987654321@lid",
				lid: "987654321@lid",
				identityKey: "lid:987654321@lid",
				identifier: "lid:987654321@lid",
				resolved: false,
			}),
		]);
	});

	test("uses the canonical media descriptor from persisted raw", async () => {
		selectQueue = [
			[
				{
					jid: "6281234567890@s.whatsapp.net",
					identityKey: "phone:6281234567890",
					phoneNumber: "6281234567890",
					lid: null,
					name: "Customer",
					pushName: null,
					profileName: null,
					providerContactId: "6281234567890",
				},
			],
		];
		const media = {
			type: "image" as const,
			providerMediaId: "media_123",
			mimeType: "image/jpeg",
			fileName: "media_123.jpeg",
			caption: "Payment proof",
			size: 204800,
			sha256: "hash",
			stored: true,
			storage: {
				driver: "s3" as const,
				key: "whatsapp/meta/dev_123/wamid.x/media_123.jpeg",
				url: "https://cdn.example.com/media_123.jpeg",
			},
		};

		const payload = await buildMessageReceivedPayload({
			deviceId: "dev_123",
			inboxMessageId: "inbox_1",
			threadId: "thread_1",
			provider: "meta_cloud",
			contact: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
				providerContactId: "6281234567890",
			},
			chat: {
				jid: "6281234567890@s.whatsapp.net",
				type: "private",
				isGroup: false,
			},
			sender: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
				providerContactId: "6281234567890",
			},
			message: {
				text: "Payment proof",
				type: "image",
				raw: { image: { id: "media_123" }, media },
				providerMessageId: "wamid.x",
			},
		});

		expect(payload.message.media).toEqual(media);
	});

	test("keeps canonical media errors in payload instead of dropping the message", async () => {
		const payload = await buildMessageReceivedPayload({
			deviceId: "dev_123",
			inboxMessageId: "inbox_1",
			threadId: "thread_1",
			provider: "meta_cloud",
			contact: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
			},
			chat: {
				jid: "6281234567890@s.whatsapp.net",
				type: "private",
				isGroup: false,
			},
			sender: {
				jid: "6281234567890@s.whatsapp.net",
				number: "6281234567890",
			},
			message: {
				type: "document",
				raw: {
					document: { id: "media_404" },
					media: {
						type: "document",
						providerMediaId: "media_404",
						mimeType: "application/pdf",
						fileName: "invoice.pdf",
						stored: false,
						storage: null,
						storageError: "Failed to download media",
					},
				},
				providerMessageId: "wamid.y",
			},
		});

		expect(payload.message.media).toMatchObject({
			type: "document",
			providerMediaId: "media_404",
			stored: false,
			storage: null,
			storageError: "Failed to download media",
		});
	});
});
