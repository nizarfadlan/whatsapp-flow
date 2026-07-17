import { describe, expect, mock, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

mock.module("@whatsapp-flow/db", () => ({ db: {} }));
mock.module("@whatsapp-flow/whatsapp", () => ({
	connectionManager: { on: mock(() => undefined) },
	derivePrivateIdentityKey: () => "identity",
	matchesKeywordTrigger: () => true,
}));

const { getIncomingMessageDispatchAction, matchesMessageTriggerConfig } =
	await import("./flow-dispatcher");

const groupContext = {
	chatType: "group" as const,
	groupTagIds: new Set(["group-a", "group-b"]),
	senderTagIds: new Set(["sender-a"]),
};

describe("incoming message session dispatch", () => {
	test("resumes an active waiting session instead of starting trigger fanout", () => {
		expect(getIncomingMessageDispatchAction({ status: "waiting" })).toBe(
			"resume",
		);
	});

	test("blocks trigger fanout when an active session is already running", () => {
		expect(getIncomingMessageDispatchAction({ status: "running" })).toBe(
			"block",
		);
	});

	test("allows trigger fanout only when no active session exists", () => {
		expect(getIncomingMessageDispatchAction(null)).toBe("trigger");
	});
});

describe("chat-scoped message triggers", () => {
	test("keeps legacy trigger configs unfiltered", () => {
		expect(matchesMessageTriggerConfig(null, groupContext)).toBe(true);
	});

	test("matches any tag within each filter while requiring both filters", () => {
		expect(
			matchesMessageTriggerConfig(
				{
					chatScope: "groups",
					groupTagIds: ["missing", "group-b"],
					senderTagIds: ["sender-a", "other"],
				},
				groupContext,
			),
		).toBe(true);
		expect(
			matchesMessageTriggerConfig(
				{
					chatScope: "groups",
					groupTagIds: ["group-a"],
					senderTagIds: ["missing"],
				},
				groupContext,
			),
		).toBe(false);
	});

	test("applies chat scope before tag filters", () => {
		expect(
			matchesMessageTriggerConfig(
				{ chatScope: "private", senderTagIds: ["sender-a"] },
				groupContext,
			),
		).toBe(false);
	});
});
