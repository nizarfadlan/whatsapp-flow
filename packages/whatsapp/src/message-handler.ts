import type { ConnectionManagerEvents } from "./types";

export type IncomingMessage = ConnectionManagerEvents["device:message"];

export function matchesKeywordTrigger(
	messageText: string | undefined,
	keywords: string | string[],
) {
	if (!messageText) {
		return false;
	}

	const normalizedMessage = messageText.trim().toLowerCase();
	const normalizedKeywords = (Array.isArray(keywords) ? keywords : [keywords])
		.map((keyword) => keyword.trim().toLowerCase())
		.filter(Boolean);

	return normalizedKeywords.some((keyword) =>
		normalizedMessage.includes(keyword),
	);
}
