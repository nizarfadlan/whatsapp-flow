import { describe, expect, mock, test } from "bun:test";
import { makeCurrentUser, makeSession } from "../test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
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

const {
	flowRouter,
	getTriggerTagIds,
	sanitizeTriggerConfigForStorage,
	validateFlowGraph,
	validateFlowGraphDiagnostics,
} = await import("./flow");

const organizationMembership = {
	tenantId: "tenant-1",
	userId: "user-1",
	role: "member",
	organization: {
		id: "tenant-1",
		name: "Organization",
		slug: "organization",
		status: "active",
	},
};

type Selection = Record<string, unknown> | undefined;

function createMockDb(selects: unknown[][]) {
	const selections: Selection[] = [];

	function query(selection?: Selection) {
		selections.push(selection);
		return {
			from() {
				return this;
			},
			innerJoin() {
				return this;
			},
			leftJoin() {
				return this;
			},
			where() {
				return this;
			},
			limit() {
				return Promise.resolve(selects.shift() ?? []);
			},
			orderBy() {
				return Promise.resolve(selects.shift() ?? []);
			},
		};
	}

	return { db: { select: query }, selections };
}

function createCaller(selects: unknown[][]) {
	const mockDb = createMockDb([
		selects[0] ?? [],
		[organizationMembership],
		[organizationMembership],
		[{ key: "organization.flows.read" }],
		...selects.slice(1),
	]);
	return {
		caller: flowRouter.createCaller({
			auth: null,
			session: makeSession(),
			db: mockDb.db,
			requestIp: "127.0.0.1",
			requestUserAgent: "bun-test",
		} as never),
		selections: mockDb.selections,
	};
}

function triggerNode() {
	return {
		id: "trigger",
		type: "trigger",
		data: { triggerKind: "any_message" },
	};
}

describe("flow ownership provenance", () => {
	test("includes only owner display metadata in accessible flow listings", async () => {
		const { caller, selections } = createCaller([
			[makeCurrentUser()],
			[
				{
					id: "flow-1",
					name: "Support",
					ownerName: "Flow Owner",
					ownerEmail: "owner@example.com",
					accessCapability: "owner",
				},
			],
		]);

		const flows = await caller.list({ tenantId: "tenant-1" });
		expect(
			flows.map(({ id, name, accessCapability, owner }) => ({
				id,
				name,
				accessCapability,
				owner,
			})),
		).toEqual([
			{
				id: "flow-1",
				name: "Support",
				accessCapability: "owner",
				owner: { name: "Flow Owner", email: "owner@example.com" },
			},
		]);
		expect(Object.keys(selections[4] ?? {}).sort()).toEqual([
			"accessCapability",
			"createdAt",
			"description",
			"deviceId",
			"deviceName",
			"id",
			"name",
			"ownerEmail",
			"ownerName",
			"status",
			"triggerType",
			"updatedAt",
		]);
	});

	test("includes owner metadata only after verifying flow access", async () => {
		const { caller, selections } = createCaller([
			[makeCurrentUser()],
			[
				{
					id: "flow-1",
					userId: "owner-1",
					tenantId: "tenant-1",
					nodes: [],
					edges: [],
				},
			],
			[{ name: "Flow Owner", email: "owner@example.com" }],
		]);

		await expect(
			caller.getById({ tenantId: "tenant-1", id: "flow-1" }),
		).resolves.toMatchObject({
			id: "flow-1",
			accessCapability: "owner",
			owner: { name: "Flow Owner", email: "owner@example.com" },
		});
		expect(Object.keys(selections[5] ?? {}).sort()).toEqual(["email", "name"]);
	});
});

describe("flow webhook token storage", () => {
	test("removes plaintext webhook tokens from trigger config", () => {
		expect(
			sanitizeTriggerConfigForStorage("webhook", {
				webhookToken: "plaintext-token",
				path: "/incoming",
			}),
		).toEqual({ path: "/incoming" });
	});

	test("preserves non-webhook trigger config unchanged", () => {
		const triggerConfig = { webhookToken: "not-a-webhook-secret" };
		expect(sanitizeTriggerConfigForStorage("keyword", triggerConfig)).toBe(
			triggerConfig,
		);
	});
});

