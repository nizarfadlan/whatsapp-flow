import { db as defaultDb } from "@whatsapp-flow/db";
import { jobQueue } from "@whatsapp-flow/db/schema/job";
import { env } from "@whatsapp-flow/env/server";
import { eq, lte, sql } from "drizzle-orm";
import { logger } from "../observability/logger";
import { incrementCounter, observeHistogram } from "../observability/metrics";
import type { JobKind, JobPayloadByKind } from "./job-types";

type QueueDatabase = typeof defaultDb;
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
	database: QueueDatabase = defaultDb,
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

export async function completeJob(
	jobId: string,
	database: QueueDatabase = defaultDb,
) {
	await database
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
		.where(eq(jobQueue.id, jobId));
}

export async function failJob(
	jobId: string,
	error: unknown,
	database: QueueDatabase = defaultDb,
) {
	const [job] = await database
		.select()
		.from(jobQueue)
		.where(eq(jobQueue.id, jobId))
		.limit(1);
	if (!job) return "failed";

	const retry = job.attempts < job.maxAttempts;
	const status = retry ? "failed" : "dead";
	const now = new Date();
	await database
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
		.where(eq(jobQueue.id, jobId));
	return status;
}

export async function releaseExpiredLeases(
	database: QueueDatabase = defaultDb,
) {
	const result = await database
		.update(jobQueue)
		.set({
			status: "failed",
			lockedBy: null,
			lockedAt: null,
			leaseUntil: null,
			lastError: "Job lease expired before completion",
			updatedAt: new Date(),
		})
		.where(lte(jobQueue.leaseUntil, new Date()))
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
				jobs.map((job) => runJob(job, options.handlers, database)),
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

async function runJob(
	job: JobRecord,
	handlers: JobHandlers,
	database: QueueDatabase,
) {
	const handler = handlers[job.kind as JobKind] as
		| JobHandler<JobKind>
		| undefined;
	const startedAt = performance.now();
	try {
		if (!handler) throw new Error(`No job handler registered for ${job.kind}`);
		logger.info("job.claimed", {
			jobId: job.id,
			jobKind: job.kind,
			attempts: job.attempts,
		});
		await handler(job as JobRecord & { kind: JobKind; payload: never });
		await completeJob(job.id, database);
		incrementCounter("whatsapp_flow_jobs_completed_total", { kind: job.kind });
		logger.info("job.completed", {
			jobId: job.id,
			jobKind: job.kind,
			durationMs: performance.now() - startedAt,
		});
	} catch (error) {
		const status = await failJob(job.id, error, database);
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
		observeHistogram(
			"whatsapp_flow_job_duration_ms",
			{
				kind: job.kind,
			},
			performance.now() - startedAt,
		);
	}
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
