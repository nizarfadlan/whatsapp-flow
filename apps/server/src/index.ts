import { timingSafeEqual } from "node:crypto";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@whatsapp-flow/api/context";
import {
	startFlowDispatcher,
	startScheduleDispatcher,
} from "@whatsapp-flow/api/engine/flow-dispatcher";
import { executeFlow } from "@whatsapp-flow/api/engine/flow-executor";
import { startWebhookDispatcher } from "@whatsapp-flow/api/engine/webhook-dispatcher";
import { appRouter } from "@whatsapp-flow/api/routers/index";
import { auth } from "@whatsapp-flow/auth";
import { createDb } from "@whatsapp-flow/db";
import {
	chatGroup,
	contact as contactTable,
} from "@whatsapp-flow/db/schema/contact";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import { env } from "@whatsapp-flow/env/server";
import { storage } from "@whatsapp-flow/storage";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		createContext: (_opts, context) => {
			return createContext({ context });
		},
	}),
);

// Serve locally stored media files
app.use(
	"/uploads/*",
	serveStatic({
		root: env.LOCAL_UPLOAD_DIR ?? "uploads",
		rewriteRequestPath: (p) => p.replace("/uploads", ""),
	}),
);

// Local-driver direct upload endpoint (POST multipart or raw body)
app.post("/api/uploads/local/:key{.+}", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.text("Unauthorized", 401);

	const key = c.req.param("key");
	const contentType =
		c.req.header("content-type") ?? "application/octet-stream";
	const arrayBuffer = await c.req.arrayBuffer();
	const data = new Uint8Array(arrayBuffer);
	const result = await storage.put(key, data, contentType);
	return c.json({ url: result.url, key: result.key });
});

app.post("/api/flows/:flowId/webhook", async (c) => {
	const flowId = c.req.param("flowId");
	const token = c.req.query("token") ?? c.req.header("x-webhook-token") ?? "";
	const body = await c.req.json().catch(() => null);
	const contactNumber = normalizeWebhookContact(body);
	if (!contactNumber) {
		return c.json({ error: "contactNumber is required" }, 400);
	}

	const db = createDb();
	const [flowRow] = await db
		.select()
		.from(flow)
		.where(
			and(
				eq(flow.id, flowId),
				eq(flow.status, "active"),
				eq(flow.triggerType, "webhook"),
			),
		)
		.limit(1);

	if (!flowRow) {
		return c.json({ error: "Webhook flow not found" }, 404);
	}

	if (!isValidWebhookToken(flowRow.triggerConfig, token)) {
		return c.json({ error: "Invalid webhook token" }, 401);
	}

	void executeFlow(flowRow, contactNumber, stringifyWebhookText(body), {
		triggerSource: "webhook",
	})
		.then((result) => {
			if (result.status === "failed") {
				console.error("Webhook flow execution failed", {
					flowId: flowRow.id,
					deviceId: flowRow.deviceId,
					contactNumber,
					logId: result.logId,
					error: result.error,
				});
			}
		})
		.catch((error: unknown) => {
			console.error("Webhook flow execution rejected", {
				flowId: flowRow.id,
				deviceId: flowRow.deviceId,
				contactNumber,
				error,
			});
		});
	return c.json({ success: true });
});

// SSE endpoint: real-time device events (QR code + status)
app.get("/api/devices/:deviceId/events", async (c) => {
	const deviceId = c.req.param("deviceId");

	// Verify session (SSE carries cookies)
	const session = await auth.api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) {
		return c.text("Unauthorized", 401);
	}

	// Verify device ownership
	const db = createDb();
	const [owned] = await db
		.select({ id: device.id })
		.from(device)
		.where(and(eq(device.id, deviceId), eq(device.userId, session.user.id)))
		.limit(1);
	if (!owned) {
		return c.text("Not Found", 404);
	}

	return streamSSE(c, async (stream) => {
		const onQr = (ev: { deviceId: string; qr: string }) => {
			if (ev.deviceId === deviceId) {
				stream.writeSSE({ data: JSON.stringify({ type: "qr", qr: ev.qr }) });
			}
		};

		const onStatus = (ev: {
			deviceId: string;
			status: string;
			phoneNumber?: string;
		}) => {
			if (ev.deviceId === deviceId) {
				stream.writeSSE({
					data: JSON.stringify({
						type: "status",
						status: ev.status,
						phoneNumber: ev.phoneNumber,
					}),
				});
			}
		};

		connectionManager.on("device:qr", onQr);
		connectionManager.on("device:status", onStatus);

		// Send current state immediately
		const conn = connectionManager.getConnection(deviceId);
		if (conn?.qrCode) {
			stream.writeSSE({
				data: JSON.stringify({ type: "qr", qr: conn.qrCode }),
			});
		}
		stream.writeSSE({
			data: JSON.stringify({
				type: "status",
				status: conn?.status ?? "disconnected",
			}),
		});

		const ping = setInterval(() => {
			stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
		}, 30_000);

		stream.onAbort(() => {
			connectionManager.off("device:qr", onQr);
			connectionManager.off("device:status", onStatus);
			clearInterval(ping);
		});

		// Wait indefinitely until client disconnects
		await new Promise<void>((resolve) => {
			stream.onAbort(() => resolve());
		});
	});
});

