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
	getDelayContinuationClaimTransfer,
	getFlowSessionClaimOutcome,
	getInteractiveOptions,
	resolveInteractiveReply,
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
