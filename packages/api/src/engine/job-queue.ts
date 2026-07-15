import { db as defaultDb } from "@whatsapp-flow/db";
import { jobQueue } from "@whatsapp-flow/db/schema/job";
import { env } from "@whatsapp-flow/env/server";
import { and, eq, lte, sql } from "drizzle-orm";
import { logger } from "../observability/logger";
import { incrementCounter, observeHistogram } from "../observability/metrics";
import type { JobKind, JobPayloadByKind } from "./job-types";

type QueueDatabase = typeof defaultDb;
type EnqueueDatabase = Pick<QueueDatabase, "insert" | "select">;
export type JobRecord = typeof jobQueue.$inferSelect;

type EnqueueJobInput<K extends JobKind> = {
	kind: K;
	payload: JobPayloadByKind[K];
	idempotencyKey?: string | null;
	priority?: number;
	runAt?: Date;
	maxAttempts?: number;
};

type ClaimJobsInput = {
	workerId: string;
	limit?: number;
	leaseSeconds?: number;
	db?: QueueDatabase;
};

type JobHandler<K extends JobKind> = (
	job: JobRecord & { kind: K; payload: JobPayloadByKind[K] },
) => Promise<void>;

export type JobHandlers = {
	[K in JobKind]?: JobHandler<K>;
};

type StartJobWorkerOptions = {
	workerId?: string;
	concurrency?: number;
	leaseSeconds?: number;
	pollIntervalMs?: number;
	handlers: JobHandlers;
	db?: QueueDatabase;
};

export async function enqueueJob<K extends JobKind>(
	input: EnqueueJobInput<K>,
	database: EnqueueDatabase = defaultDb,
) {
	const id = crypto.randomUUID();
	const [inserted] = await database
		.insert(jobQueue)
		.values({
			id,
			kind: input.kind,
			payload: input.payload,
			idempotencyKey: input.idempotencyKey ?? null,
			priority: input.priority ?? 0,
			runAt: input.runAt ?? new Date(),
			maxAttempts: input.maxAttempts ?? 5,
		})
		.onConflictDoNothing()
		.returning();

	if (inserted) {
		incrementCounter("whatsapp_flow_jobs_enqueued_total", { kind: input.kind });
		logger.info("job.enqueued", {
			jobId: inserted.id,
			jobKind: inserted.kind,
			runAt: inserted.runAt,
		});
		return inserted;
	}
	if (!input.idempotencyKey) {
		throw new Error("Job was not enqueued");
	}

	const [existing] = await database
		.select()
		.from(jobQueue)
		.where(eq(jobQueue.idempotencyKey, input.idempotencyKey))
		.limit(1);
	if (!existing) {
		throw new Error("Job idempotency conflict could not be resolved");
	}
	return existing;
}

export async function claimJobs(input: ClaimJobsInput) {
	const database = input.db ?? defaultDb;
	const limit = input.limit ?? env.JOB_WORKER_CONCURRENCY;
	const leaseSeconds = input.leaseSeconds ?? env.JOB_LEASE_SECONDS;
	const result = await database.execute(sql`
		with candidate_jobs as (
			select id
			from ${jobQueue}
			where status in ('pending', 'failed')
				and attempts < max_attempts
				and run_at <= now()
			order by priority desc, run_at asc, created_at asc
			limit ${limit}
			for update skip locked
		)
		update ${jobQueue}
		set
			status = 'running',
			locked_by = ${input.workerId},
			locked_at = now(),
			lease_until = now() + (${leaseSeconds} * interval '1 second'),
			attempts = attempts + 1,
			updated_at = now()
		where id in (select id from candidate_jobs)
		returning
			id,
			kind,
			status,
			priority,
			payload,
			idempotency_key as "idempotencyKey",
			attempts,
			max_attempts as "maxAttempts",
			run_at as "runAt",
			locked_by as "lockedBy",
			locked_at as "lockedAt",
			lease_until as "leaseUntil",
			last_error as "lastError",
			created_at as "createdAt",
			updated_at as "updatedAt",
			completed_at as "completedAt"
	`);
	return rowsFromResult<JobRecord>(result);
}

