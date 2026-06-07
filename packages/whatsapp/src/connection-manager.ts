import { EventEmitter } from "node:events";
import { db } from "@whatsapp-flow/db";
import { device } from "@whatsapp-flow/db/schema/device";
import {
	type BaileysEventMap,
	DEFAULT_CONNECTION_CONFIG,
	DisconnectReason,
	fetchLatestBaileysVersion,
	makeWASocket,
	type WAMessage,
} from "@whiskeysockets/baileys";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { useDbAuthState } from "./auth-state";
import type {
	ConnectionManagerEvents,
	DeviceConnection,
	DeviceStatus,
} from "./types";

function extractMessageText(message: WAMessage) {
	const content = message.message;
	return (
		content?.conversation ??
		content?.extendedTextMessage?.text ??
		content?.imageMessage?.caption ??
		content?.videoMessage?.caption ??
		content?.buttonsResponseMessage?.selectedDisplayText ??
		content?.listResponseMessage?.title ??
		undefined
	);
}

function extractMessageType(message: WAMessage) {
	const content = message.message;
	return Object.keys(content ?? {})[0] ?? "unknown";
}

function normalizeContactNumber(jid: string) {
	return jid.split("@")[0] ?? jid;
}

export class ConnectionManager extends EventEmitter {
	private connections = new Map<string, DeviceConnection>();
	private intentionalDisconnects = new Set<string>();

	on<T extends keyof ConnectionManagerEvents>(
		eventName: T,
		listener: (event: ConnectionManagerEvents[T]) => void,
	): this {
		return super.on(eventName, listener);
	}

	emit<T extends keyof ConnectionManagerEvents>(
		eventName: T,
		event: ConnectionManagerEvents[T],
	): boolean {
		return super.emit(eventName, event);
	}

	getConnection(deviceId: string) {
		return this.connections.get(deviceId);
	}

	getQrCode(deviceId: string) {
		return this.connections.get(deviceId)?.qrCode ?? null;
	}

	async connect(deviceId: string) {
		const existing = this.connections.get(deviceId);
		if (existing?.status === "connected" || existing?.status === "connecting") {
			return existing;
		}

		await this.updateDeviceStatus(deviceId, "connecting");

		const { state, saveCreds } = await useDbAuthState(deviceId);
		const { version } = await fetchLatestBaileysVersion();
		const socket = makeWASocket({
			...DEFAULT_CONNECTION_CONFIG,
			auth: state,
			version,
			markOnlineOnConnect: true,
			shouldSyncHistoryMessage: () => false,
			getMessage: async () => undefined,
			cachedGroupMetadata: async () => undefined,
		});

		const connection: DeviceConnection = {
			socket,
			qrCode: null,
			status: "connecting",
		};

		this.connections.set(deviceId, connection);
		socket.ev.on("creds.update", saveCreds);
		socket.ev.on("connection.update", (update) => {
			void this.handleConnectionUpdate(deviceId, update);
		});
		socket.ev.on("messages.upsert", (upsert) => {
			void this.handleMessagesUpsert(deviceId, upsert);
		});

		return connection;
	}

	async requestPairingCode(deviceId: string, phoneNumber: string) {
		const connection = await this.connect(deviceId);
		const normalized = phoneNumber.replace(/[^\d]/g, "");
		if (!normalized) {
			throw new Error("Phone number is required");
		}

		if (connection.socket.authState.creds.registered) {
			throw new Error("Device is already registered");
		}

		return connection.socket.requestPairingCode(normalized);
	}

	async disconnect(deviceId: string) {
		this.intentionalDisconnects.add(deviceId);
		const connection = this.connections.get(deviceId);
		if (connection) {
			await connection.socket.end(undefined);
			this.connections.delete(deviceId);
		}

		await this.updateDeviceStatus(deviceId, "disconnected");
	}

	async logout(deviceId: string) {
		this.intentionalDisconnects.add(deviceId);
		const connection = this.connections.get(deviceId);
		if (connection) {
			await connection.socket.logout();
			this.connections.delete(deviceId);
		}

		await db
			.update(device)
			.set({
				phoneNumber: null,
				sessionData: null,
				status: "disconnected",
				updatedAt: new Date(),
			})
			.where(eq(device.id, deviceId));

		this.emit("device:status", { deviceId, status: "disconnected" });
	}

	private async handleConnectionUpdate(
		deviceId: string,
		update: BaileysEventMap["connection.update"],
	) {
		const connection = this.connections.get(deviceId);
		if (!connection) {
			return;
		}

		if (update.qr) {
			const qr = await QRCode.toDataURL(update.qr);
			connection.qrCode = qr;
			this.emit("device:qr", { deviceId, qr });
		}

		if (update.connection === "open") {
			const phoneNumber = connection.socket.user?.id
				? normalizeContactNumber(connection.socket.user.id)
				: undefined;

			await this.updateDeviceStatus(deviceId, "connected", phoneNumber);
			connection.qrCode = null;
			return;
		}

		if (update.connection === "connecting") {
			await this.updateDeviceStatus(deviceId, "connecting");
			return;
		}

		if (update.connection === "close") {
			const lastError = update.lastDisconnect?.error as
				| { output?: { statusCode?: number } }
				| undefined;
			const statusCode = lastError?.output?.statusCode;
			const loggedOut = statusCode === DisconnectReason.loggedOut;
			const intentional = this.intentionalDisconnects.delete(deviceId);

			this.connections.delete(deviceId);
			await this.updateDeviceStatus(deviceId, "disconnected");

			if (!loggedOut && !intentional) {
				void this.connect(deviceId);
			}
		}
	}

	private async handleMessagesUpsert(
		deviceId: string,
		upsert: BaileysEventMap["messages.upsert"],
	) {
		if (upsert.type !== "notify") {
			return;
		}

		for (const message of upsert.messages) {
			if (message.key.fromMe || !message.key.remoteJid) {
				continue;
			}

			const contactNumber = normalizeContactNumber(message.key.remoteJid);
			this.emit("device:message", {
				deviceId,
				contact: {
					number: contactNumber,
					name: message.pushName ?? undefined,
				},
				message: {
					text: extractMessageText(message),
					type: extractMessageType(message),
					raw: message,
				},
			});
		}
	}

	private async updateDeviceStatus(
		deviceId: string,
		status: DeviceStatus,
		phoneNumber?: string,
	) {
		const values: Partial<typeof device.$inferInsert> = {
			status,
			updatedAt: new Date(),
		};

		if (phoneNumber) {
			values.phoneNumber = phoneNumber;
		}

		await db.update(device).set(values).where(eq(device.id, deviceId));
		const connection = this.connections.get(deviceId);
		if (connection) {
			connection.status = status;
		}

		this.emit("device:status", { deviceId, status, phoneNumber });
	}
}

export const connectionManager = new ConnectionManager();
