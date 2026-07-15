import { db as defaultDb } from "@whatsapp-flow/db";
import { flowExecutionLog, flowSession } from "@whatsapp-flow/db/schema/device";
import { jobQueue } from "@whatsapp-flow/db/schema/job";
import { env } from "@whatsapp-flow/env/server";
import { and, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { logger } from "../observability/logger";
import {
	emitFlowSessionUpdated,
	enqueueFlowWaitTimeoutJob,
	recordFlowExecutionEvent,
} from "./flow-executor";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_INTERVAL_MS = 30_000;

type ReconciliationDatabase = typeof defaultDb;

type ReconcileOptions = {
	db?: ReconciliationDatabase;
	now?: Date;
	limit?: number;
};

export type RunningSessionOwnerState =
	| "keep"
	| "legacy_missing_claim"
	| "owner_missing"
	| "owner_terminal";

export function isOverdueWaitingSession(input: {
	status: string;
	expiresAt?: Date | null;
	now: Date;
}) {
	return (
		input.status === "waiting" &&
		!!input.expiresAt &&
		input.expiresAt <= input.now
	);
}

export function classifyRunningSessionOwner(input: {
	claimJobId: string | null;
	jobStatus?: string | null;
	leaseUntil?: Date | null;
	now: Date;
}): RunningSessionOwnerState {
	if (!input.claimJobId) return "legacy_missing_claim";
	if (!input.jobStatus) return "owner_missing";
	if (input.jobStatus === "pending" || input.jobStatus === "failed")
		return "keep";
	if (input.jobStatus === "running") return "keep";
	return "owner_terminal";
}

export async function reconcileOverdueWaitingSessions(
	options: ReconcileOptions = {},
) {
	const database = options.db ?? defaultDb;
	const now = options.now ?? new Date();
	const limit = options.limit ?? DEFAULT_BATCH_SIZE;
	const sessions = await database
		.select()
		.from(flowSession)
		.where(
			and(
				eq(flowSession.status, "waiting"),
				isNotNull(flowSession.expiresAt),
				lte(flowSession.expiresAt, now),
			),
		)
		.limit(limit);

	let expiredCount = 0;
	for (const session of sessions) {
		const [expired] = await database
			.update(flowSession)
			.set({
				status: "expired",
				claimJobId: null,
				claimedAt: null,
				failureCode: "wait_timeout_reconciled",
				recoveryCount: sql`${flowSession.recoveryCount} + 1`,
				lastRecoveryAt: now,
				completedAt: now,
			})
			.where(
				and(
					eq(flowSession.id, session.id),
					eq(flowSession.status, "waiting"),
					isNotNull(flowSession.expiresAt),
					lte(flowSession.expiresAt, now),
				),
			)
			.returning();
		if (!expired) continue;
		expiredCount += 1;
		await database
			.update(flowExecutionLog)
			.set({
				status: "failed",
				error: "Flow session expired",
				completedAt: now,
			})
			.where(eq(flowExecutionLog.id, expired.executionLogId));
		await recordFlowExecutionEvent({
			executionLogId: expired.executionLogId,
			flowId: expired.flowId,
			deviceId: expired.deviceId,
			contactNumber: expired.contactNumber,
			contactKey: expired.contactKey,
			sessionId: expired.id,
			type: "session.expired",
			nodeId: expired.waitingNodeId,
			message: "Flow session expired by reconciliation",
			payload: { source: "flow_reconciliation" },
		});
		emitFlowSessionUpdated(expired);
	}
	return expiredCount;
}

export async function enqueueMissingWaitTimeoutJobs(
	options: ReconcileOptions = {},
) {
	const database = options.db ?? defaultDb;
	const now = options.now ?? new Date();
	const limit = options.limit ?? DEFAULT_BATCH_SIZE;
	const sessions = await database
		.select({
			id: flowSession.id,
			waitingNodeId: flowSession.waitingNodeId,
			expiresAt: flowSession.expiresAt,
		})
		.from(flowSession)
		.where(
			and(
				eq(flowSession.status, "waiting"),
				isNotNull(flowSession.expiresAt),
				gt(flowSession.expiresAt, now),
			),
		)
		.limit(limit);

	let enqueuedCount = 0;
	for (const session of sessions) {
		if (!session.expiresAt) continue;
		await enqueueFlowWaitTimeoutJob({
			sessionId: session.id,
			waitingNodeId: session.waitingNodeId,
			expiresAt: session.expiresAt,
		});
		enqueuedCount += 1;
	}
	return enqueuedCount;
}

export async function reconcileRunningSessions(options: ReconcileOptions = {}) {
	const database = options.db ?? defaultDb;
	const now = options.now ?? new Date();
	const limit = options.limit ?? DEFAULT_BATCH_SIZE;
	const rows = await database
		.select({
			session: flowSession,
			jobId: jobQueue.id,
			jobStatus: jobQueue.status,
			leaseUntil: jobQueue.leaseUntil,
		})
		.from(flowSession)
		.leftJoin(jobQueue, eq(flowSession.claimJobId, jobQueue.id))
		.where(eq(flowSession.status, "running"))
		.limit(limit);

	let failedCount = 0;
	for (const row of rows) {
		const session = row.session;
		const ownerState = classifyRunningSessionOwner({
			claimJobId: session.claimJobId,
			jobStatus: row.jobStatus,
			leaseUntil: row.leaseUntil,
			now,
		});
		if (ownerState === "keep") continue;

		const [failed] = await database
			.update(flowSession)
			.set({
				status: "failed",
				claimJobId: null,
				claimedAt: null,
				failureCode: ownerState,
				recoveryCount: sql`${flowSession.recoveryCount} + 1`,
				lastRecoveryAt: now,
				completedAt: now,
			})
			.where(
				and(
					eq(flowSession.id, session.id),
					eq(flowSession.status, "running"),
					session.claimJobId
						? eq(flowSession.claimJobId, session.claimJobId)
						: isNull(flowSession.claimJobId),
				),
			)
			.returning();
		if (!failed) continue;
		failedCount += 1;
		await database
			.update(flowExecutionLog)
			.set({
				status: "failed",
				error: `Flow session recovery failed: ${ownerState}`,
				completedAt: now,
			})
			.where(
				and(
					eq(flowExecutionLog.id, failed.executionLogId),
					inArray(flowExecutionLog.status, ["running", "waiting"]),
				),
			);
		await recordFlowExecutionEvent({
			executionLogId: failed.executionLogId,
			flowId: failed.flowId,
			deviceId: failed.deviceId,
			contactNumber: failed.contactNumber,
			contactKey: failed.contactKey,
			sessionId: failed.id,
			type: "session.recovery_failed",
			nodeId: failed.waitingNodeId,
			message: `Running session failed by reconciliation: ${ownerState}`,
			payload: {
				source: "flow_reconciliation",
				ownerState,
				claimJobId: session.claimJobId,
				ownerJobStatus: row.jobStatus,
			},
		});
		emitFlowSessionUpdated(failed);
	}
	return failedCount;
}

export async function reconcileFlowSessions(options: ReconcileOptions = {}) {
	const overdueExpired = await reconcileOverdueWaitingSessions(options);
	const missingTimeoutJobs = await enqueueMissingWaitTimeoutJobs(options);
	const runningFailed = await reconcileRunningSessions(options);
	return { overdueExpired, missingTimeoutJobs, runningFailed };
}

export function startFlowSessionReconciler(options: ReconcileOptions = {}) {
	if (!env.JOB_WORKER_ENABLED) {
		return { stop: () => undefined };
	}
	const intervalMs = DEFAULT_INTERVAL_MS;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const tick = async () => {
		try {
			const result = await reconcileFlowSessions(options);
			logger.info("flow.reconciliation.completed", result);
		} catch (error) {
			logger.error("flow.reconciliation.failed", { error });
		} finally {
			if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
		}
	};

	timer = setTimeout(() => void tick(), intervalMs);
	return {
		stop: () => {
			stopped = true;
			if (timer) clearTimeout(timer);
		},
	};
}