describe("flow trigger tag ownership inputs", () => {
	test("collects unique sender and group tag IDs from a create payload", () => {
		expect(
			getTriggerTagIds({
				groupTagIds: ["group-tag", "group-tag", 1],
				senderTagIds: ["sender-tag", "group-tag", ""],
			}),
		).toEqual(["group-tag", "sender-tag"]);
	});

	test("ignores non-object trigger configs", () => {
		expect(getTriggerTagIds(null)).toEqual([]);
		expect(getTriggerTagIds(["foreign-tag"])).toEqual([]);
	});
});

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

	test("reports the exact generic catalog edge without rejecting valid option branches", () => {
		const nodes = [
			triggerNode(),
			{
				id: "catalog",
				type: "send-button",
				data: {
					buttons: [
						{ id: "books", text: "Books" },
						{ id: "music", text: "Music" },
					],
				},
			},
			{ id: "books", type: "send-text", data: { text: "books" } },
			{ id: "music", type: "send-text", data: { text: "music" } },
		];
		const edges = [
			{ source: "trigger", target: "catalog" },
			{
				id: "catalog-books",
				source: "catalog",
				target: "books",
				sourceHandle: "option:books",
			},
			{
				id: "catalog-music",
				source: "catalog",
				target: "music",
				sourceHandle: "option:music",
			},
			{ id: "catalog-generic", source: "catalog", target: "books" },
		];

		expect(validateFlowGraphDiagnostics(nodes, edges)).toEqual([
			{
				issueCode: "interactive_missing_handle",
				message: "send-button node branches must use option handles",
				nodeId: "catalog",
				edgeId: "catalog-generic",
				expectedHandles: ["option:books", "option:music"],
			},
		]);
	});

	test("reports csat generic and missing option branches separately", () => {
		const nodes = [
			triggerNode(),
			{
				id: "csat",
				type: "send-quick-reply",
				data: {
					buttons: [
						{ id: "good", text: "Good" },
						{ id: "bad", text: "Bad" },
					],
				},
			},
			{ id: "next", type: "send-text", data: { text: "thanks" } },
		];
		const edges = [
			{ source: "trigger", target: "csat" },
			{ id: "csat-generic", source: "csat", target: "next" },
			{
				id: "csat-good",
				source: "csat",
				target: "next",
				sourceHandle: "option:good",
			},
		];

		expect(validateFlowGraphDiagnostics(nodes, edges)).toEqual([
			{
				issueCode: "interactive_missing_handle",
				message: "send-quick-reply node branches must use option handles",
				nodeId: "csat",
				edgeId: "csat-generic",
				expectedHandles: ["option:good", "option:bad"],
			},
			{
				issueCode: "interactive_missing_branch",
				message:
					"send-quick-reply node needs a connected branch for option:bad",
				nodeId: "csat",
				expectedHandles: ["option:good", "option:bad"],
				missingHandles: ["option:bad"],
			},
		]);
	});

	test("accepts a fully branched list menu", () => {
		const nodes = [
			triggerNode(),
			{
				id: "menu",
				type: "send-list",
				data: {
					sections: [
						{
							rows: [
								{ id: "sales", title: "Sales" },
								{ id: "support", title: "Support" },
							],
						},
					],
				},
			},
			{ id: "next", type: "send-text", data: { text: "ok" } },
		];
		const edges = [
			{ source: "trigger", target: "menu" },
			{ source: "menu", target: "next", sourceHandle: "option:sales" },
			{ source: "menu", target: "next", sourceHandle: "option:support" },
		];

		expect(validateFlowGraphDiagnostics(nodes, edges)).toEqual([]);
		expect(validateFlowGraph(nodes, edges)).toBeNull();
	});

	test("validates poll configuration and requires every poll option branch", () => {
		const nodes = [
			triggerNode(),
			{
				id: "poll",
				type: "send-poll",
				data: {
					question: " ",
					options: [
						{ id: "yes", text: "Same" },
						{ id: "yes", text: "Same" },
					],
					timeoutMinutes: 0,
					replyWarnings: [{ afterMinutes: 1, message: "Reminder" }],
				},
			},
			{ id: "next", type: "send-text", data: { text: "ok" } },
		];
		const edges = [
			{ source: "trigger", target: "poll" },
			{
				id: "poll-yes",
				source: "poll",
				target: "next",
				sourceHandle: "option:yes",
			},
		];

		const diagnostics = validateFlowGraphDiagnostics(nodes, edges);
		expect(diagnostics.map((diagnostic) => diagnostic.issueCode)).toEqual([
			"poll_invalid_question",
			"poll_duplicate_option_id",
			"poll_duplicate_option_label",
			"poll_invalid_timeout",
		]);
		expect(validateFlowGraph(nodes, edges)).toBe(
			"send-poll node needs a non-empty question up to 255 characters",
		);
	});

	test("rejects poll option IDs with surrounding whitespace", () => {
		const nodes = [
			triggerNode(),
			{
				id: "poll",
				type: "send-poll",
				data: {
					question: "Choose one",
					options: [
						{ id: " yes ", text: "Yes" },
						{ id: "no", text: "No" },
					],
				},
			},
			{ id: "next", type: "send-text", data: { text: "ok" } },
		];
		const edges = [
			{ source: "trigger", target: "poll" },
			{
				source: "poll",
				target: "next",
				sourceHandle: "option: yes ",
			},
			{
				source: "poll",
				target: "next",
				sourceHandle: "option:no",
			},
		];

		expect(
			validateFlowGraphDiagnostics(nodes, edges).map(
				(diagnostic) => diagnostic.issueCode,
			),
		).toEqual(["poll_invalid_option"]);
	});

	test("accepts a valid poll and validates warnings before its timeout", () => {
		const nodes = [
			triggerNode(),
			{
				id: "poll",
				type: "send-poll",
				data: {
					question: "How was your experience?",
					options: [
						{ id: "good", text: "Good" },
						{ id: "bad", text: "Bad" },
					],
					timeoutMinutes: 10,
					replyWarnings: [{ afterMinutes: 10, message: "Reminder" }],
				},
			},
			{ id: "next", type: "send-text", data: { text: "ok" } },
		];
		const edges = [
			{ source: "trigger", target: "poll" },
			{ source: "poll", target: "next", sourceHandle: "option:good" },
			{ source: "poll", target: "next", sourceHandle: "option:bad" },
		];

		expect(validateFlowGraphDiagnostics(nodes, edges)).toEqual([
			{
				issueCode: "poll_invalid_warning",
				message: "send-poll warnings must be valid and before the timeout",
				nodeId: "poll",
			},
		]);
	});

	test("accepts a valid, fully branched poll", () => {
		const nodes = [
			triggerNode(),
			{
				id: "poll",
				type: "send-poll",
				data: {
					question: "How was your experience?",
					options: [
						{ id: "good", text: "Good" },
						{ id: "bad", text: "Bad" },
					],
					timeoutMinutes: 10,
					replyWarnings: [{ afterMinutes: 5, message: "Reminder" }],
				},
			},
			{ id: "next", type: "send-text", data: { text: "ok" } },
		];
		const edges = [
			{ source: "trigger", target: "poll" },
			{ source: "poll", target: "next", sourceHandle: "option:good" },
			{ source: "poll", target: "next", sourceHandle: "option:bad" },
		];

		expect(validateFlowGraphDiagnostics(nodes, edges)).toEqual([]);
		expect(validateFlowGraph(nodes, edges)).toBeNull();
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
