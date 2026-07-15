import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { JobRecord } from "./job-queue";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.NODE_ENV = "test";

mock.module("@whatsapp-flow/db", () => ({
	db: {},
	createDb: () => ({}),
}));

const loggerWarn = mock(() => undefined);
mock.module("../observability/logger", () => ({
	logger: {
		info: mock(() => undefined),
		warn: loggerWarn,
		error: mock(() => undefined),
	},
}));

mock.module("../observability/metrics", () => ({
	incrementCounter: mock(() => undefined),
	observeHistogram: mock(() => undefined),
}));

const { completeJob, failJob, releaseExpiredLeases, renewJobLease, runJob } =
	await import("./job-queue");

type MutableJob = JobRecord;
type Predicate = { queryChunks?: unknown[] };
type Condition = {
	field: keyof MutableJob;
	operator: "=" | "<=";
	value: unknown;
};

type TimerCallback = () => void;

const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

beforeEach(() => {
	loggerWarn.mockClear();
});

afterEach(() => {
	globalThis.setInterval = realSetInterval;
	globalThis.clearInterval = realClearInterval;
});

describe("durable job queue lease semantics", () => {
	test("releaseExpiredLeases only releases running expired jobs", async () => {
		const now = new Date();
		const expired = new Date(now.getTime() - 1_000);
		const future = new Date(now.getTime() + 60_000);
		const db = createMockDb([
			job({ id: "running-expired", status: "running", leaseUntil: expired }),
			job({ id: "pending-expired", status: "pending", leaseUntil: expired }),
			job({ id: "failed-expired", status: "failed", leaseUntil: expired }),
			job({ id: "running-future", status: "running", leaseUntil: future }),
		]);

		const released = await releaseExpiredLeases(db);

		expect(released).toEqual(["running-expired"]);
		expect(db.rows.find((row) => row.id === "running-expired")).toMatchObject({
			status: "failed",
			lockedBy: null,
			leaseUntil: null,
			lastError: "Job lease expired before completion",
			completedAt: null,
		});
		expect(db.rows.find((row) => row.id === "pending-expired")?.status).toBe(
			"pending",
		);
		expect(db.rows.find((row) => row.id === "failed-expired")?.status).toBe(
			"failed",
		);
		expect(db.rows.find((row) => row.id === "running-future")?.status).toBe(
			"running",
		);
	});

	test("marks exhausted expired leases dead instead of retrying them", async () => {
		const db = createMockDb([
			job({
				id: "exhausted-job",
				attempts: 3,
				maxAttempts: 3,
				leaseUntil: new Date(Date.now() - 1_000),
			}),
		]);

		await releaseExpiredLeases(db);

		expect(db.rows[0]).toMatchObject({
			status: "dead",
			lockedBy: null,
			leaseUntil: null,
			lastError: "Job lease expired before completion",
			completedAt: expect.any(Date),
		});
	});

	test("renewJobLease extends a running job owned by the same worker", async () => {
		const leaseUntil = new Date("2026-01-01T00:00:00.000Z");
		const db = createMockDb([
			job({ id: "job-1", lockedBy: "worker-1", leaseUntil }),
		]);

		const renewed = await renewJobLease("job-1", "worker-1", 60, db);

		expect(renewed).toBe(true);
		expect(db.rows[0].leaseUntil?.getTime()).toBeGreaterThan(
			leaseUntil.getTime(),
		);
		expect(db.rows[0].status).toBe("running");
		expect(db.rows[0].lockedBy).toBe("worker-1");
	});

	test("heartbeat and complete report lost ownership without overwriting a new owner", async () => {
		const db = createMockDb([
			job({ id: "job-1", lockedBy: "worker-2", leaseUntil: new Date() }),
		]);

		const renewed = await renewJobLease("job-1", "worker-1", 60, db);
		const completed = await completeJob("job-1", "worker-1", db);

		expect(renewed).toBe(false);
		expect(completed).toBe("lost");
		expect(db.rows[0]).toMatchObject({
			id: "job-1",
			status: "running",
			lockedBy: "worker-2",
		});
	});

	test("failJob preserves retry and dead transitions for the owning worker", async () => {
		const retryRunAt = new Date("2026-01-01T00:00:00.000Z");
		const deadRunAt = new Date("2026-01-02T00:00:00.000Z");
		const db = createMockDb([
			job({
				id: "retry-job",
				attempts: 1,
				maxAttempts: 3,
				runAt: retryRunAt,
				lockedBy: "worker-1",
			}),
			job({
				id: "dead-job",
				attempts: 3,
				maxAttempts: 3,
				runAt: deadRunAt,
				lockedBy: "worker-1",
			}),
		]);

		const retryStatus = await failJob(
			"retry-job",
			"worker-1",
			new Error("retry me"),
			db,
		);
		const deadStatus = await failJob(
			"dead-job",
			"worker-1",
			new Error("done"),
			db,
		);

		const retryRow = db.rows.find((row) => row.id === "retry-job");
		const deadRow = db.rows.find((row) => row.id === "dead-job");
		expect(retryStatus).toBe("failed");
		expect(retryRow).toMatchObject({
			status: "failed",
			lockedBy: null,
			leaseUntil: null,
			lastError: "retry me",
			completedAt: null,
		});
		expect(retryRow?.runAt.getTime()).toBeGreaterThan(retryRunAt.getTime());
		expect(deadStatus).toBe("dead");
		expect(deadRow).toMatchObject({
			status: "dead",
			lockedBy: null,
			leaseUntil: null,
			lastError: "done",
			runAt: deadRunAt,
		});
		expect(deadRow?.completedAt).toBeInstanceOf(Date);
	});

	test("runJob clears the heartbeat timer when the handler completes", async () => {
		let timerCallback: TimerCallback | null = null;
		const timerToken = { timer: "lease" } as unknown as ReturnType<
			typeof setInterval
		>;
		const setIntervalMock = mock((callback: TimerCallback, ms: number) => {
			timerCallback = callback;
			expect(ms).toBeLessThan(30_000);
			return timerToken;
		});
		const clearIntervalMock = mock((timer: ReturnType<typeof setInterval>) => {
			expect(timer).toBe(timerToken);
		});
		globalThis.setInterval = setIntervalMock as typeof setInterval;
		globalThis.clearInterval = clearIntervalMock as typeof clearInterval;
		const db = createMockDb([
			job({ id: "job-1", kind: "webhook.deliver", lockedBy: "worker-1" }),
		]);

		await runJob(
			db.rows[0],
			{ "webhook.deliver": mock(async () => {}) },
			{
				workerId: "worker-1",
				leaseSeconds: 60,
				db,
			},
		);

		expect(timerCallback).toBeInstanceOf(Function);
		expect(setIntervalMock).toHaveBeenCalledTimes(1);
		expect(clearIntervalMock).toHaveBeenCalledTimes(1);
		expect(db.rows[0].status).toBe("succeeded");
	});
});

