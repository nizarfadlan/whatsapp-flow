import { timingSafeEqual } from "node:crypto";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@whatsapp-flow/api/context";
import { processDeviceResourceSyncJob } from "@whatsapp-flow/api/engine/device-resource-sync";
import {
	startFlowDispatcher,
	startScheduleDispatcher,
} from "@whatsapp-flow/api/engine/flow-dispatcher";
import { executeFlow } from "@whatsapp-flow/api/engine/flow-executor";
import {
	processFlowContinueJob,
	processFlowExecuteJob,
	processFlowPollResumeJob,
	processFlowResumeJob,
	processFlowWaitTimeoutJob,
	processFlowWaitWarningJob,
} from "@whatsapp-flow/api/engine/flow-jobs";
import {
	reconcileFlowSessions,
	startFlowSessionReconciler,
} from "@whatsapp-flow/api/engine/flow-reconciliation";
import { enrichInboundMedia } from "@whatsapp-flow/api/engine/inbound-media";
import {
	releaseExpiredLeases,
	startJobWorker,
} from "@whatsapp-flow/api/engine/job-queue";
import {
	processWebhookDeliveryJob,
	startWebhookDispatcher,
} from "@whatsapp-flow/api/engine/webhook-dispatcher";
import { logger as apiLogger } from "@whatsapp-flow/api/observability/logger";
import { renderMetrics } from "@whatsapp-flow/api/observability/metrics";
import { seedRbac } from "@whatsapp-flow/api/rbac";
import { appRouter } from "@whatsapp-flow/api/routers/index";
import { auth } from "@whatsapp-flow/auth";
import { createDb } from "@whatsapp-flow/db";
import { user } from "@whatsapp-flow/db/schema/auth";
import { channel, chatGroup } from "@whatsapp-flow/db/schema/contact";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import { env } from "@whatsapp-flow/env/server";
import {
	isLocalStorageDriver,
	LocalStorageDriver,
	normalizeStorageKey,
	S3StorageDriver,
	storage,
	verifyLocalUploadGrant,
} from "@whatsapp-flow/storage";
import {
	connectionManager,
	deriveThreadKey,
	handleMetaWebhook,
	verifyMetaWebhookChallenge,
} from "@whatsapp-flow/whatsapp";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import {
	mergePrivateThreadsForContact,
	upsertPrivateContact,
} from "./whatsapp-identity";
import {
	persistSyncedContacts,
	persistSyncedGroups,
	persistSyncedNewsletters,
	upsertGroupParticipantSender,
} from "./whatsapp-persistence";

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

