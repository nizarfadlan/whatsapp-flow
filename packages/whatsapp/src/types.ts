import type { WASocket } from "baileys";

export type DeviceStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	| "banned";

export interface DeviceConnection {
	socket: WASocket;
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
		contact: { jid: string; number?: string; lid?: string; name?: string };
		message: {
			text?: string;
			type: string;
			raw: unknown;
			messageKey?: import("baileys").WAMessageKey;
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
}
