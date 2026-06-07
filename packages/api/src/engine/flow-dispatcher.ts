import { db } from "@whatsapp-flow/db";
import { flow } from "@whatsapp-flow/db/schema/device";
import type { IncomingMessage } from "@whatsapp-flow/whatsapp";
import {
	connectionManager,
	matchesKeywordTrigger,
} from "@whatsapp-flow/whatsapp";
import { and, eq } from "drizzle-orm";
import { executeFlow } from "./flow-executor";

export function startFlowDispatcher(): void {
	connectionManager.on("device:message", async (event: IncomingMessage) => {
		const { deviceId, message, contact } = event;

		try {
			const flows = await db
				.select()
				.from(flow)
				.where(and(eq(flow.deviceId, deviceId), eq(flow.status, "active")));

			for (const flowRow of flows) {
				if (matchesFlowTrigger(flowRow, message.text ?? "")) {
					void executeFlow(flowRow, contact.number, message.text ?? "");
				}
			}
		} catch {
			// Don't crash the connection on dispatch errors
		}
	});
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
