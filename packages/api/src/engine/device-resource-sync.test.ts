import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.NODE_ENV = "test";

const refreshContact = mock(() =>
	Promise.resolve({ jid: "contact@s.whatsapp.net" }),
);
const repairContactAppState = mock(() => Promise.resolve());
const fetchGroups = mock(() => Promise.resolve([]));
const fetchNewsletter = mock(() => Promise.resolve(null));
const loggerInfo = mock(() => undefined);

mock.module("@whatsapp-flow/db", () => ({ db: {} }));
mock.module("@whatsapp-flow/whatsapp", () => ({
	connectionManager: {
		refreshContact,
		repairContactAppState,
		fetchGroups,
		fetchNewsletter,
	},
}));
mock.module("../observability/logger", () => ({
	logger: {
		info: loggerInfo,
		warn: mock(() => undefined),
		error: mock(() => undefined),
	},
}));
mock.module("../observability/metrics", () => ({
	incrementCounter: mock(() => undefined),
	observeHistogram: mock(() => undefined),
}));

const { processDeviceResourceSyncJob } = await import("./device-resource-sync");

type SyncRun = {
	id: string;
	jobId: string;
	deviceId: string;
	resource: "contacts" | "groups" | "newsletters";
	scopeKey: string;
	mode: "normal" | "repair";
	status:
		| "queued"
		| "running"
		| "succeeded"
		| "partial"
		| "failed"
		| "cancelled";
	claimAttempt: number | null;
	startedAt: Date | null;
	completedAt: Date | null;
	lastError: string | null;
	progress: number;
	discoveredCount: number;
	processedCount: number;
	createdCount: number;
	updatedCount: number;
	skippedCount: number;
	failedCount: number;
};

beforeEach(() => {
	refreshContact.mockReset();
	refreshContact.mockResolvedValue({ jid: "contact@s.whatsapp.net" });
	repairContactAppState.mockReset();
	repairContactAppState.mockResolvedValue();
	fetchGroups.mockReset();
	fetchGroups.mockResolvedValue([]);
	fetchNewsletter.mockReset();
	fetchNewsletter.mockResolvedValue(null);
	loggerInfo.mockClear();
});

describe("processDeviceResourceSyncJob", () => {
	test("persists a full group sync with authoritative participant reconciliation", async () => {
		const db = createProcessorDb({ resource: "groups" });
		const groups = [{ jid: "123@g.us", subject: "Support" }];
		fetchGroups.mockResolvedValue(groups);
		const persistGroups = mock(() =>
			Promise.resolve({
				processed: 1,
				created: 1,
				updated: 0,
				skipped: 0,
				failed: 0,
			}),
		);

		await processDeviceResourceSyncJob(
			job(),
			{
				persistContacts: mock(() => Promise.resolve(counts())),
				persistGroups,
				persistNewsletters: mock(() => Promise.resolve(counts())),
			},
			db as never,
		);

		expect(fetchGroups).toHaveBeenCalledWith("device-1", undefined);
		expect(persistGroups).toHaveBeenCalledWith({
			deviceId: "device-1",
			groups,
			authoritative: true,
			reconcileParticipants: true,
		});
		expect(db.run).toMatchObject({
			status: "succeeded",
			progress: 100,
			discoveredCount: 1,
			processedCount: 1,
			createdCount: 1,
			failedCount: 0,
			claimAttempt: 1,
		});
	});

	test("records partial newsletter fetch failures while persisting successful results", async () => {
		const db = createProcessorDb({
			resource: "newsletters",
			knownNewsletters: [
				"one@newsletter",
				"two@newsletter",
				"three@newsletter",
			],
		});
		fetchNewsletter.mockImplementation((_deviceId: string, jid: string) => {
			if (jid === "two@newsletter")
				return Promise.reject(new Error("unavailable"));
			if (jid === "three@newsletter") return Promise.resolve(null);
			return Promise.resolve({ jid, name: "One" });
		});
		const persistNewsletters = mock(() =>
			Promise.resolve({
				processed: 1,
				created: 0,
				updated: 1,
				skipped: 0,
				failed: 0,
			}),
		);

		await processDeviceResourceSyncJob(
			job(),
			{
				persistContacts: mock(() => Promise.resolve(counts())),
				persistGroups: mock(() => Promise.resolve(counts())),
				persistNewsletters,
			},
			db as never,
		);

		expect(persistNewsletters).toHaveBeenCalledWith({
			deviceId: "device-1",
			newsletters: [{ jid: "one@newsletter", name: "One" }],
		});
		expect(db.run).toMatchObject({
			status: "partial",
			discoveredCount: 3,
			processedCount: 1,
			updatedCount: 1,
			failedCount: 2,
		});
	});

	test("requeues retryable errors and marks exhausted attempts failed", async () => {
		for (const [attempts, expectedStatus] of [
			[1, "queued"],
			[5, "failed"],
		] as const) {
			const db = createProcessorDb({ resource: "groups" });
			fetchGroups.mockRejectedValueOnce(new Error("connection lost"));

			await expect(
				processDeviceResourceSyncJob(
					job({ attempts, maxAttempts: 5 }),
					{
						persistContacts: mock(() => Promise.resolve(counts())),
						persistGroups: mock(() => Promise.resolve(counts())),
						persistNewsletters: mock(() => Promise.resolve(counts())),
					},
					db as never,
				),
			).rejects.toThrow("connection lost");

			expect(db.run).toMatchObject({
				status: expectedStatus,
				claimAttempt: attempts,
				lastError: "connection lost",
			});
			expect(db.run.completedAt).toEqual(
				expectedStatus === "failed" ? expect.any(Date) : null,
			);
		}
	});

	test("does not process a job attempt that has already been claimed", async () => {
		const db = createProcessorDb({
			resource: "groups",
			status: "running",
			claimAttempt: 1,
		});
		const persistGroups = mock(() => Promise.resolve(counts()));

		await processDeviceResourceSyncJob(
			job(),
			{
				persistContacts: mock(() => Promise.resolve(counts())),
				persistGroups,
				persistNewsletters: mock(() => Promise.resolve(counts())),
			},
			db as never,
		);

		expect(fetchGroups).not.toHaveBeenCalled();
		expect(persistGroups).not.toHaveBeenCalled();
		expect(db.run).toMatchObject({ status: "running", claimAttempt: 1 });
	});

	test("does not let a stale attempt overwrite a newer claim on completion", async () => {
		const db = createProcessorDb({
			resource: "groups",
			staleOnCompletion: true,
		});
		fetchGroups.mockResolvedValue([{ jid: "123@g.us", subject: "Support" }]);

		await processDeviceResourceSyncJob(
			job(),
			{
				persistContacts: mock(() => Promise.resolve(counts())),
				persistGroups: mock(() => Promise.resolve(counts())),
				persistNewsletters: mock(() => Promise.resolve(counts())),
			},
			db as never,
		);

		expect(db.run).toMatchObject({
			status: "running",
			claimAttempt: 2,
			progress: 0,
			completedAt: null,
		});
		expect(loggerInfo).not.toHaveBeenCalledWith(
			"device.resource_sync.completed",
			expect.anything(),
		);
	});
});

