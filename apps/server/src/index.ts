import { timingSafeEqual } from "node:crypto";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@whatsapp-flow/api/context";
import {
	startFlowDispatcher,
	startScheduleDispatcher,
} from "@whatsapp-flow/api/engine/flow-dispatcher";
import { executeFlow } from "@whatsapp-flow/api/engine/flow-executor";
import { appRouter } from "@whatsapp-flow/api/routers/index";
import { auth } from "@whatsapp-flow/auth";
import { createDb } from "@whatsapp-flow/db";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import { env } from "@whatsapp-flow/env/server";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
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

		// Keep-alive ping every 30s
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

app.get("/", (c) => {
	return c.text("OK");
});

const db = createDb();

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

export default app;
