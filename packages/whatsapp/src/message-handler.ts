import type { ConnectionManagerEvents } from "./types";

export type IncomingMessage = ConnectionManagerEvents["device:message"];

export function matchesKeywordTrigger(
	messageText: string | undefined,
	keyword: string,
) {
	if (!messageText) {
		return false;
	}

	return messageText.trim().toLowerCase() === keyword.trim().toLowerCase();
}
