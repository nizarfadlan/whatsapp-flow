import type { WAMessageKey } from "baileys";

export type WhatsAppProvider = "baileys" | "meta_cloud";

export type ChatType = "private" | "group" | "channel" | "broadcast";

export type DeviceCapabilities = {
	inboundMessages: boolean;
	outboundText: boolean;
	outboundMediaByUrl: boolean;
	outboundLocation: boolean;
	outboundReaction: boolean;
	groups: boolean;
	channels: boolean;
	contactsSync: boolean;
	qrPairing: boolean;
	pairingCode: boolean;
	requiresWebhook: boolean;
	deliveryReceipts: boolean;
	interactiveMessages: "native" | "text_fallback" | "unsupported";
};

export type ProviderMessageRef = {
	providerMessageId?: string;
	messageKey?: WAMessageKey;
};

export type SendResult = {
	provider: WhatsAppProvider;
	messageId?: string;
	raw?: unknown;
};

export const baileysCapabilities: DeviceCapabilities = {
	inboundMessages: true,
	outboundText: true,
	outboundMediaByUrl: true,
	outboundLocation: true,
	outboundReaction: true,
	groups: true,
	channels: true,
	contactsSync: true,
	qrPairing: true,
	pairingCode: true,
	requiresWebhook: false,
	deliveryReceipts: false,
	interactiveMessages: "text_fallback",
};

export const metaCloudCapabilities: DeviceCapabilities = {
	inboundMessages: true,
	outboundText: true,
	outboundMediaByUrl: true,
	outboundLocation: true,
	outboundReaction: true,
	groups: false,
	channels: false,
	contactsSync: false,
	qrPairing: false,
	pairingCode: false,
	requiresWebhook: true,
	deliveryReceipts: true,
	interactiveMessages: "text_fallback",
};
