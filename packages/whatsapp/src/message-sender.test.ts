import { describe, expect, mock, test } from "bun:test";
import { sendWhatsAppMessage } from "./message-sender";

describe("poll sends", () => {
	test("uses only the documented Baileys poll payload", async () => {
		const sendMessage = mock(() => Promise.resolve({ key: { id: "poll-1" } }));
		await sendWhatsAppMessage(
			{ sendMessage } as never,
			"15551234567@s.whatsapp.net",
			{
				type: "poll",
				name: "Choose one",
				values: ["Sales", "Support"],
				selectableCount: 1,
				fallbackText: "Choose one\n1. Sales\n2. Support",
			},
		);
		expect(sendMessage).toHaveBeenCalledWith("15551234567@s.whatsapp.net", {
			poll: {
				name: "Choose one",
				values: ["Sales", "Support"],
				selectableCount: 1,
			},
		});
	});
});
