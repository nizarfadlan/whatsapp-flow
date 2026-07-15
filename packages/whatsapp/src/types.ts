import type { WASocket } from "baileys";
import type { WhatsAppProvider } from "./providers/types";

export type DeviceStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	| "banned";

export interface DeviceConnection {
	socket?: WASocket;
	provider: WhatsAppProvider;
	qrCode: string | null;
	status: DeviceStatus;
}

export type IncomingReplyDescriptor = {
	kind: "button" | "list" | "template" | "interactive";
	selectedId?: string;
	selectedText?: string;
};

export type DeviceMessagePayload = {
	text?: string;
	type: string;
	reply?: IncomingReplyDescriptor;
	raw: unknown;
	messageKey?: import("baileys").WAMessageKey;
	providerMessageId?: string;
	inboxReservation?: {
		messageId: string;
		threadId: string;
	};
};

export type DeviceMessageEvent = {
	deviceId: string;
	provider?: WhatsAppProvider;
	contact: {
		jid: string;
		number?: string;
		lid?: string;
		username?: string;
		identityKey?: string;
		name?: string;
		providerContactId?: string;
	};
	chat?: {
		jid: string;
		type: "private" | "group" | "channel" | "broadcast";
		isGroup: boolean;
	};
	sender?: {
		jid?: string;
		number?: string;
		lid?: string;
		username?: string;
		identityKey?: string;
		name?: string;
		providerContactId?: string;
	};
	group?: {
		jid: string;
		name?: string;
		participantCount?: number;
	};
	message: DeviceMessagePayload;
};

export interface ConnectionManagerEvents {
	"device:status": {
		deviceId: string;
		status: DeviceStatus;
		phoneNumber?: string;
		statusReason?: string;
		lastError?: string;
	};
	"device:history-sync-status": {
		deviceId: string;
		syncType: import("baileys").proto.HistorySync.HistorySyncType;
		status: "complete" | "paused";
		explicit: boolean;
	};
	"device:qr": { deviceId: string; qr: string };
	"device:message": DeviceMessageEvent;
	"device:message-persisted": DeviceMessageEvent & {
		inboxMessageId: string;
		threadId: string;
	};
	"device:poll-vote": {
		deviceId: string;
		pollCreationKey: import("baileys").WAMessageKey;
		pollCreationMessageId: string;
		voter: { jid: string; number?: string; lid?: string; identityKey: string };
		selectedOptionText: string;
		updateIdentity: string;
	};
	"device:contacts": {
		deviceId: string;
		contacts: {
			jid: string;
			phoneNumber?: string;
			lid?: string;
			identityKey?: string;
			name?: string;
			pushName?: string;
			isWaContact?: boolean;
			avatarUrl?: string;
			raw?: unknown;
		}[];
	};
	"device:channels": {
		deviceId: string;
		channels: {
			jid: string;
			name: string;
			description?: string;
			ownerJid?: string;
			subscribersCount?: number;
			isSubscribed?: boolean;
			verificationStatus?: string;
			raw?: unknown;
		}[];
	};
	"device:groups": {
		deviceId: string;
		reconcileParticipants?: boolean;
		groups: {
			jid: string;
			subject: string;
			description?: string;
			ownerJid?: string;
			participantCount?: number;
			isMember?: boolean;
			raw?: unknown;
		}[];
	};
	"inbox:updated": {
		deviceId: string;
		threadId?: string;
	};
	"flow:log:updated": {
		logId: string;
		flowId: string;
		deviceId: string;
	};
	"flow:session:updated": {
		sessionId: string;
		flowId: string;
		deviceId: string;
		executionLogId: string;
		contactNumber: string | null;
		contactKey: string;
		status: "waiting" | "running" | "completed" | "expired" | "failed";
	};
	"flow:execution-event": {
		id: string;
		executionLogId: string;
		flowId: string;
		deviceId: string;
		sessionId: string | null;
		contactNumber: string | null;
		contactKey: string;
		type: string;
		nodeId: string | null;
		message: string | null;
		payload: Record<string, unknown>;
		createdAt: string;
	};
}

export type SyncedContact =
	ConnectionManagerEvents["device:contacts"]["contacts"][number];
export type SyncedGroup =
	ConnectionManagerEvents["device:groups"]["groups"][number];
export type SyncedNewsletter =
	ConnectionManagerEvents["device:channels"]["channels"][number];