// Global SSE endpoint: all device events for user
app.get("/api/events", async (c) => {
	const session = await auth.api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) {
		return c.text("Unauthorized", 401);
	}

	const db = createDb();
	const userDevices = await db
		.select({ id: device.id })
		.from(device)
		.where(eq(device.userId, session.user.id));

	const deviceIds = new Set(userDevices.map((d) => d.id));

	return streamSSE(c, async (stream) => {
		const onQr = (ev: { deviceId: string; qr: string }) => {
			if (deviceIds.has(ev.deviceId)) {
				stream.writeSSE({
					data: JSON.stringify({
						type: "qr",
						deviceId: ev.deviceId,
						qr: ev.qr,
					}),
				});
			}
		};

		const onStatus = (ev: {
			deviceId: string;
			status: string;
			phoneNumber?: string;
		}) => {
			if (deviceIds.has(ev.deviceId)) {
				stream.writeSSE({
					data: JSON.stringify({
						type: "status",
						deviceId: ev.deviceId,
						status: ev.status,
						phoneNumber: ev.phoneNumber,
					}),
				});
			}
		};

		const onInboxUpdated = (ev: { deviceId: string; threadId?: string }) => {
			if (deviceIds.has(ev.deviceId)) {
				stream.writeSSE({
					data: JSON.stringify({
						type: "inbox:message",
						deviceId: ev.deviceId,
						threadId: ev.threadId,
					}),
				});
			}
		};

		const onFlowLogUpdated = (ev: {
			logId: string;
			flowId: string;
			deviceId: string;
		}) => {
			if (deviceIds.has(ev.deviceId)) {
				stream.writeSSE({
					data: JSON.stringify({
						type: "flow:log:updated",
						logId: ev.logId,
						flowId: ev.flowId,
						deviceId: ev.deviceId,
					}),
				});
			}
		};

		connectionManager.on("device:qr", onQr);
		connectionManager.on("device:status", onStatus);
		connectionManager.on("inbox:updated", onInboxUpdated);
		connectionManager.on("flow:log:updated", onFlowLogUpdated);

		const ping = setInterval(() => {
			stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
		}, 30_000);

		stream.onAbort(() => {
			connectionManager.off("device:qr", onQr);
			connectionManager.off("device:status", onStatus);
			connectionManager.off("inbox:updated", onInboxUpdated);
			connectionManager.off("flow:log:updated", onFlowLogUpdated);
			clearInterval(ping);
		});

		await new Promise<void>((resolve) => {
			stream.onAbort(() => resolve());
		});
	});
});

app.get("/", (c) => {
	return c.text("OK");
});

const db = createDb();

// Persist incoming WhatsApp messages to contacts/groups + inbox
connectionManager.on("device:message", async (ev) => {
	try {
		const { deviceId, contact, message } = ev;
		let chatType: "private" | "group" | "channel" | "broadcast" = "private";
		if (contact.jid.endsWith("@g.us")) {
			chatType = "group";
		} else if (contact.jid.endsWith("@newsletter")) {
			chatType = "channel";
		} else if (contact.jid.endsWith("@broadcast")) {
			chatType = "broadcast";
		}
		const now = new Date();
		let contactId: string | null = null;
		let groupId: string | null = null;

		if (chatType === "private") {
			const [savedContact] = await db
				.insert(contactTable)
				.values({
					id: crypto.randomUUID(),
					deviceId,
					jid: contact.jid,
					phoneNumber: contact.number,
					name: contact.name ?? null,
					pushName: contact.name ?? null,
					source: "message",
				})
				.onConflictDoUpdate({
					target: [contactTable.deviceId, contactTable.jid],
					set: {
						phoneNumber: contact.number,
						name: contact.name ?? null,
						pushName: contact.name ?? null,
						updatedAt: now,
					},
				})
				.returning({ id: contactTable.id });
			contactId = savedContact?.id ?? null;
		} else if (chatType === "group") {
			const [savedGroup] = await db
				.insert(chatGroup)
				.values({
					id: crypto.randomUUID(),
					deviceId,
					jid: contact.jid,
					subject: contact.name ?? contact.jid,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [chatGroup.deviceId, chatGroup.jid],
					set: {
						subject: contact.name ?? contact.jid,
						updatedAt: now,
					},
				})
				.returning({ id: chatGroup.id });
			groupId = savedGroup?.id ?? null;
		}

		const [savedThread] = await db
			.insert(inboxThread)
			.values({
				id: crypto.randomUUID(),
				deviceId,
				chatType,
				chatJid: contact.jid,
				contactId,
				groupId,
				groupJid: chatType === "group" ? contact.jid : null,
				contactNumber: chatType === "private" ? contact.number : null,
				contactName: contact.name ?? null,
				lastMessageText: message.text ?? null,
				lastMessageAt: now,
				unreadCount: 1,
			})
			.onConflictDoUpdate({
				target: [inboxThread.deviceId, inboxThread.chatJid],
				set: {
					chatType,
					contactId,
					groupId,
					groupJid: chatType === "group" ? contact.jid : null,
					contactNumber: chatType === "private" ? contact.number : null,
					contactName: Object.hasOwn(contact, "name")
						? (contact.name ?? null)
						: undefined, // undefined skips updating if not present in payload
					lastMessageText: message.text ?? null,
					lastMessageAt: now,
					unreadCount: sql`${inboxThread.unreadCount} + 1`,
				},
			})
			.returning({ id: inboxThread.id });

		const threadId = savedThread?.id;

		if (threadId) {
			await db.insert(inboxMessage).values({
				id: crypto.randomUUID(),
				threadId,
				direction: "inbound",
				messageType: message.type,
				text: message.text ?? null,
				raw: message.raw as Record<string, unknown> | null,
			});
			connectionManager.emit("inbox:updated", { deviceId, threadId });
		}
	} catch (err) {
		console.error("Failed to persist inbox message", err);
	}
});

