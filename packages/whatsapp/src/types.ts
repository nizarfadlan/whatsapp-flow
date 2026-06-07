import type { WASocket } from "@whiskeysockets/baileys";

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
		contact: { number: string; name?: string };
		message: { text?: string; type: string; raw: unknown };
	};
}
