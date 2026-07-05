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

export interface ConnectionManagerEvents {
	"device:status": {
		deviceId: string;
		status: DeviceStatus;
		phoneNumber?: string;
	};
	"device:qr": { deviceId: string; qr: string };
	"device:message": {
		deviceId: string;
		provider?: WhatsAppProvider;
		contact: {
			jid: string;
			number?: string;
			lid?: string;
			name?: string;
			providerContactId?: string;
		};
		message: {
			text?: string;
			type: string;
			raw: unknown;
			messageKey?: import("baileys").WAMessageKey;
			providerMessageId?: string;
		};
	};
	"device:contacts": {
		deviceId: string;
		contacts: {
			jid: string;
			phoneNumber?: string;
			lid?: string;
			name?: string;
			pushName?: string;
			isWaContact?: boolean;
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
		contactNumber: string;
		status: "waiting" | "running" | "completed" | "expired" | "failed";
	};
	"flow:execution-event": {
		id: string;
		executionLogId: string;
		flowId: string;
		deviceId: string;
		sessionId: string | null;
		contactNumber: string;
		type: string;
		nodeId: string | null;
		message: string | null;
		payload: Record<string, unknown>;
		createdAt: string;
	};
}
