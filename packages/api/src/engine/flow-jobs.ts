import { db } from "@whatsapp-flow/db";
import { flow, flowSession } from "@whatsapp-flow/db/schema/device";
import { sendDeviceMessage } from "@whatsapp-flow/whatsapp";
import { eq } from "drizzle-orm";
import { logger } from "../observability/logger";
import {
	continueFlowExecution,
	executeFlow,
	recordFlowExecutionEvent,
	resolveFlowTemplate,
	resumeWaitingSessionById,
} from "./flow-executor";
import type {
	FlowContinueJobPayload,
	FlowExecuteJobPayload,
	FlowResumeJobPayload,
	FlowWaitWarningJobPayload,
} from "./job-types";

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

export async function processFlowResumeJob(input: FlowResumeJobPayload) {
	const result = await resumeWaitingSessionById(
		input.sessionId,
		input.incomingText,
		input.replyJid ?? `${input.contactNumber}@s.whatsapp.net`,
		{
			messageKey: input.triggerMessageKey,
			providerMessageId: input.triggerProviderMessageId,
		},
	);

	if (result?.status === "failed") {
		logger.error("flow.session_resume.failed", {
			sessionId: input.sessionId,
			deviceId: input.deviceId,
			contactNumber: input.contactNumber,
			logId: result.logId,
			error: result.error,
		});
	}
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
	if (session.expiresAt && session.expiresAt <= new Date()) return;

	const text = resolveFlowTemplate(input.message, {
		contactNumber: input.contactNumber,
		incomingText: input.incomingText,
		variables: input.variables,
	});
	await sendDeviceMessage(
		input.deviceId,
		input.replyJid ?? `${input.contactNumber}@s.whatsapp.net`,
		{ type: "text", text },
	);
	await recordFlowExecutionEvent({
		executionLogId: input.executionLogId,
		flowId: input.flowId,
		deviceId: input.deviceId,
		contactNumber: input.contactNumber,
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
