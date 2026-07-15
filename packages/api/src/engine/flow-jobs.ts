import { db } from "@whatsapp-flow/db";
import {
	flow,
	flowExecutionLog,
	flowSession,
} from "@whatsapp-flow/db/schema/device";
import {
	derivePrivateIdentityKey,
	sendDeviceMessage,
} from "@whatsapp-flow/whatsapp";
import { and, eq, lte } from "drizzle-orm";
import { logger } from "../observability/logger";
import {
	continueFlowExecution,
	emitFlowSessionUpdated,
	executeFlow,
	parseInteractiveWaitContext,
	recordFlowExecutionEvent,
	resolveFlowTemplate,
	resumeWaitingSessionById,
} from "./flow-executor";
import type { JobRecord } from "./job-queue";
import type {
	FlowContinueJobPayload,
	FlowExecuteJobPayload,
	FlowPollResumeJobPayload,
	FlowResumeJobPayload,
	FlowWaitTimeoutJobPayload,
	FlowWaitWarningJobPayload,
} from "./job-types";

function resolveJobReplyJid(input: {
	replyJid?: string;
	contactNumber: string | null;
	contactKey: string;
}) {
	if (input.replyJid) return input.replyJid;
	if (input.contactNumber) return `${input.contactNumber}@s.whatsapp.net`;
	if (
		input.contactKey.startsWith("lid:") ||
		input.contactKey.startsWith("jid:")
	) {
		return input.contactKey.slice(input.contactKey.indexOf(":") + 1);
	}
	return null;
}

export async function processFlowExecuteJob(input: FlowExecuteJobPayload) {
	const [flowRow] = await db
		.select()
		.from(flow)
		.where(eq(flow.id, input.flowId))
		.limit(1);

	if (!flowRow) return;

	const result = await executeFlow(
		flowRow,
		input.contactNumber,
		input.incomingText,
		{
			replyJid: input.replyJid,
			contactKey: input.contactKey,
			triggerSource: input.triggerSource,
			triggerMessageKey: input.triggerMessageKey,
			triggerProviderMessageId: input.triggerProviderMessageId,
		},
	);

	if (result.status === "failed") {
		logger.error("flow.execution.failed", {
			flowId: input.flowId,
			deviceId: input.deviceId,
			contactNumber: input.contactNumber,
			logId: result.logId,
			error: result.error,
		});
	}
}

export async function processFlowResumeJob(
	job: JobRecord & { kind: "flow.resume"; payload: FlowResumeJobPayload },
) {
	const input = job.payload;
	const replyJid = resolveJobReplyJid(input);
	if (!replyJid) return;

	const result = await resumeWaitingSessionById(
		input.sessionId,
		input.incomingText,
		replyJid,
		{
			messageKey: input.triggerMessageKey,
			providerMessageId: input.triggerProviderMessageId,
		},
		job.id,
		input.reply,
	);

	if (!result) {
		logger.info("flow.session_resume.noop", {
			jobId: job.id,
			sessionId: input.sessionId,
			deviceId: input.deviceId,
			contactNumber: input.contactNumber,
		});
		return;
	}

	if (result.status === "failed") {
		logger.error("flow.session_resume.failed", {
			sessionId: input.sessionId,
			deviceId: input.deviceId,
			contactNumber: input.contactNumber,
			logId: result.logId,
			error: result.error,
		});
	}
}

export async function processFlowPollResumeJob(
	job: JobRecord & {
		kind: "flow.poll_resume";
		payload: FlowPollResumeJobPayload;
	},
) {
	const input = job.payload;
	const [session] = await db
		.select()
		.from(flowSession)
		.where(
			and(
				eq(flowSession.deviceId, input.deviceId),
				eq(flowSession.waitingProviderMessageId, input.pollCreationMessageId),
			),
		)
		.limit(1);
	if (!session) {
		throw new Error("poll_wait_binding_not_visible");
	}
	if (session.status !== "waiting") return;
	const context = parseInteractiveWaitContext(session.waitContext);
	if (!context) {
		logger.info("flow.poll_resume.noop", {
			reason: "wrong_poll_binding",
			jobId: job.id,
		});
		return;
	}
	if (
		context.kind !== "poll" ||
		context.deliveryMode !== "native_poll" ||
		!sameMessageKey(context.pollMessageKey, input.pollCreationKey)
	) {
		logger.info("flow.poll_resume.noop", {
			reason: "wrong_poll_binding",
			jobId: job.id,
		});
		return;
	}
	const voterIdentity = derivePrivateIdentityKey({
		jid: input.voterJid,
		number: input.voterNumber,
		lid: input.voterLid,
	});
	if (voterIdentity !== session.contactKey) {
		logger.info("flow.poll_resume.noop", {
			reason: "wrong_voter",
			jobId: job.id,
		});
		return;
	}
	const selected = context.options.find(
		(option) => option.text === input.selectedOptionText,
	);
	if (!selected) {
		logger.info("flow.poll_resume.noop", {
			reason: "wrong_option",
			jobId: job.id,
		});
		return;
	}
	await resumeWaitingSessionById(
		session.id,
		selected.text,
		input.voterJid,
		undefined,
		job.id,
	);
}

