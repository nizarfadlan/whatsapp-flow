import type { WAMessageKey } from "baileys";

export type WebhookDeliverJobPayload = {
	deliveryId: string;
};

export type FlowExecuteJobPayload = {
	flowId: string;
	deviceId: string;
	contactNumber: string;
	incomingText: string;
	replyJid?: string;
	triggerSource: "message" | "schedule" | "webhook";
	triggerMessageKey?: WAMessageKey;
	triggerProviderMessageId?: string;
};

export type FlowResumeJobPayload = {
	sessionId: string;
	deviceId: string;
	contactNumber: string;
	incomingText: string;
	replyJid?: string;
	triggerMessageKey?: WAMessageKey;
	triggerProviderMessageId?: string;
};

export type FlowContinueJobPayload = {
	executionLogId: string;
	flowId: string;
	deviceId: string;
	contactNumber: string;
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
	contactNumber: string;
	replyJid?: string;
	waitingNodeId: string;
	warningId: string;
	afterMinutes: number;
	message: string;
	incomingText: string;
	variables: Record<string, unknown>;
	expiresAt: string;
};

export type JobPayloadByKind = {
	"webhook.deliver": WebhookDeliverJobPayload;
	"flow.execute": FlowExecuteJobPayload;
	"flow.resume": FlowResumeJobPayload;
	"flow.continue": FlowContinueJobPayload;
	"flow.wait_warning": FlowWaitWarningJobPayload;
};

export type JobKind = keyof JobPayloadByKind;

export function webhookDeliveryJobIdempotencyKey(deliveryId: string) {
	return `webhook:delivery:${deliveryId}`;
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
