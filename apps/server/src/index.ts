import { timingSafeEqual } from "node:crypto";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@whatsapp-flow/api/context";
import {
	startFlowDispatcher,
	startScheduleDispatcher,
} from "@whatsapp-flow/api/engine/flow-dispatcher";
import { executeFlow } from "@whatsapp-flow/api/engine/flow-executor";
import {
	processFlowContinueJob,
	processFlowExecuteJob,
	processFlowResumeJob,
	processFlowWaitWarningJob,
} from "@whatsapp-flow/api/engine/flow-jobs";
import { enrichInboundMedia } from "@whatsapp-flow/api/engine/inbound-media";
import { startJobWorker } from "@whatsapp-flow/api/engine/job-queue";
import {
	processWebhookDeliveryJob,
	startWebhookDispatcher,
} from "@whatsapp-flow/api/engine/webhook-dispatcher";
import { renderMetrics } from "@whatsapp-flow/api/observability/metrics";
import { seedRbac } from "@whatsapp-flow/api/rbac";
import { appRouter } from "@whatsapp-flow/api/routers/index";
import { auth } from "@whatsapp-flow/auth";
import { createDb } from "@whatsapp-flow/db";
import { user } from "@whatsapp-flow/db/schema/auth";
import {
	channel,
	chatGroup,
	contact as contactTable,
	groupParticipant,
} from "@whatsapp-flow/db/schema/contact";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import { env } from "@whatsapp-flow/env/server";
import { isLocalStorageDriver, storage } from "@whatsapp-flow/storage";
import {
	connectionManager,
	handleMetaWebhook,
	verifyMetaWebhookChallenge,
} from "@whatsapp-flow/whatsapp";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { Hono, type Context as HonoContext } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";

function validateProductionSecrets() {
	if (env.NODE_ENV !== "production") return;
	const key = env.SETTINGS_ENCRYPTION_KEY;
	if (!key) {
		throw new Error("SETTINGS_ENCRYPTION_KEY is required in production");
	}
	if (Buffer.from(key, "base64").length !== 32) {
		throw new Error(
			"SETTINGS_ENCRYPTION_KEY must be a base64-encoded 32-byte key in production",
		);
	}
}

validateProductionSecrets();

const app = new Hono();

async function requireActiveSession(c: HonoContext) {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return { response: c.text("Unauthorized", 401) };

	const db = createDb();
	const [currentUser] = await db
		.select({ id: user.id, status: user.status })
		.from(user)
		.where(eq(user.id, session.user.id))
		.limit(1);
	if (!currentUser) return { response: c.text("Unauthorized", 401) };
	if (currentUser.status === "suspended") {
		return { response: c.text("Account suspended", 403) };
	}

	return { session, db };
}

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
	if (!isLocalStorageDriver()) {
		return c.text("Local uploads are disabled", 404);
	}

	const authResult = await requireActiveSession(c);
	if (authResult.response) return authResult.response;

	const key = c.req.param("key");
	const contentType =
		c.req.header("content-type") ?? "application/octet-stream";
	const arrayBuffer = await c.req.arrayBuffer();
	const data = new Uint8Array(arrayBuffer);
	const result = await storage.put(key, data, contentType);
	return c.json({ url: result.url, key: result.key });
});

app.get("/api/whatsapp/meta/webhook", (c) => {
	const challenge = verifyMetaWebhookChallenge({
		mode: c.req.query("hub.mode"),
		verifyToken: c.req.query("hub.verify_token"),
		challenge: c.req.query("hub.challenge"),
	});

	return challenge ? c.text(challenge) : c.text("Forbidden", 403);
});