function contentTypeWithoutParameters(value: string | undefined) {
	return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function safeMediaContentType(value: unknown) {
	const mimeType = contentTypeWithoutParameters(
		typeof value === "string" ? value : undefined,
	);
	return /^[!#$%&'*+.^_`|~\w-]+\/[!#$%&'*+.^_`|~\w-]+$/.test(mimeType)
		? mimeType
		: "application/octet-stream";
}

function safeDownloadName(value: unknown) {
	const fallback = "media";
	if (typeof value !== "string") return fallback;
	const normalized = value.replace(/[\\/\r\n\0"]/g, "_").trim();
	return normalized.slice(0, 255) || fallback;
}

function inboundMediaStorage(raw: unknown) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const media = (raw as Record<string, unknown>).media;
	if (!media || typeof media !== "object" || Array.isArray(media)) return null;
	const mediaRecord = media as Record<string, unknown>;
	const storageInfo = mediaRecord.storage;
	if (
		!storageInfo ||
		typeof storageInfo !== "object" ||
		Array.isArray(storageInfo)
	) {
		return null;
	}
	const storageRecord = storageInfo as Record<string, unknown>;
	if (
		(storageRecord.driver !== "local" && storageRecord.driver !== "s3") ||
		typeof storageRecord.key !== "string"
	) {
		return null;
	}
	try {
		const key = normalizeStorageKey(storageRecord.key);
		if (!key.startsWith("whatsapp/")) return null;
		return {
			driver: storageRecord.driver,
			key,
			mimeType: safeMediaContentType(mediaRecord.mimeType),
			fileName: safeDownloadName(mediaRecord.fileName),
		};
	} catch {
		return null;
	}
}

app.get("/api/media/public/:key{.+}", async (c) => {
	if (!isLocalStorageDriver() || !(storage instanceof LocalStorageDriver)) {
		return c.text("Local media is unavailable", 404);
	}
	const key = c.req.param("key");
	try {
		const safeKey = normalizeStorageKey(key);
		if (!safeKey.startsWith("media/")) return c.text("Not found", 404);
		const data = await storage.read(safeKey);
		return c.body(new Uint8Array(data), 200, {
			"Content-Type": "application/octet-stream",
		});
	} catch {
		return c.text("Not found", 404);
	}
});

app.get("/api/inbox/media/:messageId", async (c) => {
	const authResult = await requireActiveSession(c);
	if (authResult.response) return authResult.response;
	const [message] = await authResult.db
		.select({ raw: inboxMessage.raw })
		.from(inboxMessage)
		.innerJoin(inboxThread, eq(inboxMessage.threadId, inboxThread.id))
		.innerJoin(device, eq(inboxThread.deviceId, device.id))
		.where(
			and(
				eq(inboxMessage.id, c.req.param("messageId")),
				eq(device.userId, authResult.session.user.id),
			),
		)
		.limit(1);
	if (!message) return c.text("Not found", 404);
	const media = inboundMediaStorage(message.raw);
	if (!media) return c.text("Not found", 404);

	if (media.driver === "local") {
		if (!(storage instanceof LocalStorageDriver))
			return c.text("Not found", 404);
		try {
			const data = await storage.read(media.key);
			return c.body(new Uint8Array(data), 200, {
				"Content-Type": media.mimeType,
				"Content-Disposition": `attachment; filename="${media.fileName}"`,
			});
		} catch {
			return c.text("Not found", 404);
		}
	}
	if (!(storage instanceof S3StorageDriver)) return c.text("Not found", 404);
	return c.redirect(
		await storage.presignGet(media.key, 60, {
			fileName: media.fileName,
			contentType: media.mimeType,
		}),
		302,
	);
});

// Local-driver direct uploads require a short-lived grant bound to one user and key.
app.post("/api/uploads/local/:key{.+}", async (c) => {
	if (!isLocalStorageDriver() || !(storage instanceof LocalStorageDriver)) {
		return c.text("Local uploads are disabled", 404);
	}
	const authResult = await requireActiveSession(c);
	if (authResult.response) return authResult.response;
	const key = c.req.param("key");
	const contentType = contentTypeWithoutParameters(
		c.req.header("content-type"),
	);
	const grant = c.req.query("grant");
	if (!grant || !contentType) return c.text("Invalid upload grant", 400);
	const payload = verifyLocalUploadGrant(grant, env.AUTH_SECRET, {
		key,
		userId: authResult.session.user.id,
		mimeType: contentType,
	});
	if (!payload)
		return c.text("Invalid, expired, or unauthorized upload grant", 403);
	const contentLength = c.req.header("content-length");
	if (contentLength) {
		const length = Number(contentLength);
		if (!Number.isSafeInteger(length) || length < 0) {
			return c.text("Invalid Content-Length", 400);
		}
		if (length > payload.maxBytes)
			return c.text("Upload exceeds allowed size", 413);
	}
	try {
		const result = await storage.createFromStream(
			payload.key,
			c.req.raw.body,
			payload.maxBytes,
		);
		if (result.status === "conflict")
			return c.text("Upload key already exists", 409);
		if (result.status === "oversize")
			return c.text("Upload exceeds allowed size", 413);
		return c.json({ url: result.object.url, key: result.object.key });
	} catch {
		return c.text("Failed to store upload", 500);
	}
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
		const startedAt = Date.now();
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
			apiLogger.info("sse.device_stream.aborted", {
				deviceId,
				durationMs: Date.now() - startedAt,
			});
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
			contactNumber: string | null;
			contactKey: string;
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
						contactKey: ev.contactKey,
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

		if (message.inboxReservation) {
			const { messageId, threadId } = message.inboxReservation;
			const mediaResult = await enrichInboundMedia({
				inboxMessageId: messageId,
				deviceId,
				provider: ev.provider ?? "baileys",
				providerMessageId: message.providerMessageId,
				messageType: message.type,
				raw: message.raw,
			});
			const raw = mediaResult.raw ?? message.raw;
			await db
				.update(inboxMessage)
				.set({ raw, updatedAt: new Date() })
				.where(
					and(
						eq(inboxMessage.id, messageId),
						eq(inboxMessage.threadId, threadId),
					),
				);
			connectionManager.emit("inbox:updated", { deviceId, threadId });
			connectionManager.emit("device:message-persisted", {
				...ev,
				message: { ...message, raw },
				inboxMessageId: messageId,
				threadId,
			});
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
		let contactIdentityKey: string | null = null;
		let contactNumber: string | null = null;
		let contactName: string | null = contact.name ?? null;
		let groupId: string | null = null;
		let channelId: string | null = null;

		if (chatType === "private") {
			const savedContact = await upsertPrivateContact(db, {
				deviceId,
				jid: contact.jid,
				number: contact.number,
				lid: contact.lid,
				username: contact.username,
				identityKey: contact.identityKey,
				name: contact.name,
				pushName: contact.name,
				providerContactId: contact.providerContactId,
				source: "message",
			});
			contactId = savedContact?.id ?? null;
			contactIdentityKey = savedContact?.identityKey ?? null;
			contactNumber = savedContact?.phoneNumber ?? null;
			contactName = savedContact?.name ?? contact.name ?? null;
			if (savedContact) {
				await mergePrivateThreadsForContact(db, {
					deviceId,
					contactId: savedContact.id,
					identityKey: savedContact.identityKey,
					jid: contact.jid,
					phoneNumber: savedContact.phoneNumber,
					lid: savedContact.lid,
					name: savedContact.name,
					now,
				});
			}
		} else if (chatType === "group") {
			const groupSubject = ev.group?.name ?? contact.jid;
			const [savedGroup] = await db
				.insert(chatGroup)
				.values({
					id: crypto.randomUUID(),
					deviceId,
					jid: contact.jid,
					subject: groupSubject,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [chatGroup.deviceId, chatGroup.jid],
					set: {
						subject: groupSubject === contact.jid ? undefined : groupSubject,
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

		const threadKey = deriveThreadKey({
			chatType,
			chatJid: contact.jid,
			contactIdentityKey,
			groupJid: chatType === "group" ? contact.jid : null,
			channelJid: chatType === "channel" ? contact.jid : null,
		});

		const [savedThread] = await db
			.insert(inboxThread)
			.values({
				id: crypto.randomUUID(),
				deviceId,
				chatType,
				threadKey,
				chatJid: contact.jid,
				contactId,
				groupId,
				channelId,
				groupJid: chatType === "group" ? contact.jid : null,
				channelJid: chatType === "channel" ? contact.jid : null,
				contactNumber: chatType === "private" ? contactNumber : null,
				contactName,
				lastMessageText: message.text ?? `[${message.type}]`,
				lastMessageAt: now,
				unreadCount: 0,
			})
			.onConflictDoUpdate({
				target: [inboxThread.deviceId, inboxThread.threadKey],
				set: {
					chatType,
					chatJid: contact.jid,
					contactId,
					groupId,
					channelId,
					groupJid: chatType === "group" ? contact.jid : null,
					channelJid: chatType === "channel" ? contact.jid : null,
					contactNumber: chatType === "private" ? contactNumber : null,
					contactName,
				},
			})
			.returning({ id: inboxThread.id });

		const threadId = savedThread?.id;

		if (!threadId) return;

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
				raw: message.raw,
			})
			.onConflictDoNothing()
			.returning({ id: inboxMessage.id });

		if (!insertedMessage) {
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

		const mediaResult = await enrichInboundMedia({
			inboxMessageId: insertedMessage.id,
			deviceId,
			provider: ev.provider ?? "baileys",
			providerMessageId: message.providerMessageId,
			messageType: message.type,
			raw: message.raw,
		});
		const raw = mediaResult.raw ?? message.raw;
		await db
			.update(inboxMessage)
			.set({ raw, updatedAt: new Date() })
			.where(eq(inboxMessage.id, insertedMessage.id));
		connectionManager.emit("inbox:updated", { deviceId, threadId });
		connectionManager.emit("device:message-persisted", {
			...ev,
			message: { ...message, raw },
			inboxMessageId: insertedMessage.id,
			threadId,
		});
	} catch (err) {
		console.error("Failed to persist inbox message", err);
	}
});

connectionManager.on("device:contacts", async (ev) => {
	try {
		await persistSyncedContacts(ev);
	} catch (err) {
		console.error("Failed to persist contacts sync", err);
	}
});

connectionManager.on("device:groups", async (ev) => {
	try {
		await persistSyncedGroups(ev);
	} catch (err) {
		console.error("Failed to persist groups sync", err);
	}
});

connectionManager.on("device:channels", async (ev) => {
	try {
		await persistSyncedNewsletters({
			deviceId: ev.deviceId,
			newsletters: ev.channels,
		});
	} catch (err) {
		console.error("Failed to persist channels sync", err);
	}
});

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

async function startBackgroundServices() {
	await releaseExpiredLeases(db);
	await reconcileFlowSessions({ db });
	startFlowDispatcher();
	startScheduleDispatcher();
	startWebhookDispatcher();
	startFlowSessionReconciler({ db });
	startJobWorker({
		db,
		handlers: {
			"device.resource_sync": (job) =>
				processDeviceResourceSyncJob(
					job,
					{
						persistContacts: persistSyncedContacts,
						persistGroups: persistSyncedGroups,
						persistNewsletters: persistSyncedNewsletters,
					},
					db,
				),
			"flow.continue": (job) => processFlowContinueJob(job.payload),
			"flow.execute": (job) => processFlowExecuteJob(job.payload),
			"flow.resume": (job) => processFlowResumeJob(job),
			"flow.poll_resume": (job) => processFlowPollResumeJob(job),
			"flow.wait_timeout": (job) => processFlowWaitTimeoutJob(job.payload),
			"flow.wait_warning": (job) => processFlowWaitWarningJob(job.payload),
			"webhook.deliver": (job) => processWebhookDeliveryJob(job.payload),
		},
	});
	await reconnectDevices();
}

void startBackgroundServices().catch((error) => {
	console.error("Failed to start background services", error);
});

export default app;
