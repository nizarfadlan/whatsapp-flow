export type IncomingMessage = {
	deviceId: string;
	contact: { jid: string; number?: string; lid?: string; name?: string };
	message: {
		text?: string;
		type: string;
		raw: unknown;
		messageKey?: import("baileys").WAMessageKey;
	};
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