function sameMessageKey(
	left: import("baileys").WAMessageKey | undefined,
	right: import("baileys").WAMessageKey,
) {
	return Boolean(
		left &&
			left.id === right.id &&
			left.remoteJid === right.remoteJid &&
			(left.fromMe ?? false) === (right.fromMe ?? false) &&
			(left.participant ?? "") === (right.participant ?? ""),
	);
}

export async function processFlowContinueJob(input: FlowContinueJobPayload) {
	const result = await continueFlowExecution(input);

	if (result.status === "failed") {
		logger.error("flow.continuation.failed", {
			executionLogId: input.executionLogId,
			flowId: input.flowId,
			deviceId: input.deviceId,
			contactNumber: input.contactNumber,
			logId: result.logId,
			error: result.error,
		});
	}
}

export function isMatchingWaitTimeoutGeneration(input: {
	sessionId: string;
	sessionStatus: string;
	sessionWaitingNodeId: string;
	sessionExpiresAt: Date | null;
	jobSessionId: string;
	jobWaitingNodeId: string;
	jobExpiresAt: string;
	now: Date;
}) {
	return (
		input.sessionId === input.jobSessionId &&
		input.sessionStatus === "waiting" &&
		input.sessionWaitingNodeId === input.jobWaitingNodeId &&
		input.sessionExpiresAt?.toISOString() === input.jobExpiresAt &&
		input.sessionExpiresAt <= input.now
	);
}

export async function processFlowWaitTimeoutJob(
	input: FlowWaitTimeoutJobPayload,
) {
	const expiresAt = new Date(input.expiresAt);
	if (Number.isNaN(expiresAt.getTime())) return;

	const [expired] = await db
		.update(flowSession)
		.set({
			status: "expired",
			claimJobId: null,
			claimedAt: null,
			failureCode: "wait_timeout",
			completedAt: new Date(),
		})
		.where(
			and(
				eq(flowSession.id, input.sessionId),
				eq(flowSession.status, "waiting"),
				eq(flowSession.waitingNodeId, input.waitingNodeId),
				eq(flowSession.expiresAt, expiresAt),
				lte(flowSession.expiresAt, new Date()),
			),
		)
		.returning();

	if (!expired) return;

	await db
		.update(flowExecutionLog)
		.set({
			status: "failed",
			error: "Flow session expired",
			completedAt: new Date(),
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
		message: "Flow session expired",
		payload: { expiresAt: expiresAt.toISOString(), source: "timeout_job" },
	});
	emitFlowSessionUpdated(expired);
}

export async function processFlowWaitWarningJob(
	input: FlowWaitWarningJobPayload,
) {
	const [session] = await db
		.select()
		.from(flowSession)
		.where(eq(flowSession.id, input.sessionId))
		.limit(1);

	if (!session) return;
	if (session.status !== "waiting") return;
	if (session.waitingNodeId !== input.waitingNodeId) return;
	if (session.expiresAt?.toISOString() !== input.expiresAt) return;
	if (session.expiresAt && session.expiresAt <= new Date()) return;

	const text = resolveFlowTemplate(input.message, {
		contactNumber: input.contactNumber,
		contactKey: input.contactKey,
		incomingText: input.incomingText,
		variables: input.variables,
	});
	const replyJid = resolveJobReplyJid(input);
	if (!replyJid) return;
	await sendDeviceMessage(input.deviceId, replyJid, { type: "text", text });
	await recordFlowExecutionEvent({
		executionLogId: input.executionLogId,
		flowId: input.flowId,
		deviceId: input.deviceId,
		contactNumber: input.contactNumber,
		contactKey: input.contactKey,
		sessionId: input.sessionId,
		type: "session.warning_sent",
		nodeId: input.waitingNodeId,
		message: `Wait warning sent after ${input.afterMinutes}m`,
		payload: {
			warningId: input.warningId,
			afterMinutes: input.afterMinutes,
			messagePreview: text.slice(0, 120),
		},
	});
}
