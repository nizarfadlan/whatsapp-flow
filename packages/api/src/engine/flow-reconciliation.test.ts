import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

const { classifyRunningSessionOwner, isOverdueWaitingSession } = await import(
	"./flow-reconciliation"
);

describe("flow waiting session reconciliation", () => {
	const now = new Date("2026-07-12T00:00:00.000Z");

	test("overdue waiting sessions are eligible for expiration", () => {
		expect(
			isOverdueWaitingSession({
				status: "waiting",
				expiresAt: new Date("2026-07-11T23:59:59.000Z"),
				now,
			}),
		).toBe(true);
	});

	test("future waiting sessions are not overdue", () => {
		expect(
			isOverdueWaitingSession({
				status: "waiting",
				expiresAt: new Date("2026-07-12T00:01:00.000Z"),
				now,
			}),
		).toBe(false);
	});
});

describe("flow running session owner reconciliation", () => {
	const now = new Date("2026-07-12T00:00:00.000Z");

	test("legacy orphaned running sessions fail reconciliation", () => {
		expect(
			classifyRunningSessionOwner({ claimJobId: null, jobStatus: null, now }),
		).toBe("legacy_missing_claim");
	});

	test("dead owner job fails reconciliation", () => {
		expect(
			classifyRunningSessionOwner({
				claimJobId: "job_1",
				jobStatus: "dead",
				now,
			}),
		).toBe("owner_terminal");
	});

	test("succeeded owner job fails reconciliation", () => {
		expect(
			classifyRunningSessionOwner({
				claimJobId: "job_1",
				jobStatus: "succeeded",
				now,
			}),
		).toBe("owner_terminal");
	});

	test("pending continuation owner is kept after resume owner succeeds", () => {
		expect(
			classifyRunningSessionOwner({
				claimJobId: "continue_job_1",
				jobStatus: "pending",
				now,
			}),
		).toBe("keep");
	});

	test("running owner with valid lease is kept", () => {
		expect(
			classifyRunningSessionOwner({
				claimJobId: "job_1",
				jobStatus: "running",
				leaseUntil: new Date("2026-07-12T00:01:00.000Z"),
				now,
			}),
		).toBe("keep");
	});

	test("running owner with expired lease is kept for job queue recovery", () => {
		expect(
			classifyRunningSessionOwner({
				claimJobId: "job_1",
				jobStatus: "running",
				leaseUntil: new Date("2026-07-11T23:59:59.000Z"),
				now,
			}),
		).toBe("keep");
	});
});