app.post("/api/whatsapp/meta/webhook", async (c) => {
	const rawBody = await c.req.text();
	try {
		await handleMetaWebhook({
			rawBody,
			signature: c.req.header("x-hub-signature-256") ?? null,
			emitDeviceMessage: (event) =>
				connectionManager.emit("device:message", event),
			emitInboxUpdated: (event) =>
				connectionManager.emit("inbox:updated", event),
		});
		return c.text("OK");
	} catch (error) {
		console.error("Failed to process Meta WhatsApp webhook", error);
		return c.text("Unauthorized", 401);
	}
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

	// Verify active session (SSE carries cookies)
	const authResult = await requireActiveSession(c);
	if (authResult.response) return authResult.response;

	// Verify device ownership
	const { db, session } = authResult;
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
	const authResult = await requireActiveSession(c);
	if (authResult.response) return authResult.response;

	const { db, session } = authResult;
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

		const onFlowSessionUpdated = (ev: {
			sessionId: string;
			flowId: string;
			deviceId: string;
			executionLogId: string;
			contactNumber: string;
			status: string;
		}) => {
			if (deviceIds.has(ev.deviceId)) {
				stream.writeSSE({
					data: JSON.stringify({
						type: "flow:session:updated",
						sessionId: ev.sessionId,
						flowId: ev.flowId,
						deviceId: ev.deviceId,
						executionLogId: ev.executionLogId,
						contactNumber: ev.contactNumber,
						status: ev.status,
					}),
				});
			}
		};

		connectionManager.on("device:qr", onQr);
		connectionManager.on("device:status", onStatus);
		connectionManager.on("inbox:updated", onInboxUpdated);
		connectionManager.on("flow:log:updated", onFlowLogUpdated);
		connectionManager.on("flow:session:updated", onFlowSessionUpdated);

		const ping = setInterval(() => {
			stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
		}, 30_000);

		stream.onAbort(() => {
			connectionManager.off("device:qr", onQr);
			connectionManager.off("device:status", onStatus);
			connectionManager.off("inbox:updated", onInboxUpdated);
			connectionManager.off("flow:log:updated", onFlowLogUpdated);
			connectionManager.off("flow:session:updated", onFlowSessionUpdated);
			clearInterval(ping);
		});

		await new Promise<void>((resolve) => {
			stream.onAbort(() => resolve());
		});
	});
});

app.get("/metrics", (c) => {
	if (env.NODE_ENV === "production") {
		if (!env.METRICS_TOKEN)
			return c.text("Metrics token is not configured", 503);
		const authorization = c.req.header("authorization") ?? "";
		const token = authorization.startsWith("Bearer ")
			? authorization.slice("Bearer ".length)
			: "";
		if (!safeEqual(token, env.METRICS_TOKEN))
			return c.text("Unauthorized", 401);
	}

	return c.text(renderMetrics(), 200, {
		"content-type": "text/plain; version=0.0.4; charset=utf-8",
	});
});

app.get("/", (c) => {
	return c.text("OK");
});

const db = createDb();
void seedRbac(db).catch((error) => {
	console.error("Failed to seed RBAC", error);
});

