import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@whatsapp-flow/api/context";
import { appRouter } from "@whatsapp-flow/api/routers/index";
import { auth } from "@whatsapp-flow/auth";
import { createDb } from "@whatsapp-flow/db";
import { device } from "@whatsapp-flow/db/schema/device";
import { env } from "@whatsapp-flow/env/server";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, eq } from "drizzle-orm";
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

// ── Boot: reconnect previously-connected devices + start message handler ──

const db = createDb();

async function reconnectDevices() {
	const connected = await db
		.select({ id: device.id })
		.from(device)
		.where(eq(device.status, "connected"));

	for (const d of connected) {
		void connectionManager.connect(d.id);
	}
}

void reconnectDevices();

export default app;