connectionManager.on("device:contacts", async (ev) => {
	try {
		const now = new Date();
		for (const item of ev.contacts) {
			await db
				.insert(contactTable)
				.values({
					id: crypto.randomUUID(),
					deviceId: ev.deviceId,
					jid: item.jid,
					phoneNumber: item.phoneNumber ?? null,
					name: item.name ?? null,
					pushName: item.pushName ?? null,
					isWaContact: item.isWaContact ?? true,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [contactTable.deviceId, contactTable.jid],
					set: {
						phoneNumber: item.phoneNumber ?? null,
						name: item.name ?? null,
						pushName: item.pushName ?? null,
						isWaContact: item.isWaContact ?? true,
						updatedAt: now,
					},
				});
		}
	} catch (err) {
		console.error("Failed to persist contacts sync", err);
	}
});

connectionManager.on("device:groups", async (ev) => {
	try {
		const now = new Date();
		for (const item of ev.groups) {
			await db
				.insert(chatGroup)
				.values({
					id: crypto.randomUUID(),
					deviceId: ev.deviceId,
					jid: item.jid,
					subject: item.subject,
					description: item.description ?? null,
					ownerJid: item.ownerJid ?? null,
					participantCount: item.participantCount ?? 0,
					isMember: item.isMember ?? true,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [chatGroup.deviceId, chatGroup.jid],
					set: {
						subject: item.subject,
						description: item.description ?? null,
						ownerJid: item.ownerJid ?? null,
						participantCount: item.participantCount ?? 0,
						isMember: item.isMember ?? true,
						updatedAt: now,
					},
				});
		}
	} catch (err) {
		console.error("Failed to persist groups sync", err);
	}
});

async function reconnectDevices() {
	const reconnectable = await db
		.select({ id: device.id })
		.from(device)
		.where(or(eq(device.status, "connected"), isNotNull(device.sessionData)));

	for (const d of reconnectable) {
		void connectionManager.connect(d.id);
	}
}

function normalizeWebhookContact(body: unknown) {
	if (!body || typeof body !== "object") return "";
	const value =
		"contactNumber" in body
			? body.contactNumber
			: "phoneNumber" in body
				? body.phoneNumber
				: "number" in body
					? body.number
					: null;
	return typeof value === "string" ? value.replace(/[^\d]/g, "") : "";
}

function stringifyWebhookText(body: unknown) {
	if (!body || typeof body !== "object") return "";
	if ("text" in body && typeof body.text === "string") return body.text;
	if ("message" in body && typeof body.message === "string")
		return body.message;
	return JSON.stringify(body);
}

function isValidWebhookToken(triggerConfig: unknown, token: string) {
	if (!triggerConfig || typeof triggerConfig !== "object") return false;
	if (!("webhookToken" in triggerConfig)) return false;
	const expected = triggerConfig.webhookToken;
	if (typeof expected !== "string" || expected.length === 0) return false;
	const tokenBuffer = Buffer.from(token);
	const expectedBuffer = Buffer.from(expected);
	if (tokenBuffer.length !== expectedBuffer.length) return false;
	return timingSafeEqual(tokenBuffer, expectedBuffer);
}

void reconnectDevices();
startFlowDispatcher();
startScheduleDispatcher();
startWebhookDispatcher();

export default app;
