import type { IncomingReplyDescriptor } from "@whatsapp-flow/whatsapp";
import type { WAMessageKey } from "baileys";

export type WebhookDeliverJobPayload = {
	deliveryId: string;
};

export type FlowExecuteJobPayload = {
	flowId: string;
	deviceId: string;
	contactNumber: string | null;
	contactKey: string;
	incomingText: string;
	replyJid?: string;
	triggerSource: "message" | "schedule" | "webhook";
	triggerMessageKey?: WAMessageKey;
	triggerProviderMessageId?: string;
};

export type FlowResumeJobPayload = {
	sessionId: string;
	deviceId: string;
	contactNumber: string | null;
	contactKey: string;
	incomingText: string;
	reply?: IncomingReplyDescriptor;
	replyJid?: string;
	triggerMessageKey?: WAMessageKey;
	triggerProviderMessageId?: string;
};

export type FlowPollResumeJobPayload = {
	deviceId: string;
	pollCreationKey: WAMessageKey;
	pollCreationMessageId: string;
	voterJid: string;
	voterNumber?: string;
	voterLid?: string;
	voterIdentityKey: string;
	selectedOptionText: string;
	updateIdentity: string;
};

export type FlowContinueJobPayload = {
	executionLogId: string;
	flowId: string;
	deviceId: string;
	contactNumber: string | null;
	contactKey: string;
	incomingText: string;
	replyJid?: string;
	sessionId?: string;
	variables: Record<string, unknown>;
	nodeResults: unknown[];
	nextNodeIds: string[];
	triggerMessageKey?: WAMessageKey;
	triggerProviderMessageId?: string;
};

export type FlowWaitWarningJobPayload = {
	sessionId: string;
	executionLogId: string;
	flowId: string;
	deviceId: string;
	contactNumber: string | null;
	contactKey: string;
	replyJid?: string;
	waitingNodeId: string;
	warningId: string;
	afterMinutes: number;
	message: string;
	incomingText: string;
	variables: Record<string, unknown>;
	expiresAt: string;
};

export type FlowWaitTimeoutJobPayload = {
	sessionId: string;
	waitingNodeId: string;
	expiresAt: string;
};

export type DeviceResourceSyncJobPayload = {
	syncRunId: string;
};

export type JobPayloadByKind = {
	"webhook.deliver": WebhookDeliverJobPayload;
	"flow.execute": FlowExecuteJobPayload;
	"flow.resume": FlowResumeJobPayload;
	"flow.poll_resume": FlowPollResumeJobPayload;
	"flow.continue": FlowContinueJobPayload;
	"flow.wait_warning": FlowWaitWarningJobPayload;
	"flow.wait_timeout": FlowWaitTimeoutJobPayload;
	"device.resource_sync": DeviceResourceSyncJobPayload;
};

export type JobKind = keyof JobPayloadByKind;

export function webhookDeliveryJobIdempotencyKey(deliveryId: string) {
	return `webhook:delivery:${deliveryId}`;
}

export function deviceResourceSyncJobIdempotencyKey(syncRunId: string) {
	return `device:resource-sync:${syncRunId}`;
}

export function scheduledFlowJobIdempotencyKey(
	flowId: string,
	minuteKey: string,
) {
	return `flow:schedule:${flowId}:${minuteKey}`;
}

export function messageFlowJobIdempotencyKey(input: {
	provider: string;
	providerMessageId: string;
	flowId: string;
}) {
	return `flow:message:${input.provider}:${input.providerMessageId}:${input.flowId}`;
}

export function resumeFlowJobIdempotencyKey(input: {
	provider: string;
	providerMessageId: string;
	sessionId: string;
}) {
	return `flow:resume:${input.provider}:${input.providerMessageId}:${input.sessionId}`;
}

export function pollResumeJobIdempotencyKey(input: {
	deviceId: string;
	pollCreationMessageId: string;
	updateIdentity: string;
}) {
	return `flow:poll-resume:${input.deviceId}:${input.pollCreationMessageId}:${input.updateIdentity}`;
}

export function delayFlowContinuationJobIdempotencyKey(input: {
	executionLogId: string;
	nodeId: string;
}) {
	return `flow:continue:${input.executionLogId}:${input.nodeId}`;
}

export function waitWarningJobIdempotencyKey(input: {
	sessionId: string;
	waitingNodeId: string;
	warningId: string;
	expiresAt: string;
}) {
	return `flow:wait-warning:${input.sessionId}:${input.waitingNodeId}:${input.warningId}:${input.expiresAt}`;
}

export function waitTimeoutJobIdempotencyKey(input: {
	sessionId: string;
	waitingNodeId: string;
	expiresAt: string;
}) {
	return `flow:wait-timeout:${input.sessionId}:${input.waitingNodeId}:${input.expiresAt}`;
}
