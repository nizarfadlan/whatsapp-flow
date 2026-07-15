import { normalizeMessageContent, type WAMessage } from "baileys";
import type { IncomingReplyDescriptor } from "./types";

type MessageContent = NonNullable<WAMessage["message"]>;

export type NormalizedBaileysMessage = {
	text?: string;
	type: string;
	reply?: IncomingReplyDescriptor;
};

export function normalizeBaileysMessage(
	message: Pick<WAMessage, "message">,
): NormalizedBaileysMessage {
	const content = normalizeMessageContent(message.message);
	if (!content) return { type: "unknown" };

	const reply = extractReply(content);
	return {
		text: extractText(content),
		type: Object.keys(content)[0] ?? "unknown",
		reply,
	};
}

function extractText(content: MessageContent) {
	return (
		content.conversation ??
		content.extendedTextMessage?.text ??
		content.imageMessage?.caption ??
		content.videoMessage?.caption ??
		content.buttonsResponseMessage?.selectedDisplayText ??
		content.listResponseMessage?.title ??
		content.templateButtonReplyMessage?.selectedDisplayText ??
		content.interactiveResponseMessage?.body?.text ??
		undefined
	);
}

function extractReply(
	content: MessageContent,
): IncomingReplyDescriptor | undefined {
	const buttonsResponse = content.buttonsResponseMessage;
	if (buttonsResponse) {
		return {
			kind: "button",
			selectedId: buttonsResponse.selectedButtonId ?? undefined,
			selectedText: buttonsResponse.selectedDisplayText ?? undefined,
		};
	}

	const listResponse = content.listResponseMessage;
	if (listResponse) {
		return {
			kind: "list",
			selectedId: listResponse.singleSelectReply?.selectedRowId ?? undefined,
			selectedText: listResponse.title ?? undefined,
		};
	}

	const templateResponse = content.templateButtonReplyMessage;
	if (templateResponse) {
		return {
			kind: "template",
			selectedId: templateResponse.selectedId ?? undefined,
			selectedText: templateResponse.selectedDisplayText ?? undefined,
		};
	}

	const interactiveResponse = content.interactiveResponseMessage;
	if (interactiveResponse) {
		return {
			kind: "interactive",
			selectedId: extractInteractiveReplyId(
				interactiveResponse.nativeFlowResponseMessage?.paramsJson,
			),
			selectedText: interactiveResponse.body?.text ?? undefined,
		};
	}

	return undefined;
}

function extractInteractiveReplyId(paramsJson: string | null | undefined) {
	if (!paramsJson) return undefined;

	try {
		const params = JSON.parse(paramsJson);
		if (!params || typeof params !== "object" || Array.isArray(params)) {
			return undefined;
		}
		const { id, selectedId, selectedRowId } = params as Record<string, unknown>;
		return getString(id) ?? getString(selectedId) ?? getString(selectedRowId);
	} catch {
		return undefined;
	}
}

function getString(value: unknown) {
	return typeof value === "string" ? value : undefined;
}
