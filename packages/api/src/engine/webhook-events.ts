export const WEBHOOK_EVENT_TYPES = [
	"message.received",
	"device.status_changed",
	"flow.execution.started",
	"flow.execution.completed",
	"flow.execution.failed",
	"flow.session.waiting",
	"flow.session.resumed",
	"flow.session.expired",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const FLOW_EXECUTION_WEBHOOK_EVENT_MAP: Record<
	string,
	WebhookEventType
> = {
	"execution.started": "flow.execution.started",
	"execution.completed": "flow.execution.completed",
	"execution.failed": "flow.execution.failed",
	"session.waiting": "flow.session.waiting",
	"session.resumed": "flow.session.resumed",
	"session.expired": "flow.session.expired",
};
