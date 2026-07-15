import { describe, expect, test } from "bun:test";
import type { WAMessage } from "baileys";
import { normalizeBaileysMessage } from "./message-content";

function withContent(message: WAMessage["message"]) {
	return normalizeBaileysMessage({ message });
}

describe("normalizeBaileysMessage", () => {
	test("unwraps each known message wrapper", () => {
		const wrappers: WAMessage["message"][] = [
			{ ephemeralMessage: { message: { conversation: "ephemeral" } } },
			{ viewOnceMessage: { message: { conversation: "view once" } } },
			{ viewOnceMessageV2: { message: { conversation: "view once v2" } } },
			{
				viewOnceMessageV2Extension: {
					message: { conversation: "view once v2 extension" },
				},
			},
			{
				documentWithCaptionMessage: {
					message: { conversation: "document with caption" },
				},
			},
			{ editedMessage: { message: { conversation: "edited" } } },
		];

		expect(wrappers.map(withContent)).toEqual([
			{ text: "ephemeral", type: "conversation", reply: undefined },
			{ text: "view once", type: "conversation", reply: undefined },
			{ text: "view once v2", type: "conversation", reply: undefined },
			{
				text: "view once v2 extension",
				type: "conversation",
				reply: undefined,
			},
			{
				text: "document with caption",
				type: "conversation",
				reply: undefined,
			},
			{ text: "edited", type: "conversation", reply: undefined },
		]);
	});

	test("extracts documented structured reply IDs and display text", () => {
		expect(
			withContent({
				buttonsResponseMessage: {
					selectedButtonId: "button-id",
					selectedDisplayText: "Choose me",
				},
			}),
		).toEqual({
			text: "Choose me",
			type: "buttonsResponseMessage",
			reply: {
				kind: "button",
				selectedId: "button-id",
				selectedText: "Choose me",
			},
		});

		expect(
			withContent({
				listResponseMessage: {
					singleSelectReply: { selectedRowId: "row-id" },
					title: "Selected row",
				},
			}),
		).toEqual({
			text: "Selected row",
			type: "listResponseMessage",
			reply: {
				kind: "list",
				selectedId: "row-id",
				selectedText: "Selected row",
			},
		});

		expect(
			withContent({
				templateButtonReplyMessage: {
					selectedId: "template-id",
					selectedDisplayText: "Template choice",
				},
			}),
		).toEqual({
			text: "Template choice",
			type: "templateButtonReplyMessage",
			reply: {
				kind: "template",
				selectedId: "template-id",
				selectedText: "Template choice",
			},
		});
	});

	test("uses interactive body text while extracting the reply ID from params JSON", () => {
		expect(
			withContent({
				interactiveResponseMessage: {
					body: { text: "Continue" },
					nativeFlowResponseMessage: {
						paramsJson: '{"id":"interactive-id"}',
					},
				},
			}),
		).toEqual({
			text: "Continue",
			type: "interactiveResponseMessage",
			reply: {
				kind: "interactive",
				selectedId: "interactive-id",
				selectedText: "Continue",
			},
		});
	});

	test("keeps text when interactive response JSON is malformed", () => {
		expect(
			withContent({
				interactiveResponseMessage: {
					body: { text: "Continue" },
					nativeFlowResponseMessage: { paramsJson: "not json" },
				},
			}),
		).toEqual({
			text: "Continue",
			type: "interactiveResponseMessage",
			reply: {
				kind: "interactive",
				selectedId: undefined,
				selectedText: "Continue",
			},
		});
	});

	test("does not use replies nested in quoted message context", () => {
		expect(
			withContent({
				extendedTextMessage: {
					text: "My current message",
					contextInfo: {
						quotedMessage: {
							buttonsResponseMessage: {
								selectedButtonId: "quoted-id",
								selectedDisplayText: "Quoted choice",
							},
						},
					},
				},
			}),
		).toEqual({
			text: "My current message",
			type: "extendedTextMessage",
			reply: undefined,
		});
	});
});
