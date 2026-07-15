import { db } from "@whatsapp-flow/db";
import { device } from "@whatsapp-flow/db/schema/device";
import { eq } from "drizzle-orm";
import { baileysMessageStore } from "./baileys-message-store";
import { connectionManager } from "./connection-manager";
import type { OutgoingMessage } from "./message-sender";
import { sendWhatsAppMessage } from "./message-sender";
import { sendMetaDeviceMessage } from "./providers/meta/transport";
import type { SendResult } from "./providers/types";

export async function sendDeviceMessage(
	deviceId: string,
	to: string,
	message: OutgoingMessage,
): Promise<SendResult> {
	const [deviceRow] = await db
		.select({ provider: device.provider, status: device.status })
		.from(device)
		.where(eq(device.id, deviceId))
		.limit(1);

	if (!deviceRow) {
		throw new Error("Device not found");
	}

	if (deviceRow.provider === "meta_cloud") {
		if (deviceRow.status !== "connected") {
			throw new Error("Device is not connected");
		}
		return sendMetaDeviceMessage(deviceId, to, message);
	}

	const connection = connectionManager.getConnection(deviceId);
	if (!connection?.socket) {
		throw new Error("Device is not connected");
	}
	const result = await sendWhatsAppMessage(connection.socket, to, message);
	let originalMessageStored: boolean | undefined;
	if (result) {
		try {
			await baileysMessageStore.store(deviceId, result);
			originalMessageStored = Boolean(result.message);
		} catch (error) {
			originalMessageStored = false;
			console.error("Failed to persist sent Baileys message content", {
				deviceId,
				messageId: result.key.id,
				error,
			});
		}
	}
	return {
		provider: "baileys",
		messageId: result?.key?.id ?? undefined,
		...(message.type === "poll"
			? {
					deliveryMode: "native_poll" as const,
					messageKey: result?.key,
					originalMessageStored: originalMessageStored === true,
				}
			: {}),
		raw: result,
	};
}