function createMockDb(initialRows: MutableJob[]) {
	const rows = initialRows.map((row) => ({ ...row }));
	return {
		rows,
		update() {
			let patch: Partial<MutableJob> = {};
			let predicate: Predicate | undefined;
			return {
				set(nextPatch: Partial<MutableJob>) {
					patch = nextPatch;
					return this;
				},
				where(nextPredicate: Predicate) {
					predicate = nextPredicate;
					return this;
				},
				returning() {
					const matched = rows.filter((row) => matches(row, predicate));
					for (const row of matched) applyPatch(row, patch);
					return Promise.resolve(matched.map((row) => ({ id: row.id })));
				},
			};
		},
		select() {
			let predicate: Predicate | undefined;
			return {
				from() {
					return this;
				},
				where(nextPredicate: Predicate) {
					predicate = nextPredicate;
					return this;
				},
				limit(count: number) {
					return Promise.resolve(
						rows.filter((row) => matches(row, predicate)).slice(0, count),
					);
				},
			};
		},
	} as never;
}

function applyPatch(row: MutableJob, patch: Partial<MutableJob>) {
	const nextPatch = { ...patch };
	if (nextPatch.status !== undefined && typeof nextPatch.status !== "string") {
		nextPatch.status = row.attempts >= row.maxAttempts ? "dead" : "failed";
	}
	if (nextPatch.completedAt && !(nextPatch.completedAt instanceof Date)) {
		nextPatch.completedAt = row.attempts >= row.maxAttempts ? new Date() : null;
	}
	Object.assign(row, nextPatch);
}

function matches(row: MutableJob, predicate?: Predicate) {
	return extractConditions(predicate).every((condition) => {
		const actual = row[condition.field];
		if (condition.operator === "=") return actual === condition.value;
		if (actual instanceof Date && condition.value instanceof Date) {
			return actual.getTime() <= condition.value.getTime();
		}
		return false;
	});
}

function extractConditions(predicate?: Predicate): Condition[] {
	if (!predicate?.queryChunks) return [];
	const conditions: Condition[] = [];
	collectConditions(predicate.queryChunks, conditions);
	return conditions;
}

function collectConditions(chunks: unknown[], conditions: Condition[]) {
	for (let index = 0; index < chunks.length; index++) {
		const chunk = chunks[index] as {
			name?: string;
			value?: unknown;
			queryChunks?: unknown[];
		};
		if (chunk.queryChunks) collectConditions(chunk.queryChunks, conditions);
		if (!chunk.name) continue;

		const operatorChunk = chunks[index + 1] as { value?: unknown } | undefined;
		const valueChunk = chunks[index + 2] as { value?: unknown } | undefined;
		const operator = Array.isArray(operatorChunk?.value)
			? operatorChunk.value.join("").trim()
			: "";
		const field = fieldByColumn[chunk.name];
		if (!field || (operator !== "=" && operator !== "<=")) continue;
		conditions.push({ field, operator, value: valueChunk?.value });
	}
}

const fieldByColumn: Record<string, keyof MutableJob> = {
	id: "id",
	status: "status",
	locked_by: "lockedBy",
	lease_until: "leaseUntil",
};

function job(overrides: Partial<MutableJob> = {}): MutableJob {
	const now = new Date("2026-01-01T00:00:00.000Z");
	return {
		id: "job-1",
		kind: "webhook.deliver",
		status: "running",
		priority: 0,
		payload: { deliveryId: "delivery-1" },
		idempotencyKey: null,
		attempts: 1,
		maxAttempts: 3,
		runAt: now,
		lockedBy: "worker-1",
		lockedAt: now,
		leaseUntil: new Date(now.getTime() + 60_000),
		lastError: null,
		createdAt: now,
		updatedAt: now,
		completedAt: null,
		...overrides,
	} as MutableJob;
}
