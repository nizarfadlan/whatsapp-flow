import { db } from "@whatsapp-flow/db";
import { flow } from "@whatsapp-flow/db/schema/device";
import type { IncomingMessage } from "@whatsapp-flow/whatsapp";
import {
	connectionManager,
	matchesKeywordTrigger,
} from "@whatsapp-flow/whatsapp";
import { and, eq } from "drizzle-orm";
import { matchesCronExpression } from "./cron";
import { executeFlow, resumeWaitingSession } from "./flow-executor";

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

			const resumed = await resumeWaitingSession(
				deviceId,
				contact.number,
				text,
				contact.jid,
				message.messageKey,
			);
			if (resumed) return;

			const flows = await db
				.select()
				.from(flow)
				.where(and(eq(flow.deviceId, deviceId), eq(flow.status, "active")));

			for (const flowRow of flows) {
				if (!matchesFlowTrigger(flowRow, text)) continue;

				const result = await executeFlow(flowRow, contact.number, text, {
					replyJid: contact.jid,
					triggerSource: "message",
					triggerMessageKey: message.messageKey,
				});
				if (result.status === "failed") {
					console.error("Message flow execution failed", {
						flowId: flowRow.id,
						deviceId,
						contactNumber: contact.number,
						logId: result.logId,
						error: result.error,
					});
				}
				if (result.status === "waiting") return;
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

				if (!cronExpression || !contactNumber) continue;
				if (!matchesCronExpression(cronExpression, now)) continue;

				const result = await executeFlow(flowRow, contactNumber, "", {
					triggerSource: "schedule",
				});
				if (result.status === "skipped") {
					console.warn("Scheduled flow execution skipped", {
						flowId: flowRow.id,
						deviceId: flowRow.deviceId,
						contactNumber,
						error: result.error,
					});
				}
				if (result.status === "failed") {
					console.error("Scheduled flow execution failed", {
						flowId: flowRow.id,
						deviceId: flowRow.deviceId,
						contactNumber,
						logId: result.logId,
						error: result.error,
					});
				}
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

function matchesFlowTrigger(
	flowRow: typeof flow.$inferSelect,
	messageText: string,
): boolean {
	switch (flowRow.triggerType) {
		case "any_message":
			return true;

		case "keyword": {
			const config = flowRow.triggerConfig as { keyword?: string } | null;
			const keyword = config?.keyword;
			if (!keyword) return false;
			return matchesKeywordTrigger(messageText, keyword);
		}

		default:
			return false;
	}
}

function normalizeNumber(value: string) {
	return value.replace(/[^\d]/g, "");
}
