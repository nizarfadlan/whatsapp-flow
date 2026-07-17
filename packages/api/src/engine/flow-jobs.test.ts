import { describe, expect, mock, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

mock.module("@whatsapp-flow/db", () => ({
	db: {},
	createDb: () => ({}),
}));

mock.module("@whatsapp-flow/whatsapp", () => ({
	connectionManager: { emit: mock(() => undefined) },
	derivePrivateIdentityKey: ({
		jid,
		number,
		lid,
	}: {
		jid?: string | null;
		number?: string | null;
		lid?: string | null;
	}) => {
		if (number) return `phone:${number}`;
		if (lid) return `lid:${lid}`;
		return `jid:${jid ?? "unknown"}`;
	},
	deriveThreadKey: ({
		chatType,
		chatJid,
		contactIdentityKey,
	}: {
		chatType: string;
		chatJid?: string | null;
		contactIdentityKey?: string | null;
	}) =>
		chatType === "private"
			? (contactIdentityKey ?? `jid:${chatJid ?? "unknown"}`)
			: `${chatType}:${chatJid ?? "unknown"}`,
	phoneNumberFromJid: (jid?: string | null) =>
		jid?.endsWith("@s.whatsapp.net") ? jid.split("@")[0] : null,
	sendDeviceMessage: mock(() => Promise.resolve({ provider: "baileys" })),
}));

mock.module("./flow-node-secrets", () => ({
	getFlowNodeSecret: mock(() => Promise.resolve(null)),
	WEBHOOK_AUTH_SECRET_KEY: "webhook_auth",
}));

const { isMatchingWaitTimeoutGeneration } = await import("./flow-jobs");

describe("flow wait timeout generation matching", () => {
	const expiresAt = new Date("2026-07-12T00:00:00.000Z");
	const now = new Date("2026-07-12T00:00:01.000Z");

	test("matches only the due waiting session generation", () => {
		expect(
			isMatchingWaitTimeoutGeneration({
				sessionId: "session_1",
				sessionStatus: "waiting",
				sessionWaitingNodeId: "wait_1",
				sessionExpiresAt: expiresAt,
				jobSessionId: "session_1",
				jobWaitingNodeId: "wait_1",
				jobExpiresAt: expiresAt.toISOString(),
				now,
			}),
		).toBe(true);
	});

	test("old timeout jobs do not match a newer waiting generation", () => {
		expect(
			isMatchingWaitTimeoutGeneration({
				sessionId: "session_1",
				sessionStatus: "waiting",
				sessionWaitingNodeId: "wait_1",
				sessionExpiresAt: new Date("2026-07-12T00:05:00.000Z"),
				jobSessionId: "session_1",
				jobWaitingNodeId: "wait_1",
				jobExpiresAt: expiresAt.toISOString(),
				now,
			}),
		).toBe(false);
	});
});
