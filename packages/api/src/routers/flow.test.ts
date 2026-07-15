import { describe, expect, mock, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

mock.module("@whatsapp-flow/whatsapp", () => ({
	connectionManager: {
		emit: mock(() => undefined),
		getConnection: mock(() => null),
	},
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

mock.module("../engine/flow-node-secrets", () => ({
	getFlowNodeSecret: mock(() => Promise.resolve(null)),
	deleteFlowNodeSecret: mock(() => Promise.resolve()),
	deleteFlowNodeSecretsForMissingNodes: mock(() => Promise.resolve()),
	hasFlowNodeSecret: mock(() => Promise.resolve(false)),
	upsertFlowNodeSecret: mock(() => Promise.resolve()),
	WEBHOOK_AUTH_SECRET_KEY: "webhook_auth",
}));

const { validateFlowGraph } = await import("./flow");

function triggerNode() {
	return {
		id: "trigger",
		type: "trigger",
		data: { triggerKind: "any_message" },
	};
}

describe("validateFlowGraph interactive branches", () => {
	test("accepts an interactive option branch with a matching handle", () => {
		const nodes = [
			triggerNode(),
			{
				id: "buttons",
				type: "send-button",
				data: { buttons: [{ id: "sales", text: "Sales" }] },
			},
			{ id: "next", type: "send-text", data: { text: "ok" } },
		];
		const edges = [
			{ source: "trigger", target: "buttons" },
			{ source: "buttons", target: "next", sourceHandle: "option:sales" },
		];

		expect(validateFlowGraph(nodes, edges)).toBeNull();
	});

	test("rejects stale option handles from interactive nodes", () => {
		const nodes = [
			triggerNode(),
			{
				id: "buttons",
				type: "send-button",
				data: { buttons: [{ id: "sales", text: "Sales" }] },
			},
			{ id: "next", type: "send-text", data: { text: "ok" } },
		];
		const edges = [
			{ source: "trigger", target: "buttons" },
			{ source: "buttons", target: "next", sourceHandle: "option:old" },
		];

		expect(validateFlowGraph(nodes, edges)).toBe(
			"send-button node has a stale option branch",
		);
	});

	test("rejects generic outgoing edges from interactive nodes", () => {
		const nodes = [
			triggerNode(),
			{
				id: "buttons",
				type: "send-button",
				data: { buttons: [{ id: "sales", text: "Sales" }] },
			},
			{ id: "next", type: "send-text", data: { text: "ok" } },
		];
		const edges = [
			{ source: "trigger", target: "buttons" },
			{ source: "buttons", target: "next" },
		];

		expect(validateFlowGraph(nodes, edges)).toBe(
			"send-button node branches must use option handles",
		);
	});

	test("keeps condition true and false branch validation", () => {
		const nodes = [
			triggerNode(),
			{
				id: "condition",
				type: "condition",
				data: { field: "message.text", value: "yes" },
			},
			{ id: "yes", type: "send-text", data: { text: "yes" } },
			{ id: "no", type: "send-text", data: { text: "no" } },
		];
		const edges = [
			{ source: "trigger", target: "condition" },
			{ source: "condition", target: "yes", sourceHandle: "true" },
			{ source: "condition", target: "no", sourceHandle: "false" },
		];

		expect(validateFlowGraph(nodes, edges)).toBeNull();
	});
});
