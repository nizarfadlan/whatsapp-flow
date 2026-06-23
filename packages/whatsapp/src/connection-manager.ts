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
} from "baileys";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { clearDbAuthState, useDbAuthState } from "./auth-state";
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
	return jid.split("@")[0]?.split(":")[0] ?? jid;
}

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export class ConnectionManager extends EventEmitter {
	private connections = new Map<string, DeviceConnection>();
	private connectPromises = new Map<string, Promise<DeviceConnection>>();
	private intentionalDisconnects = new Set<string>();
	private reconnectAttempts = new Map<string, number>();
	private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

		const pending = this.connectPromises.get(deviceId);
		if (pending) return pending;

		this.clearReconnectTimer(deviceId);
		this.intentionalDisconnects.delete(deviceId);

		const promise = this.createConnection(deviceId).finally(() => {
			this.connectPromises.delete(deviceId);
		});
		this.connectPromises.set(deviceId, promise);
		return promise;
	}

	private async createConnection(deviceId: string) {
		await this.updateDeviceStatus(deviceId, "connecting");

		const { state, saveCreds } = await useDbAuthState(deviceId);
		const { version } = await fetchLatestBaileysVersion();
		const socket = makeWASocket({
			...DEFAULT_CONNECTION_CONFIG,
			auth: state,
			version,
			markOnlineOnConnect: true,
			// Let Baileys provide initial chats/contacts/groups so the app can build
			// contact/group pickers and conversation history. Persistence is handled
			// by server-side event listeners.
			shouldSyncHistoryMessage: () => true,
			getMessage: async () => undefined,
			cachedGroupMetadata: async () => undefined,
		});

		const connection: DeviceConnection = {
			socket,
			qrCode: null,
			status: "connecting",
		};

		this.connections.set(deviceId, connection);
		socket.ev.on("creds.update", () => {
			void saveCreds().then(() => {
				if (socket.authState.creds.registered) {
					const phoneNumber = socket.user?.id
						? normalizeContactNumber(socket.user.id)
						: undefined;
					void this.updateDeviceStatus(deviceId, "connected", phoneNumber);
				}
			});
		});
		socket.ev.on("connection.update", (update) => {
			void this.handleConnectionUpdate(deviceId, update);
		});
		socket.ev.on("messages.upsert", (upsert) => {
			void this.handleMessagesUpsert(deviceId, upsert);
		});
		socket.ev.on("contacts.upsert", (contacts) => {
			this.handleContactsUpsert(deviceId, contacts);
		});
		socket.ev.on("contacts.update", (contacts) => {
			this.handleContactsUpsert(deviceId, contacts);
		});
		socket.ev.on("groups.upsert", (groups) => {
			this.handleGroupsUpsert(deviceId, groups);
		});
		socket.ev.on("groups.update", (groups) => {
			this.handleGroupsUpsert(deviceId, groups);
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
		this.clearReconnectTimer(deviceId);
		this.reconnectAttempts.delete(deviceId);
		const connection = this.connections.get(deviceId);
		if (connection) {
			await connection.socket.end(undefined);
			this.connections.delete(deviceId);
		}

		await this.updateDeviceStatus(deviceId, "disconnected");
	}

	async logout(deviceId: string) {
		this.intentionalDisconnects.add(deviceId);
		this.clearReconnectTimer(deviceId);
		this.reconnectAttempts.delete(deviceId);
		const connection = this.connections.get(deviceId);
		if (connection) {
			await connection.socket.logout();
			this.connections.delete(deviceId);
		}

		await this.resetDeviceAuth(deviceId);
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
			this.reconnectAttempts.delete(deviceId);
			this.clearReconnectTimer(deviceId);
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
			if (loggedOut) {
				await this.resetDeviceAuth(deviceId);
			} else {
				await this.updateDeviceStatus(deviceId, "disconnected");
			}

			if (!loggedOut && !intentional) {
				this.scheduleReconnect(deviceId);
			} else {
				this.reconnectAttempts.delete(deviceId);
				this.clearReconnectTimer(deviceId);
			}
		}
	}

	private scheduleReconnect(deviceId: string) {
		if (this.reconnectTimers.has(deviceId)) return;

		const attempt = (this.reconnectAttempts.get(deviceId) ?? 0) + 1;
		this.reconnectAttempts.set(deviceId, attempt);

		const delay = Math.min(
			INITIAL_RECONNECT_DELAY_MS * 2 ** (attempt - 1),
			MAX_RECONNECT_DELAY_MS,
		);
		const timer = setTimeout(() => {
			this.reconnectTimers.delete(deviceId);
			void this.connect(deviceId).catch(() => {
				this.scheduleReconnect(deviceId);
			});
		}, delay);

		this.reconnectTimers.set(deviceId, timer);
	}

	private clearReconnectTimer(deviceId: string) {
		const timer = this.reconnectTimers.get(deviceId);
		if (!timer) return;

		clearTimeout(timer);
		this.reconnectTimers.delete(deviceId);
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

			const contactJid = message.key.remoteJid;
			const contactNumber = normalizeContactNumber(contactJid);
			this.emit("device:message", {
				deviceId,
				contact: {
					jid: contactJid,
					number: contactNumber,
					name: message.pushName ?? undefined,
				},
				message: {
					text: extractMessageText(message),
					type: extractMessageType(message),
					raw: message,
					messageKey: message.key,
				},
			});
		}
	}

	private handleContactsUpsert(
		deviceId: string,
		contacts: {
			id?: string;
			name?: string;
			notify?: string;
			verifiedName?: string;
		}[],
	) {
		const mapped = contacts
			.map((item) => {
				const jid = item.id;
				if (!jid || jid.endsWith("@g.us")) return null;
				return {
					jid,
					phoneNumber: normalizeContactNumber(jid),
					name: item.name ?? item.verifiedName ?? item.notify,
					pushName: item.notify,
					isWaContact: true,
					raw: item,
				};
			})
			.filter((item): item is NonNullable<typeof item> => item != null);
		if (mapped.length > 0) {
			this.emit("device:contacts", { deviceId, contacts: mapped });
		}
	}

	private handleGroupsUpsert(
		deviceId: string,
		groups: {
			id?: string;
			subject?: string;
			desc?: string;
			owner?: string;
			participants?: unknown[];
		}[],
	) {
		const mapped = groups
			.map((item) => {
				const jid = item.id;
				if (!jid?.endsWith("@g.us")) return null;
				return {
					jid,
					subject: item.subject ?? jid,
					description: item.desc,
					ownerJid: item.owner,
					participantCount: item.participants?.length ?? 0,
					isMember: true,
					raw: item,
				};
			})
			.filter((item): item is NonNullable<typeof item> => item != null);
		if (mapped.length > 0) {
			this.emit("device:groups", { deviceId, groups: mapped });
		}
	}

	private async resetDeviceAuth(deviceId: string) {
		await clearDbAuthState(deviceId);
		await db
			.update(device)
			.set({
				phoneNumber: null,
				status: "disconnected",
				updatedAt: new Date(),
			})
			.where(eq(device.id, deviceId));

		this.emit("device:status", { deviceId, status: "disconnected" });
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
