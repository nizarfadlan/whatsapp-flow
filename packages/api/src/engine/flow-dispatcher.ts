import { db } from "@whatsapp-flow/db";
import { flow, flowSession } from "@whatsapp-flow/db/schema/device";
import type { IncomingMessage } from "@whatsapp-flow/whatsapp";
import {
	connectionManager,
	matchesKeywordTrigger,
} from "@whatsapp-flow/whatsapp";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { matchesCronExpression } from "./cron";
import { enqueueJob } from "./job-queue";
import {
	messageFlowJobIdempotencyKey,
	resumeFlowJobIdempotencyKey,
	scheduledFlowJobIdempotencyKey,
} from "./job-types";

type DispatcherState = {
	messageStarted: boolean;
	scheduleStarted: boolean;
	scheduleTimer: ReturnType<typeof setInterval> | null;
	lastScheduleMinute: string | null;
	scheduleRunning: boolean;
};

type ScheduleTriggerConfig = {
	cronExpression?: string;
	contactNumber?: string;
};

const globalDispatcherState = globalThis as typeof globalThis & {
	__whatsappFlowDispatcher?: DispatcherState;
};

if (!globalDispatcherState.__whatsappFlowDispatcher) {
	globalDispatcherState.__whatsappFlowDispatcher = {
		messageStarted: false,
		scheduleStarted: false,
		scheduleTimer: null,
		lastScheduleMinute: null,
		scheduleRunning: false,
	};
}

const dispatcherState = globalDispatcherState.__whatsappFlowDispatcher;

export function startFlowDispatcher(): void {
	if (dispatcherState.messageStarted) return;
	dispatcherState.messageStarted = true;

	connectionManager.on("device:message", async (event: IncomingMessage) => {
		const { deviceId, message, contact } = event;
		const text = message.text ?? "";

		try {
			if (!contact.number) return;

			const waitingSession = await findActiveWaitingSession(
				deviceId,
				contact.number,
			);
			if (waitingSession) {
				await enqueueJob({
					kind: "flow.resume",
					payload: {
						sessionId: waitingSession.id,
						deviceId,
						contactNumber: contact.number,
						incomingText: text,
						replyJid: contact.jid,
						triggerMessageKey: message.messageKey,
						triggerProviderMessageId: message.providerMessageId,
					},
					idempotencyKey: resumeMessageIdempotencyKey(event, waitingSession.id),
				});
				return;
			}

			const flows = await db
				.select()
				.from(flow)
				.where(and(eq(flow.deviceId, deviceId), eq(flow.status, "active")));

			for (const flowRow of flows) {
				if (!flowRow.deviceId) continue;
				if (!matchesFlowTrigger(flowRow, text)) continue;

				await enqueueJob({
					kind: "flow.execute",
					payload: {
						flowId: flowRow.id,
						deviceId,
						contactNumber: contact.number,
						incomingText: text,
						replyJid: contact.jid,
						triggerSource: "message",
						triggerMessageKey: message.messageKey,
						triggerProviderMessageId: message.providerMessageId,
					},
					idempotencyKey: flowMessageIdempotencyKey(event, flowRow.id),
				});
			}
		} catch (error) {
			console.error("Failed to dispatch incoming WhatsApp message", {
				deviceId,
				contactNumber: contact.number,
				error,
			});
		}
	});
}

export function startScheduleDispatcher(): void {
	if (dispatcherState.scheduleStarted) return;
	dispatcherState.scheduleStarted = true;

	const tick = async () => {
		if (dispatcherState.scheduleRunning) return;

		const now = new Date();
		const minuteKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
		if (dispatcherState.lastScheduleMinute === minuteKey) return;

		dispatcherState.lastScheduleMinute = minuteKey;
		dispatcherState.scheduleRunning = true;

		try {
			const flows = await db
				.select()
				.from(flow)
				.where(
					and(eq(flow.status, "active"), eq(flow.triggerType, "schedule")),
				);

			for (const flowRow of flows) {
				const config = flowRow.triggerConfig as ScheduleTriggerConfig | null;
				const cronExpression = config?.cronExpression?.trim();
				const contactNumber = normalizeNumber(config?.contactNumber ?? "");

				if (!flowRow.deviceId) continue;
				if (!cronExpression || !contactNumber) continue;
				if (!matchesCronExpression(cronExpression, now)) continue;

				await enqueueJob({
					kind: "flow.execute",
					payload: {
						flowId: flowRow.id,
						deviceId: flowRow.deviceId,
						contactNumber,
						incomingText: "",
						triggerSource: "schedule",
					},
					idempotencyKey: scheduledFlowJobIdempotencyKey(flowRow.id, minuteKey),
				});
			}
		} catch (error) {
			console.error("Failed to dispatch scheduled flows", { error });
		} finally {
			dispatcherState.scheduleRunning = false;
		}
	};

	void tick();
	dispatcherState.scheduleTimer = setInterval(() => {
		void tick();
	}, 60_000);
}

async function findActiveWaitingSession(
	deviceId: string,
	contactNumber: string,
) {
	const [waiting] = await db
		.select({ id: flowSession.id })
		.from(flowSession)
		.where(
			and(
				eq(flowSession.deviceId, deviceId),
				eq(flowSession.contactNumber, contactNumber),
				eq(flowSession.status, "waiting"),
				or(
					isNull(flowSession.expiresAt),
					gt(flowSession.expiresAt, new Date()),
				),
			),
		)
		.limit(1);
	return waiting ?? null;
}

function flowMessageIdempotencyKey(event: IncomingMessage, flowId: string) {
	const providerMessageId = providerMessageIdFromEvent(event);
	if (!providerMessageId) return undefined;
	return messageFlowJobIdempotencyKey({
		provider: event.provider ?? "baileys",
		providerMessageId,
		flowId,
	});
}

function resumeMessageIdempotencyKey(
	event: IncomingMessage,
	sessionId: string,
) {
	const providerMessageId = providerMessageIdFromEvent(event);
	if (!providerMessageId) return undefined;
	return resumeFlowJobIdempotencyKey({
		provider: event.provider ?? "baileys",
		providerMessageId,
		sessionId,
	});
}

function providerMessageIdFromEvent(event: IncomingMessage) {
	return (
		event.message.providerMessageId ?? event.message.messageKey?.id ?? null
	);
}

function matchesFlowTrigger(
	flowRow: typeof flow.$inferSelect,
	messageText: string,
): boolean {
	switch (flowRow.triggerType) {
		case "any_message":
			return true;

		case "keyword": {
			const config = flowRow.triggerConfig as {
				keyword?: string;
				keywords?: string[];
			} | null;
			const keywords = config?.keywords?.length
				? config.keywords
				: config?.keyword;
			if (!keywords) return false;
			return matchesKeywordTrigger(messageText, keywords);
		}

		default:
			return false;
	}
}

function normalizeNumber(value: string) {
	return value.replace(/[^\d]/g, "");
}
