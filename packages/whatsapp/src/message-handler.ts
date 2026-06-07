export type IncomingMessage = {
	deviceId: string;
	contact: { jid: string; number: string; name?: string };
	message: { text?: string; type: string; raw: unknown };
};

export function matchesKeywordTrigger(
	messageText: string | undefined,
	keyword: string,
) {
	if (!messageText) {
		return false;
	}

	return messageText.trim().toLowerCase() === keyword.trim().toLowerCase();
}