// Persist incoming WhatsApp messages to contacts/groups + inbox
connectionManager.on("device:message", async (ev) => {
	try {
		const { deviceId, contact, message } = ev;
		if (
			contact.jid === "status@broadcast" ||
			message.messageKey?.remoteJid === "status@broadcast"
		) {
			return;
		}

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
		let channelId: string | null = null;

		if (chatType === "private") {
			const [savedContact] = await db
				.insert(contactTable)
				.values({
					id: crypto.randomUUID(),
					deviceId,
					jid: contact.jid,
					phoneNumber: contact.number ?? null,
					lid: contact.lid ?? null,
					name: contact.name ?? null,
					pushName: contact.name ?? null,
					profileName: contact.name ?? null,
					providerContactId:
						contact.providerContactId ?? contact.number ?? null,
					source: "message",
				})
				.onConflictDoUpdate({
					target: [contactTable.deviceId, contactTable.jid],
					set: {
						phoneNumber: contact.number ?? null,
						lid: contact.lid ?? null,
						name: contact.name ?? null,
						pushName: contact.name ?? null,
						profileName: contact.name ?? null,
						providerContactId:
							contact.providerContactId ?? contact.number ?? null,
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
		} else if (chatType === "channel") {
			const [savedChannel] = await db
				.insert(channel)
				.values({
					id: crypto.randomUUID(),
					deviceId,
					jid: contact.jid,
					name: contact.name ?? contact.jid,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [channel.deviceId, channel.jid],
					set: {
						name: contact.name ?? contact.jid,
						updatedAt: now,
					},
				})
				.returning({ id: channel.id });
			channelId = savedChannel?.id ?? null;
		}

		if (chatType === "group" && groupId) {
			await upsertGroupParticipantSender(
				groupId,
				ev.sender?.jid ?? message.messageKey?.participant,
				now,
			);
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
				channelId,
				groupJid: chatType === "group" ? contact.jid : null,
				channelJid: chatType === "channel" ? contact.jid : null,
				contactNumber: chatType === "private" ? (contact.number ?? null) : null,
				contactName: contact.name ?? null,
				lastMessageText: message.text ?? `[${message.type}]`,
				lastMessageAt: now,
				unreadCount: 0,
			})
			.onConflictDoUpdate({
				target: [inboxThread.deviceId, inboxThread.chatJid],
				set: {
					chatType,
					contactId,
					groupId,
					channelId,
					groupJid: chatType === "group" ? contact.jid : null,
					channelJid: chatType === "channel" ? contact.jid : null,
					contactNumber:
						chatType === "private" ? (contact.number ?? null) : null,
					contactName: Object.hasOwn(contact, "name")
						? (contact.name ?? null)
						: undefined, // undefined skips updating if not present in payload
				},
			})
			.returning({ id: inboxThread.id });

		const threadId = savedThread?.id;

		if (threadId) {
			const mediaResult = await enrichInboundMedia({
				deviceId,
				provider: ev.provider ?? "baileys",
				providerMessageId: message.providerMessageId,
				messageType: message.type,
				raw: message.raw,
			});
			const messageRaw = mediaResult.raw;
			const [insertedMessage] = await db
				.insert(inboxMessage)
				.values({
					id: crypto.randomUUID(),
					threadId,
					direction: "inbound",
					messageType: message.type,
					text: message.text ?? null,
					providerMessageId: message.providerMessageId ?? null,
					deliveryStatus: "received",
					raw: messageRaw,
				})
				.onConflictDoNothing()
				.returning({ id: inboxMessage.id });

			if (!insertedMessage) {
				if (message.providerMessageId && messageRaw) {
					await db
						.update(inboxMessage)
						.set({ raw: messageRaw, updatedAt: now })
						.where(
							and(
								eq(inboxMessage.threadId, threadId),
								eq(inboxMessage.providerMessageId, message.providerMessageId),
							),
						);
					connectionManager.emit("inbox:updated", { deviceId, threadId });
				}
				console.info("Duplicate inbound WhatsApp message ignored", {
					deviceId,
					threadId,
					providerMessageId: message.providerMessageId,
				});
				return;
			}

			await db
				.update(inboxThread)
				.set({
					lastMessageText: message.text ?? `[${message.type}]`,
					lastMessageAt: now,
					unreadCount: sql`${inboxThread.unreadCount} + 1`,
					updatedAt: now,
				})
				.where(eq(inboxThread.id, threadId));
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
					lid: item.lid ?? null,
					name: item.name ?? null,
					pushName: item.pushName ?? null,
					isWaContact: item.isWaContact ?? true,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [contactTable.deviceId, contactTable.jid],
					set: {
						phoneNumber: item.phoneNumber ?? null,
						lid: item.lid ?? null,
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
			const [savedGroup] = await db
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
						subject: item.subject === item.jid ? undefined : item.subject,
						description: item.description ?? undefined,
						ownerJid: item.ownerJid ?? undefined,
						participantCount: item.participantCount,
						isMember: item.isMember ?? true,
						updatedAt: now,
					},
				})
				.returning({ id: chatGroup.id });
			if (savedGroup) {
				await upsertGroupParticipantsFromRaw(savedGroup.id, item.raw, now);
			}
		}
	} catch (err) {
		console.error("Failed to persist groups sync", err);
	}
});