type JobCompletionResult = "completed" | "lost";
type JobFailureResult = "failed" | "dead" | "lost";

export async function renewJobLease(
	jobId: string,
	workerId: string,
	leaseSeconds: number,
	database: QueueDatabase = defaultDb,
): Promise<boolean> {
	const now = new Date();
	const result = await database
		.update(jobQueue)
		.set({
			leaseUntil: new Date(now.getTime() + leaseSeconds * 1_000),
			updatedAt: now,
		})
		.where(runningJobOwnedBy(jobId, workerId))
		.returning({ id: jobQueue.id });
	return result.length > 0;
}

export async function completeJob(
	jobId: string,
	workerId: string,
	database: QueueDatabase = defaultDb,
): Promise<JobCompletionResult> {
	const result = await database
		.update(jobQueue)
		.set({
			status: "succeeded",
			lockedBy: null,
			lockedAt: null,
			leaseUntil: null,
			lastError: null,
			completedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(runningJobOwnedBy(jobId, workerId))
		.returning({ id: jobQueue.id });
	return result.length > 0 ? "completed" : "lost";
}

export async function failJob(
	jobId: string,
	workerId: string,
	error: unknown,
	database: QueueDatabase = defaultDb,
): Promise<JobFailureResult> {
	const [job] = await database
		.select()
		.from(jobQueue)
		.where(runningJobOwnedBy(jobId, workerId))
		.limit(1);
	if (!job) return "lost";

	const retry = job.attempts < job.maxAttempts;
	const status = retry ? "failed" : "dead";
	const now = new Date();
	const result = await database
		.update(jobQueue)
		.set({
			status,
			lockedBy: null,
			lockedAt: null,
			leaseUntil: null,
			lastError: serializeJobError(error),
			runAt: retry ? nextRetryAt(job.attempts, now) : job.runAt,
			completedAt: retry ? null : now,
			updatedAt: now,
		})
		.where(runningJobOwnedBy(jobId, workerId))
		.returning({ id: jobQueue.id });
	return result.length > 0 ? status : "lost";
}

export async function releaseExpiredLeases(
	database: QueueDatabase = defaultDb,
) {
	const result = await database
		.update(jobQueue)
		.set({
			status: sql`case when ${jobQueue.attempts} >= ${jobQueue.maxAttempts} then 'dead'::job_status else 'failed'::job_status end`,
			lockedBy: null,
			lockedAt: null,
			leaseUntil: null,
			lastError: "Job lease expired before completion",
			completedAt: sql`case when ${jobQueue.attempts} >= ${jobQueue.maxAttempts} then now() else null end`,
			updatedAt: new Date(),
		})
		.where(
			and(eq(jobQueue.status, "running"), lte(jobQueue.leaseUntil, new Date())),
		)
		.returning({ id: jobQueue.id });
	return result.map((row) => row.id);
}

export function startJobWorker(options: StartJobWorkerOptions) {
	if (!env.JOB_WORKER_ENABLED) {
		return { workerId: options.workerId ?? "disabled", stop: () => undefined };
	}

	const database = options.db ?? defaultDb;
	const workerId = options.workerId ?? `job-worker:${crypto.randomUUID()}`;
	const concurrency = options.concurrency ?? env.JOB_WORKER_CONCURRENCY;
	const leaseSeconds = options.leaseSeconds ?? env.JOB_LEASE_SECONDS;
	const pollIntervalMs = options.pollIntervalMs ?? 1_000;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const schedule = () => {
		if (stopped) return;
		timer = setTimeout(() => {
			void tick();
		}, pollIntervalMs);
	};

	const tick = async () => {
		try {
			await releaseExpiredLeases(database);
			const jobs = await claimJobs({
				workerId,
				limit: concurrency,
				leaseSeconds,
				db: database,
			});
			await Promise.all(
				jobs.map((job) =>
					runJob(job, options.handlers, {
						workerId,
						leaseSeconds,
						db: database,
					}),
				),
			);
		} finally {
			schedule();
		}
	};

	void tick();

	return {
		workerId,
		stop: () => {
			stopped = true;
			if (timer) clearTimeout(timer);
		},
	};
}

type RunJobOptions = {
	workerId: string;
	leaseSeconds: number;
	db: QueueDatabase;
};

export async function runJob(
	job: JobRecord,
	handlers: JobHandlers,
	options: RunJobOptions,
) {
	const handler = handlers[job.kind as JobKind] as
		| JobHandler<JobKind>
		| undefined;
	const startedAt = performance.now();
	const stopHeartbeat = startLeaseHeartbeat({
		jobId: job.id,
		workerId: options.workerId,
		leaseSeconds: options.leaseSeconds,
		db: options.db,
	});
	try {
		if (!handler) throw new Error(`No job handler registered for ${job.kind}`);
		logger.info("job.claimed", {
			jobId: job.id,
			jobKind: job.kind,
			attempts: job.attempts,
		});
		await handler(job as JobRecord & { kind: JobKind; payload: never });
		const result = await completeJob(job.id, options.workerId, options.db);
		if (result === "lost") {
			logger.warn("job.completion_lost_ownership", {
				jobId: job.id,
				jobKind: job.kind,
				durationMs: performance.now() - startedAt,
			});
			return;
		}
		incrementCounter("whatsapp_flow_jobs_completed_total", { kind: job.kind });
		logger.info("job.completed", {
			jobId: job.id,
			jobKind: job.kind,
			durationMs: performance.now() - startedAt,
		});
	} catch (error) {
		const status = await failJob(job.id, options.workerId, error, options.db);
		if (status === "lost") {
			logger.warn("job.failure_lost_ownership", {
				jobId: job.id,
				jobKind: job.kind,
				durationMs: performance.now() - startedAt,
				error,
			});
			return;
		}
		incrementCounter(
			status === "dead"
				? "whatsapp_flow_jobs_dead_total"
				: "whatsapp_flow_jobs_failed_total",
			{ kind: job.kind },
		);
		logger[status === "dead" ? "error" : "warn"](
			status === "dead" ? "job.dead" : "job.failed",
			{
				jobId: job.id,
				jobKind: job.kind,
				durationMs: performance.now() - startedAt,
				error,
			},
		);
	} finally {
		stopHeartbeat();
		observeHistogram(
			"whatsapp_flow_job_duration_ms",
			{
				kind: job.kind,
			},
			performance.now() - startedAt,
		);
	}
}

function runningJobOwnedBy(jobId: string, workerId: string) {
	return and(
		eq(jobQueue.id, jobId),
		eq(jobQueue.status, "running"),
		eq(jobQueue.lockedBy, workerId),
	);
}

function heartbeatIntervalMs(leaseSeconds: number) {
	return Math.max(100, Math.floor((leaseSeconds * 1_000) / 3));
}

type LeaseHeartbeatInput = {
	jobId: string;
	workerId: string;
	leaseSeconds: number;
	db: QueueDatabase;
};

function startLeaseHeartbeat(input: LeaseHeartbeatInput) {
	const timer = setInterval(() => {
		void renewJobLease(
			input.jobId,
			input.workerId,
			input.leaseSeconds,
			input.db,
		)
			.then((renewed) => {
				if (!renewed) {
					logger.warn("job.heartbeat_lost_ownership", {
						jobId: input.jobId,
						workerId: input.workerId,
					});
				}
			})
			.catch((error) => {
				logger.warn("job.heartbeat_failed", {
					jobId: input.jobId,
					workerId: input.workerId,
					error,
				});
			});
	}, heartbeatIntervalMs(input.leaseSeconds));

	return () => clearInterval(timer);
}

function nextRetryAt(attempts: number, now: Date) {
	const baseMs = 15_000 * 2 ** Math.max(attempts, 0);
	const jitterMs = Math.floor(Math.random() * 1_000);
	return new Date(now.getTime() + Math.min(baseMs + jitterMs, 15 * 60_000));
}

function serializeJobError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.slice(0, 2_000);
}

function rowsFromResult<T>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	if (result && typeof result === "object" && "rows" in result) {
		return (result as { rows: T[] }).rows;
	}
	return [];
}
