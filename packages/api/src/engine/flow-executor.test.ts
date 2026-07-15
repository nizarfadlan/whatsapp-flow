import { describe, expect, mock, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
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

const {
	buildFlowWaitTimeoutJob,
	buildInteractiveWaitContext,
	buildPollMessage,
	getDelayContinuationClaimTransfer,
	getFlowSessionClaimOutcome,
	getInteractiveOptions,
	getInteractiveWaitSnapshotTargets,
	getWaitingBranchMissingError,
	parseInteractiveWaitContext,
	resolveInteractiveReply,
	resolveInteractiveWaitReply,
} = await import("./flow-executor");
const { waitTimeoutJobIdempotencyKey } = await import("./job-types");

describe("interactive flow options", () => {
	test("button options produce stable option handles in order", () => {
		const options = getInteractiveOptions({
			id: "buttons",
			type: "send-button",
			data: {
				buttons: [
					{ id: "sales", text: "Sales" },
					{ id: "support", text: "Support" },
				],
			},
		});

		expect(options).toEqual([
			{ handle: "option:sales", id: "sales", text: "Sales", index: 1 },
			{ handle: "option:support", id: "support", text: "Support", index: 2 },
		]);
	});

	test("list rows flatten across sections in display order", () => {
		const options = getInteractiveOptions({
			id: "list",
			type: "send-list",
			data: {
				sections: [
					{
						title: "Team",
						rows: [
							{ id: "sales", title: "Sales" },
							{ id: "support", title: "Support" },
						],
					},
					{
						title: "Other",
						rows: [{ id: "billing", title: "Billing" }],
					},
				],
			},
		});

		expect(options.map((option) => option.handle)).toEqual([
			"option:sales",
			"option:support",
			"option:billing",
		]);
		expect(options.map((option) => option.index)).toEqual([1, 2, 3]);
	});

	test("numeric replies resolve to the matching option handle", () => {
		const node = {
			id: "buttons",
			type: "send-button",
			data: {
				buttons: [
					{ id: "sales", text: "Sales" },
					{ id: "support", text: "Support" },
				],
			},
		};

		expect(resolveInteractiveReply(node, "2")?.handle).toBe("option:support");
	});

	test("case-insensitive text replies resolve to the matching option handle", () => {
		const node = {
			id: "quick",
			type: "send-quick-reply",
			data: {
				buttons: [
					{ id: "sales", text: "Sales" },
					{ id: "support", text: "Support" },
				],
			},
		};

		expect(resolveInteractiveReply(node, " support ")?.handle).toBe(
			"option:support",
		);
	});

	test("exact option ids resolve for future native payload support", () => {
		const node = {
			id: "quick",
			type: "send-quick-reply",
			data: {
				buttons: [
					{ id: "sales", text: "Sales" },
					{ id: "support", text: "Support" },
				],
			},
		};

		expect(resolveInteractiveReply(node, "support")?.handle).toBe(
			"option:support",
		);
	});

	test("unknown replies return no match", () => {
		const node = {
			id: "buttons",
			type: "send-button",
			data: { buttons: [{ id: "sales", text: "Sales" }] },
		};

		expect(resolveInteractiveReply(node, "billing")).toBeNull();
	});
});

describe("poll message building", () => {
	const node = {
		id: "poll",
		type: "send-poll",
		data: {
			question: "Choose {{variables.topic}}",
			options: [
				{ id: "sales", text: "{{variables.first}}" },
				{ id: "support", text: "{{variables.second}}" },
			],
		},
	};
	const context = {
		contactNumber: null,
		contactKey: "lid:987654321@lid",
		incomingText: "",
		variables: {
			topic: "a team",
			first: "Sales",
			second: "Support",
		},
	};

	test("accepts private LID targets and builds the numbered fallback", () => {
		expect(buildPollMessage(node, "987654321@lid", context)).toEqual({
			message: {
				type: "poll",
				name: "Choose a team",
				values: ["Sales", "Support"],
				selectableCount: 1,
				fallbackText: "Choose a team\n1. Sales\n2. Support",
			},
			options: [
				{
					handle: "option:sales",
					id: "sales",
					text: "Sales",
					index: 1,
				},
				{
					handle: "option:support",
					id: "support",
					text: "Support",
					index: 2,
				},
			],
		});
	});

	test("rejects option labels that collide after template rendering", () => {
		expect(() =>
			buildPollMessage(node, "15551234567@s.whatsapp.net", {
				...context,
				variables: {
					...context.variables,
					second: "Sales",
				},
			}),
		).toThrow("Poll option text must be unique");
	});
});

describe("interactive wait snapshots", () => {
	const node = {
		id: "buttons",
		type: "send-button",
		data: {
			buttons: [
				{ id: "sales", text: "Sales" },
				{ id: "support", text: "Support" },
			],
		},
	};
	const adjacency = new Map([
		[
			"buttons",
			[
				{
					id: "sales-edge",
					source: "buttons",
					target: "sales-target",
					sourceHandle: "option:sales",
				},
				{
					id: "support-edge",
					source: "buttons",
					target: "support-target",
					sourceHandle: "option:support",
				},
			],
		],
	]);

	test("captures immutable option metadata and branch targets", () => {
		expect(buildInteractiveWaitContext(node, adjacency, "baileys")).toEqual({
			version: 1,
			kind: "interactive",
			deliveryMode: "text_fallback",
			provider: "baileys",
			options: [
				{
					id: "sales",
					text: "Sales",
					index: 1,
					handle: "option:sales",
					nextNodeIds: ["sales-target"],
				},
				{
					id: "support",
					text: "Support",
					index: 2,
					handle: "option:support",
					nextNodeIds: ["support-target"],
				},
			],
		});
	});

	test("prefers a structured selected id over selected text and incoming text", () => {
		const context = buildInteractiveWaitContext(node, adjacency);
		expect(
			resolveInteractiveWaitReply(context, "1", {
				kind: "button",
				selectedId: "support",
				selectedText: "Sales",
			})?.id,
		).toBe("support");
	});

	test("uses structured selected text before the legacy incoming text fallback", () => {
		const context = buildInteractiveWaitContext(node, adjacency);
		expect(
			resolveInteractiveWaitReply(context, "1", {
				kind: "list",
				selectedText: " support ",
			})?.id,
		).toBe("support");
	});

	test("routes a snapshot to its stored target after current edges change", () => {
		const context = buildInteractiveWaitContext(node, adjacency);
		const selected = resolveInteractiveWaitReply(context, "sales");
		expect(selected).not.toBeNull();
		if (!selected) throw new Error("Expected the sales option to resolve");
		const editedNodes = [
			{ id: "sales-target", type: "send-text", data: {} },
			{ id: "new-sales-target", type: "send-text", data: {} },
		];
		const targets = getInteractiveWaitSnapshotTargets(selected, editedNodes);
		expect(targets.nodes.map(({ id }) => id)).toEqual(["sales-target"]);
		expect(targets.missingNodeIds).toEqual([]);
	});

	test("reports every missing snapshot branch target", () => {
		const context = buildInteractiveWaitContext(node, adjacency);
		const selected = resolveInteractiveWaitReply(context, "sales");
		expect(selected).not.toBeNull();
		if (!selected) throw new Error("Expected the sales option to resolve");
		selected.nextNodeIds.push("deleted-target");
		const targets = getInteractiveWaitSnapshotTargets(selected, [
			{ id: "sales-target", type: "send-text", data: {} },
		]);
		expect(targets.nodes.map(({ id }) => id)).toEqual(["sales-target"]);
		expect(targets.missingNodeIds).toEqual(["deleted-target"]);
		expect(getWaitingBranchMissingError(selected, targets.missingNodeIds)).toBe(
			"waiting_branch_missing: Selected option 1. Sales has missing target: deleted-target",
		);
	});

	test("keeps null, invalid, or unknown contexts on legacy current-graph matching", () => {
		expect(parseInteractiveWaitContext(null)).toBeNull();
		expect(resolveInteractiveReply(node, "2")?.id).toBe("support");
		expect(
			parseInteractiveWaitContext({ version: 2, kind: "interactive" }),
		).toBeNull();
		expect(
			parseInteractiveWaitContext({ version: 1, kind: "interactive" }),
		).toBeNull();
	});
});

describe("flow wait timeout jobs", () => {
	test("timeout idempotency key is scoped to session node and generation", () => {
		expect(
			waitTimeoutJobIdempotencyKey({
				sessionId: "session_1",
				waitingNodeId: "wait_1",
				expiresAt: "2026-07-12T00:00:00.000Z",
			}),
		).toBe("flow:wait-timeout:session_1:wait_1:2026-07-12T00:00:00.000Z");
	});

	test("timeout job descriptor uses the generation idempotency key", () => {
		const expiresAt = new Date("2026-07-12T00:00:00.000Z");

		expect(
			buildFlowWaitTimeoutJob({
				sessionId: "session_1",
				waitingNodeId: "wait_1",
				expiresAt,
			}),
		).toEqual({
			kind: "flow.wait_timeout",
			payload: {
				sessionId: "session_1",
				waitingNodeId: "wait_1",
				expiresAt: "2026-07-12T00:00:00.000Z",
			},
			runAt: expiresAt,
			maxAttempts: 3,
			idempotencyKey:
				"flow:wait-timeout:session_1:wait_1:2026-07-12T00:00:00.000Z",
		});
	});
});

describe("flow session claim outcomes", () => {
	test("same job may re-enter a running session", () => {
		expect(
			getFlowSessionClaimOutcome({
				status: "running",
				sessionClaimJobId: "job_1",
				claimJobId: "job_1",
			}),
		).toBe("reenter");
	});

	test("different job may not claim a running session", () => {
		expect(
			getFlowSessionClaimOutcome({
				status: "running",
				sessionClaimJobId: "job_1",
				claimJobId: "job_2",
			}),
		).toBe("owned_by_other");
	});

	test("delay continuation handoff transfers from resume owner to pending continuation", () => {
		expect(
			getDelayContinuationClaimTransfer({
				sessionId: "session_1",
				expectedClaimJobId: "resume_job_1",
				continuationJobId: "continue_job_1",
			}),
		).toEqual({
			sessionId: "session_1",
			expectedClaimJobId: "resume_job_1",
			claimJobId: "continue_job_1",
			claimedAt: null,
			failureCode: null,
		});
	});

	test("subsequent delay continuation handoff uses current continuation owner", () => {
		expect(
			getDelayContinuationClaimTransfer({
				sessionId: "session_1",
				expectedClaimJobId: "continue_job_1",
				continuationJobId: "continue_job_2",
			})?.expectedClaimJobId,
		).toBe("continue_job_1");
	});
});