function createProcessorDb(input: {
	resource: SyncRun["resource"];
	status?: SyncRun["status"];
	claimAttempt?: number | null;
	knownNewsletters?: string[];
	staleOnCompletion?: boolean;
}) {
	const run: SyncRun = {
		id: "sync-run-1",
		jobId: "job-1",
		deviceId: "device-1",
		resource: input.resource,
		scopeKey: "all",
		mode: "normal",
		status: input.status ?? "queued",
		claimAttempt: input.claimAttempt ?? null,
		startedAt: null,
		completedAt: null,
		lastError: null,
		progress: 0,
		discoveredCount: 0,
		processedCount: 0,
		createdCount: 0,
		updatedCount: 0,
		skippedCount: 0,
		failedCount: 0,
	};
	let selectSource = "";
	let staleApplied = false;

	const rowsForSource = () => {
		if (selectSource === "device_sync_run") return [run];
		if (selectSource === "device") return [{ provider: "baileys" }];
		if (selectSource === "channel") {
			return (input.knownNewsletters ?? []).map((jid) => ({ jid }));
		}
		return [];
	};
	const db = {
		run,
		select() {
			const query = Object.assign(Promise.resolve().then(rowsForSource), {
				from(table: unknown) {
					selectSource =
						(table as Record<symbol, string>)[Symbol.for("drizzle:Name")] ?? "";
					return query;
				},
				where() {
					return query;
				},
				limit() {
					return Promise.resolve(rowsForSource());
				},
			});
			return query;
		},
		update() {
			let patch: Partial<SyncRun> = {};
			let applied = false;
			const apply = () => {
				if (applied) return true;
				applied = true;
				if (patch.status === "running") {
					if (
						run.claimAttempt !== null &&
						patch.claimAttempt !== undefined &&
						run.claimAttempt >= patch.claimAttempt
					)
						return false;
					Object.assign(run, patch);
					return true;
				}
				if (patch.status === "succeeded" || patch.status === "partial") {
					if (input.staleOnCompletion && !staleApplied) {
						staleApplied = true;
						run.claimAttempt = 2;
						return false;
					}
					if (run.claimAttempt !== 1) return false;
				}
				Object.assign(run, patch);
				return true;
			};
			const query = Object.assign(
				Promise.resolve().then(() => {
					apply();
				}),
				{
					set(nextPatch: Partial<SyncRun>) {
						patch = nextPatch;
						return query;
					},
					where() {
						return query;
					},
					returning() {
						return Promise.resolve(apply() ? [{ id: run.id }] : []);
					},
				},
			);
			return query;
		},
	};
	return db;
}

function counts() {
	return { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
}

function job(
	overrides: Partial<{ attempts: number; maxAttempts: number }> = {},
) {
	return {
		id: "job-1",
		kind: "device.resource_sync" as const,
		payload: { syncRunId: "sync-run-1" },
		attempts: overrides.attempts ?? 1,
		maxAttempts: overrides.maxAttempts ?? 5,
	} as never;
}