connectionManager.on("device:channels", async (ev) => {
	try {
		const now = new Date();
		for (const item of ev.channels) {
			await db
				.insert(channel)
				.values({
					id: crypto.randomUUID(),
					deviceId: ev.deviceId,
					jid: item.jid,
					name: item.name,
					description: item.description ?? null,
					ownerJid: item.ownerJid ?? null,
					subscribersCount: item.subscribersCount ?? 0,
					isSubscribed: item.isSubscribed ?? true,
					verificationStatus: item.verificationStatus ?? null,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [channel.deviceId, channel.jid],
					set: {
						name: item.name,
						description: item.description ?? null,
						ownerJid: item.ownerJid ?? null,
						subscribersCount: item.subscribersCount ?? 0,
						isSubscribed: item.isSubscribed ?? true,
						verificationStatus: item.verificationStatus ?? null,
						updatedAt: now,
					},
				});
		}
	} catch (err) {
		console.error("Failed to persist channels sync", err);
	}
});

async function upsertGroupParticipantSender(
	groupId: string,
	jid: string | null | undefined,
	now: Date,
) {
	if (!jid) return;
	await db
		.insert(groupParticipant)
		.values({
			id: crypto.randomUUID(),
			groupId,
			jid,
			role: "member",
		})
		.onConflictDoUpdate({
			target: [groupParticipant.groupId, groupParticipant.jid],
			set: { updatedAt: now },
		});
}

async function upsertGroupParticipantsFromRaw(
	groupId: string,
	raw: unknown,
	now: Date,
) {
	if (!raw || typeof raw !== "object") return;
	const participants = (raw as Record<string, unknown>).participants;
	if (!Array.isArray(participants)) return;

	for (const participant of participants) {
		if (!participant || typeof participant !== "object") continue;
		const record = participant as Record<string, unknown>;
		const jid =
			typeof record.id === "string"
				? record.id
				: typeof record.jid === "string"
					? record.jid
					: undefined;
		if (!jid) continue;
		const admin = typeof record.admin === "string" ? record.admin : undefined;
		const role =
			admin === "superadmin"
				? "superadmin"
				: admin === "admin"
					? "admin"
					: "member";
		await db
			.insert(groupParticipant)
			.values({
				id: crypto.randomUUID(),
				groupId,
				jid,
				role,
			})
			.onConflictDoUpdate({
				target: [groupParticipant.groupId, groupParticipant.jid],
				set: { role, updatedAt: now },
			});
	}
}

async function reconnectDevices() {
	const reconnectable = await db
		.select({ id: device.id })
		.from(device)
		.where(
			and(
				eq(device.provider, "baileys"),
				or(eq(device.status, "connected"), isNotNull(device.sessionData)),
			),
		);

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

function safeEqual(value: string, expected: string) {
	const valueBuffer = Buffer.from(value);
	const expectedBuffer = Buffer.from(expected);
	if (valueBuffer.length !== expectedBuffer.length) return false;
	return timingSafeEqual(valueBuffer, expectedBuffer);
}

function isValidWebhookToken(triggerConfig: unknown, token: string) {
	if (!triggerConfig || typeof triggerConfig !== "object") return false;
	if (!("webhookToken" in triggerConfig)) return false;
	const expected = triggerConfig.webhookToken;
	if (typeof expected !== "string" || expected.length === 0) return false;
	return safeEqual(token, expected);
}

void reconnectDevices();
startFlowDispatcher();
startScheduleDispatcher();
startWebhookDispatcher();
startJobWorker({
	handlers: {
		"flow.continue": (job) => processFlowContinueJob(job.payload),
		"flow.execute": (job) => processFlowExecuteJob(job.payload),
		"flow.resume": (job) => processFlowResumeJob(job.payload),
		"flow.wait_warning": (job) => processFlowWaitWarningJob(job.payload),
		"webhook.deliver": (job) => processWebhookDeliveryJob(job.payload),
	},
});

export default app;
