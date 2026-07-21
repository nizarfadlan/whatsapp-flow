import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { db } from "@whatsapp-flow/db";
import { device } from "@whatsapp-flow/db/schema/device";
import {
	type BaileysEventMap,
	type Contact,
	DEFAULT_CONNECTION_CONFIG,
	downloadMediaMessage,
	fetchLatestBaileysVersion,
	getAggregateVotesInPollMessage,
	makeWASocket,
	type WAMessage,
} from "baileys";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import {
	clearDbAuthState,
	type DbAuthState,
	useDbAuthState,
} from "./auth-state";
import {
	BoundedDeviceCache,
	baileysMessageStore,
} from "./baileys-message-store";
import {
	classifyDisconnectReason,
	describeDisconnectOperation,
} from "./disconnect-classification";
import { groupMetadataStore } from "./group-metadata-store";
import {
	derivePrivateIdentityKey,
	isLidJid,
	isPhoneJid,
	normalizeContactNumber,
	resolvePollUpdateVoter,
	toPhoneJid,
} from "./identity";
import { normalizeBaileysMessage } from "./message-content";
import {
	connectMetaDevice,
	disconnectMetaDevice,
	logoutMetaDevice,
} from "./providers/meta/transport";
import type {
	ConnectionManagerEvents,
	DeviceConnection,
	DeviceStatus,
	SyncedContact,
	SyncedGroup,
	SyncedNewsletter,
} from "./types";

function toNewsletterJid(id: string) {
	return id.endsWith("@newsletter") ? id : `${id}@newsletter`;
}

function getChatType(jid: string) {
	if (jid.endsWith("@g.us")) return "group" as const;
	if (jid.endsWith("@newsletter")) return "channel" as const;
	if (jid.endsWith("@broadcast")) return "broadcast" as const;
	return "private" as const;
}

function getStringValue(value: unknown) {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function getTextValue(value: unknown) {
	if (typeof value === "string" && value.trim()) return value;
	if (value && typeof value === "object") {
		return getStringValue((value as Record<string, unknown>).text);
	}
	return undefined;
}

function getNumberValue(value: unknown) {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_JITTER_RATIO = 0.2;
const MAX_MESSAGE_RETRY_COUNT = 3;
const MESSAGE_RETRY_REQUEST_DELAY_MS = 1_000;
const MESSAGE_RETRY_CACHE_TTL_MS = 60 * 60 * 1_000;
const MAX_MESSAGE_RETRY_CACHE_ENTRIES = 500;

export class ConnectionManager extends EventEmitter {
	private connections = new Map<string, DeviceConnection>();
	private authStates = new Map<string, DbAuthState>();
	private connectPromises = new Map<string, Promise<DeviceConnection>>();
	private intentionalDisconnects = new Set<string>();
	private reconnectAttempts = new Map<string, number>();
	private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private connectionGenerations = new Map<string, number>();

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

	async fetchGroups(deviceId: string, jid?: string): Promise<SyncedGroup[]> {
		const socket = this.requireConnectedBaileysSocket(deviceId);
		const groups = jid
			? [await socket.groupMetadata(jid)]
			: Object.values(await socket.groupFetchAllParticipating());
		this.updateGroupMetadataCache(deviceId, groups);
		return this.mapGroups(groups);
	}

	async fetchNewsletter(
		deviceId: string,
		jid: string,
	): Promise<SyncedNewsletter | null> {
		const socket = this.requireConnectedBaileysSocket(deviceId);
		const [metadata, subscribers] = await Promise.all([
			socket.newsletterMetadata("jid", jid),
			socket.newsletterSubscribers(jid).catch(() => null),
		]);
		return (
			this.mapChannels([
				{
					...(metadata ?? {}),
					id: jid,
					subscribers: subscribers?.subscribers,
				},
			])[0] ?? null
		);
	}

	async refreshContact(
		deviceId: string,
		contact: SyncedContact,
	): Promise<SyncedContact> {
		const socket = this.requireConnectedBaileysSocket(deviceId);
		const [availabilityResult, avatarUrl] = await Promise.all([
			socket.onWhatsApp(contact.jid).catch(() => []),
			socket.profilePictureUrl(contact.jid, "image").catch(() => undefined),
		]);
		const availability = availabilityResult ?? [];
		const resolvedJid = availability[0]?.jid ?? contact.jid;
		return {
			...contact,
			jid: resolvedJid,
			isWaContact: availability[0]?.exists ?? contact.isWaContact ?? true,
			avatarUrl,
		};
	}

	async repairContactAppState(deviceId: string) {
		const socket = this.requireConnectedBaileysSocket(deviceId);
		await socket.resyncAppState(
			[
				"critical_block",
				"critical_unblock_low",
				"regular",
				"regular_high",
				"regular_low",
			],
			false,
		);
	}

	async connect(deviceId: string): Promise<DeviceConnection> {
		const provider = await this.getDeviceProvider(deviceId);
		if (provider === "meta_cloud") {
			const connection = await connectMetaDevice(deviceId);
			this.emit("device:status", {
				deviceId,
				status: connection.status,
			});
			return connection;
		}

		const existing = this.connections.get(deviceId);
		if (existing?.status === "connected" || existing?.status === "connecting") {
			return existing;
		}

		const pending = this.connectPromises.get(deviceId);
		if (pending) return pending;

		const generation = this.nextConnectionGeneration(deviceId);
		this.clearReconnectTimer(deviceId);
		this.intentionalDisconnects.delete(deviceId);

		return this.startConnection(deviceId, generation);
	}

	private startConnection(deviceId: string, generation: number) {
		const pending = this.connectPromises.get(deviceId);
		if (pending) return pending;

		const promise = this.createConnection(deviceId, generation).finally(() => {
			if (this.connectPromises.get(deviceId) === promise) {
				this.connectPromises.delete(deviceId);
			}
		});
		this.connectPromises.set(deviceId, promise);
		return promise;
	}

	private nextConnectionGeneration(deviceId: string) {
		const generation = (this.connectionGenerations.get(deviceId) ?? 0) + 1;
		this.connectionGenerations.set(deviceId, generation);
		return generation;
	}

	private isCurrentConnectionGeneration(deviceId: string, generation: number) {
		return this.connectionGenerations.get(deviceId) === generation;
	}

	private invalidateConnectionLifecycle(deviceId: string) {
		const generation = this.nextConnectionGeneration(deviceId);
		this.connectPromises.delete(deviceId);
		return generation;
	}

	private invalidateDeviceCaches(deviceId: string) {
		baileysMessageStore.invalidateDevice(deviceId);
		groupMetadataStore.invalidateDevice(deviceId);
	}

	private assertCurrentConnectionGeneration(
		deviceId: string,
		generation: number,
	) {
		if (!this.isCurrentConnectionGeneration(deviceId, generation)) {
			throw new Error("Connection lifecycle was invalidated");
		}
	}

	private async reconnect(deviceId: string, generation: number) {
		this.assertCurrentConnectionGeneration(deviceId, generation);
		if (this.intentionalDisconnects.has(deviceId)) return;
		const connection = await this.startConnection(deviceId, generation);
		this.assertCurrentConnectionGeneration(deviceId, generation);
		return connection;
	}

	private requireConnectedBaileysSocket(deviceId: string) {
		const connection = this.connections.get(deviceId);
		if (connection?.provider !== "baileys" || !connection.socket) {
			throw new Error("A connected Baileys device is required");
		}
		if (connection.status !== "connected") {
			throw new Error("Device is not connected");
		}
		return connection.socket;
	}

	private async createConnection(deviceId: string, generation: number) {
		this.assertCurrentConnectionGeneration(deviceId, generation);
		await this.updateDeviceStatus(deviceId, "connecting");

		const authState = await useDbAuthState(deviceId);
		if (!this.isCurrentConnectionGeneration(deviceId, generation)) {
			authState.dispose();
			throw new Error("Connection lifecycle was invalidated");
		}
		const { version } = await fetchLatestBaileysVersion();
		if (!this.isCurrentConnectionGeneration(deviceId, generation)) {
			authState.dispose();
			throw new Error("Connection lifecycle was invalidated");
		}
		const retryCounterCache = new BoundedDeviceCache<number>(
			MAX_MESSAGE_RETRY_CACHE_ENTRIES,
			MESSAGE_RETRY_CACHE_TTL_MS,
		);
		const socket = makeWASocket({
			...DEFAULT_CONNECTION_CONFIG,
			auth: authState.state,
			version,
			markOnlineOnConnect: true,
			// Let Baileys provide initial chats/contacts/groups so the app can build
			// contact/group pickers and conversation history. Persistence is handled
			// by server-side event listeners.
			shouldSyncHistoryMessage: () => true,
			enableRecentMessageCache: true,
			maxMsgRetryCount: MAX_MESSAGE_RETRY_COUNT,
			retryRequestDelayMs: MESSAGE_RETRY_REQUEST_DELAY_MS,
			msgRetryCounterCache: {
				get: <T>(key: string) =>
					retryCounterCache.get(deviceId, key) as T | undefined,
				set: <T>(key: string, value: T) =>
					retryCounterCache.set(deviceId, key, value as number),
				del: (key: string) => retryCounterCache.delete(deviceId, key),
				flushAll: () => retryCounterCache.clearDevice(deviceId),
			},
			getMessage: (key) => baileysMessageStore.get(deviceId, key),
			cachedGroupMetadata: (jid) => groupMetadataStore.get(deviceId, jid),
		});

		if (!this.isCurrentConnectionGeneration(deviceId, generation)) {
			authState.dispose();
			void socket.end(new Error("Connection lifecycle was invalidated"));
			throw new Error("Connection lifecycle was invalidated");
		}

		const connection: DeviceConnection = {
			socket,
			provider: "baileys",
			qrCode: null,
			status: "connecting",
		};

		this.connections.set(deviceId, connection);
		this.authStates.set(deviceId, authState);
		socket.ev.on("creds.update", () => {
			void authState
				.saveCreds()
				.then(() => {
					if (
						this.authStates.get(deviceId) === authState &&
						socket.authState.creds.registered
					) {
						const phoneNumber = socket.user?.id
							? (normalizeContactNumber(socket.user.id) ?? undefined)
							: undefined;
						void this.updateDeviceStatus(deviceId, "connected", phoneNumber);
					}
				})
				.catch(() => {
					console.error("Failed to persist Baileys credentials", {
						deviceId,
						operation: "saveCreds",
					});
				});
		});
		socket.ev.on("connection.update", (update) => {
			void this.handleConnectionUpdate(deviceId, socket, authState, update);
		});
		socket.ev.on("messages.upsert", (upsert) => {
			void this.handleMessagesUpsert(deviceId, socket, upsert);
		});
		socket.ev.on("messages.update", (updates) => {
			void this.handlePollUpdates(deviceId, socket, updates);
		});
		socket.ev.on("contacts.upsert", (contacts) => {
			void this.handleContactsUpsert(deviceId, socket, contacts);
		});
		socket.ev.on("contacts.update", (contacts) => {
			void this.handleContactsUpsert(deviceId, socket, contacts);
		});
		socket.ev.on("groups.upsert", (groups) => {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleGroupsUpsert(deviceId, groups);
		});
		socket.ev.on("groups.update", (groups) => {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleGroupsUpsert(deviceId, groups);
		});
		socket.ev.on("messaging-history.set", (history) => {
			void this.handleMessagingHistorySet(deviceId, socket, history);
		});
		socket.ev.on("messaging-history.status", (historyStatus) => {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleMessagingHistoryStatus(deviceId, historyStatus);
		});
		socket.ev.on("lid-mapping.update", (mapping) => {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleLidMappingUpdate(deviceId, mapping);
		});
		socket.ev.on("chats.upsert", (chats) => {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleChatsUpsert(deviceId, chats);
		});
		socket.ev.on("chats.update", (chats) => {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleChatsUpsert(deviceId, chats);
		});
		socket.ev.on("chats.delete", (jids) => {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleChatsDelete(deviceId, jids);
		});
		socket.ev.on("group-participants.update", (update) => {
			void this.handleGroupParticipantsUpdate(deviceId, socket, update);
		});
		socket.ev.on("newsletter.view", (view) => {
			void this.handleNewsletterView(deviceId, socket, view.id);
		});

		return connection;
	}

	async requestPairingCode(deviceId: string, phoneNumber: string) {
		const provider = await this.getDeviceProvider(deviceId);
		if (provider === "meta_cloud") {
			throw new Error("Meta Cloud API does not use pairing codes");
		}

		const connection = await this.connect(deviceId);
		if (!connection.socket) {
			throw new Error("Device is not connected");
		}
		const normalized = phoneNumber.replace(/[^\d]/g, "");
		if (!normalized) {
			throw new Error("Phone number is required");
		}

		const socket = connection.socket;
		if (socket.authState.creds.registered) {
			throw new Error("Device is already registered");
		}

		await socket.waitForSocketOpen();
		if (this.connections.get(deviceId)?.socket !== socket) {
			throw new Error("Connection was replaced before requesting pairing code");
		}
		if (socket.authState.creds.registered) {
			throw new Error("Device is already registered");
		}

		return socket.requestPairingCode(normalized);
	}

	private async flushAndDisposeAuthState(
		deviceId: string,
		authState = this.authStates.get(deviceId),
	) {
		if (!authState) return;

		try {
			await authState.flush();
		} finally {
			authState.dispose();
			if (this.authStates.get(deviceId) === authState) {
				this.authStates.delete(deviceId);
			}
		}
	}

	private disposeAuthState(deviceId: string) {
		const authState = this.authStates.get(deviceId);
		if (!authState) return;

		authState.dispose();
		if (this.authStates.get(deviceId) === authState) {
			this.authStates.delete(deviceId);
		}
	}

	async disconnect(deviceId: string) {
		this.invalidateConnectionLifecycle(deviceId);
		this.invalidateDeviceCaches(deviceId);
		const provider = await this.getDeviceProvider(deviceId);
		if (provider === "meta_cloud") {
			await disconnectMetaDevice(deviceId);
			this.emit("device:status", { deviceId, status: "disconnected" });
			return;
		}

		this.intentionalDisconnects.add(deviceId);
		this.clearReconnectTimer(deviceId);
		this.reconnectAttempts.delete(deviceId);
		await this.flushAndDisposeAuthState(deviceId);
		const connection = this.connections.get(deviceId);
		if (connection?.socket) {
			const endSocket = connection.socket.end as (
				error?: Error,
			) => Promise<void>;
			await endSocket(new Error("Intentional disconnect"));
			this.connections.delete(deviceId);
		}

		await this.updateDeviceStatus(deviceId, "disconnected");
	}

	async logout(deviceId: string) {
		const generation = this.invalidateConnectionLifecycle(deviceId);
		this.invalidateDeviceCaches(deviceId);
		const provider = await this.getDeviceProvider(deviceId);
		if (provider === "meta_cloud") {
			await logoutMetaDevice(deviceId);
			this.emit("device:status", { deviceId, status: "disconnected" });
			return;
		}

		this.intentionalDisconnects.add(deviceId);
		this.clearReconnectTimer(deviceId);
		this.reconnectAttempts.delete(deviceId);
		this.disposeAuthState(deviceId);
		const connection = this.connections.get(deviceId);
		if (connection?.socket) {
			await connection.socket.logout();
			this.connections.delete(deviceId);
		}

		await this.resetDeviceAuth(
			deviceId,
			"baileys_logged_out",
			undefined,
			generation,
		);
	}

	private async handleConnectionUpdate(
		deviceId: string,
		socket: DeviceConnection["socket"],
		authState: DbAuthState,
		update: BaileysEventMap["connection.update"],
	) {
		const connection = this.connections.get(deviceId);
		if (!connection?.socket || connection.socket !== socket) {
			return;
		}

		if (update.qr) {
			const qr = await QRCode.toDataURL(update.qr);
			if (this.connections.get(deviceId)?.socket !== socket) return;
			connection.qrCode = qr;
			this.emit("device:qr", { deviceId, qr });
		}

		if (update.connection === "open") {
			this.reconnectAttempts.delete(deviceId);
			this.clearReconnectTimer(deviceId);
			const phoneNumber = connection.socket.user?.id
				? (normalizeContactNumber(connection.socket.user.id) ?? undefined)
				: undefined;

			await this.updateDeviceStatus(deviceId, "connected", phoneNumber);
			if (this.connections.get(deviceId)?.socket !== socket) return;
			connection.qrCode = null;
			void this.syncParticipatingGroups(deviceId, socket);
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
			const classification = classifyDisconnectReason(statusCode);
			const intentional = this.intentionalDisconnects.delete(deviceId);
			const statusReason = intentional
				? "intentional_disconnect"
				: `baileys_${classification.reason}`;
			const operation = describeDisconnectOperation(classification, statusCode);

			await this.flushAndDisposeAuthState(deviceId, authState);
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.connections.delete(deviceId);
			this.invalidateDeviceCaches(deviceId);

			if (intentional) {
				await this.updateDeviceStatus(deviceId, "disconnected", undefined, {
					statusReason,
					lastError: operation,
				});
				this.reconnectAttempts.delete(deviceId);
				this.clearReconnectTimer(deviceId);
				return;
			}

			if (classification.disposition === "terminal") {
				const resetGeneration = this.invalidateConnectionLifecycle(deviceId);
				await this.resetDeviceAuth(
					deviceId,
					statusReason,
					operation,
					resetGeneration,
				);
				this.reconnectAttempts.delete(deviceId);
				this.clearReconnectTimer(deviceId);
				return;
			}

			const status =
				classification.disposition === "forbidden" ? "banned" : "disconnected";
			await this.updateDeviceStatus(deviceId, status, undefined, {
				statusReason,
				lastError: operation,
			});

			if (
				classification.disposition === "replaced" ||
				classification.disposition === "forbidden"
			) {
				this.reconnectAttempts.delete(deviceId);
				this.clearReconnectTimer(deviceId);
				return;
			}

			if (classification.disposition === "restart") {
				this.reconnectAttempts.delete(deviceId);
				this.clearReconnectTimer(deviceId);
				const restartGeneration = this.nextConnectionGeneration(deviceId);
				void this.reconnect(deviceId, restartGeneration).catch(() => {
					if (this.isCurrentConnectionGeneration(deviceId, restartGeneration)) {
						this.scheduleReconnect(deviceId);
					}
				});
				return;
			}

			this.scheduleReconnect(deviceId);
		}
	}

	private scheduleReconnect(deviceId: string) {
		if (this.reconnectTimers.has(deviceId)) return;

		const generation = this.connectionGenerations.get(deviceId) ?? 0;
		const attempt = (this.reconnectAttempts.get(deviceId) ?? 0) + 1;
		if (attempt > MAX_RECONNECT_ATTEMPTS) return;
		this.reconnectAttempts.set(deviceId, attempt);

		const baseDelay = Math.min(
			INITIAL_RECONNECT_DELAY_MS * 2 ** (attempt - 1),
			MAX_RECONNECT_DELAY_MS,
		);
		const jitter = baseDelay * RECONNECT_JITTER_RATIO * Math.random();
		const delay = Math.round(baseDelay + jitter);
		const timer = setTimeout(() => {
			this.reconnectTimers.delete(deviceId);
			if (!this.isCurrentConnectionGeneration(deviceId, generation)) return;
			void this.reconnect(deviceId, generation).catch(() => {
				if (
					this.isCurrentConnectionGeneration(deviceId, generation) &&
					!this.intentionalDisconnects.has(deviceId)
				) {
					this.scheduleReconnect(deviceId);
				}
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

	private async storeMessages(deviceId: string, messages: WAMessage[]) {
		await Promise.all(
			messages.map(async (message) => {
				try {
					await baileysMessageStore.store(deviceId, message);
				} catch (error) {
					console.error("Failed to persist Baileys message content", {
						deviceId,
						messageId: message.key.id,
						error,
					});
				}
			}),
		);
	}

	private async handleMessagingHistorySet(
		deviceId: string,
		socket: NonNullable<DeviceConnection["socket"]>,
		history: BaileysEventMap["messaging-history.set"],
	) {
		if (this.connections.get(deviceId)?.socket !== socket) return;
		await this.storeMessages(deviceId, history.messages);
		if (this.connections.get(deviceId)?.socket !== socket) return;
		await this.handleContactsUpsert(
			deviceId,
			socket,
			history.contacts,
			history.lidPnMappings,
		);
		if (this.connections.get(deviceId)?.socket !== socket) return;
		for (const mapping of history.lidPnMappings ?? []) {
			this.handleLidMappingUpdate(deviceId, mapping);
		}
		this.handleGroupsUpsert(deviceId, history.chats);
		this.handleChannelsUpsert(deviceId, history.chats);
		this.handleChannelsUpsert(
			deviceId,
			history.messages.map((message) => ({
				id: message.key.remoteJid,
				name: message.pushName,
			})),
		);
	}

	private handleMessagingHistoryStatus(
		deviceId: string,
		historyStatus: BaileysEventMap["messaging-history.status"],
	) {
		this.emit("device:history-sync-status", { deviceId, ...historyStatus });
		console.info("Baileys messaging history sync status", {
			deviceId,
			syncType: historyStatus.syncType,
			status: historyStatus.status,
			explicit: historyStatus.explicit,
		});
	}

	private handleLidMappingUpdate(
		deviceId: string,
		mapping: BaileysEventMap["lid-mapping.update"],
	) {
		const jid = toPhoneJid(mapping.pn);
		const phoneNumber = normalizeContactNumber(jid) ?? undefined;
		this.emit("device:contacts", {
			deviceId,
			contacts: [
				{
					jid,
					phoneNumber,
					lid: mapping.lid,
					identityKey: derivePrivateIdentityKey({
						jid,
						number: phoneNumber,
						lid: mapping.lid,
					}),
					isWaContact: true,
				},
			],
		});
	}

	private handleChatsUpsert(deviceId: string, chats: unknown[]) {
		this.handleGroupsUpsert(deviceId, chats);
		this.handleChannelsUpsert(deviceId, chats);
	}

	private handleChatsDelete(deviceId: string, jids: string[]) {
		console.info("Baileys chat deletion ignored to preserve inbox history", {
			deviceId,
			count: jids.length,
		});
	}

	private async handlePollUpdates(
		deviceId: string,
		socket: NonNullable<DeviceConnection["socket"]>,
		updates: BaileysEventMap["messages.update"],
	) {
		if (this.connections.get(deviceId)?.socket !== socket) return;
		for (const { key, update } of updates) {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			if (!update.pollUpdates?.length || !key.remoteJid) continue;
			if (getChatType(key.remoteJid) !== "private") continue;
			const content = await baileysMessageStore.get(deviceId, key);
			if (!content) {
				console.warn("poll_update_processing_failed", {
					deviceId,
					messageId: key.id,
					retryable: true,
					reason: "original_poll_content_missing",
				});
				continue;
			}
			const pollMessage: WAMessage = { key, message: content };
			for (const pollUpdate of update.pollUpdates) {
				const updateKey = pollUpdate.pollUpdateMessageKey;
				const voter = resolvePollUpdateVoter(updateKey);
				if (!voter || getChatType(voter.jid) !== "private") continue;
				const votes = getAggregateVotesInPollMessage(
					{ message: pollMessage.message, pollUpdates: [pollUpdate] },
					socket.user?.id,
				);
				const selected = votes.find((vote) => vote.voters.includes(voter.jid));
				if (!selected) continue;
				const updateIdentity =
					updateKey?.id ??
					createHash("sha256")
						.update(JSON.stringify({ key, updateKey, selected: selected.name }))
						.digest("hex");
				this.emit("device:poll-vote", {
					deviceId,
					pollCreationKey: key,
					pollCreationMessageId: key.id ?? "",
					voter,
					selectedOptionText: selected.name,
					updateIdentity,
				});
			}
		}
	}

	private async handleMessagesUpsert(
		deviceId: string,
		socket: NonNullable<DeviceConnection["socket"]>,
		upsert: BaileysEventMap["messages.upsert"],
	) {
		if (this.connections.get(deviceId)?.socket !== socket) return;
		await this.storeMessages(deviceId, upsert.messages);
		if (
			this.connections.get(deviceId)?.socket !== socket ||
			upsert.type !== "notify"
		) {
			return;
		}

		for (const message of upsert.messages) {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			if (message.key.fromMe || !message.key.remoteJid) {
				continue;
			}

			const normalizedMessage = normalizeBaileysMessage(message);
			const resolved = await this.resolveIncomingChatJid(
				deviceId,
				message.key.remoteJid,
				message.key.remoteJidAlt ?? undefined,
				message.key.remoteJidUsername ?? undefined,
			);
			const chatType = getChatType(resolved.jid);
			const groupInfo =
				chatType === "group"
					? await this.resolveGroupMetadata(deviceId, socket, resolved.jid)
					: undefined;
			const sender =
				chatType === "group"
					? await this.resolveIncomingSenderJid(
							deviceId,
							message.key.participant ?? undefined,
							message.key.participantAlt ?? undefined,
							message.key.participantUsername ?? undefined,
							message.pushName ?? undefined,
						)
					: {
							jid: resolved.jid,
							number: resolved.phoneNumber,
							lid: resolved.lid,
							username: resolved.username,
							identityKey: resolved.identityKey,
							name: message.pushName ?? undefined,
						};
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.emit("device:message", {
				deviceId,
				provider: "baileys",
				contact: {
					jid: resolved.jid,
					number: resolved.phoneNumber,
					lid: resolved.lid,
					username: resolved.username,
					identityKey: resolved.identityKey,
					name:
						chatType === "group" ? undefined : (message.pushName ?? undefined),
				},
				chat: {
					jid: resolved.jid,
					type: chatType,
					isGroup: chatType === "group",
				},
				sender,
				group:
					chatType === "group"
						? {
								jid: resolved.jid,
								name: groupInfo?.subject ?? resolved.jid,
							}
						: undefined,
				message: {
					text: normalizedMessage.text,
					type: normalizedMessage.type,
					reply: normalizedMessage.reply,
					raw: message,
					messageKey: message.key,
					providerMessageId: message.key.id ?? undefined,
				},
			});
		}
	}

	private async resolveIncomingChatJid(
		deviceId: string,
		jid: string,
		altJid?: string,
		username?: string,
	) {
		const connection = this.connections.get(deviceId);
		const lid = isLidJid(jid)
			? jid
			: altJid && isLidJid(altJid)
				? altJid
				: undefined;
		let phoneJid = isPhoneJid(jid)
			? jid
			: altJid && isPhoneJid(altJid)
				? altJid
				: undefined;

		if (!phoneJid && lid) {
			const mappings = await connection?.socket?.signalRepository.lidMapping
				.getPNsForLIDs([lid])
				.catch(() => null);
			phoneJid = mappings?.[0]?.pn ? toPhoneJid(mappings[0].pn) : undefined;
		}

		const phoneNumber = phoneJid ? normalizeContactNumber(phoneJid) : undefined;
		return {
			jid,
			phoneNumber: phoneNumber ?? undefined,
			lid,
			username,
			identityKey: derivePrivateIdentityKey({ jid, number: phoneNumber, lid }),
		};
	}

	private async resolveIncomingSenderJid(
		deviceId: string,
		jid?: string,
		altJid?: string,
		username?: string,
		name?: string,
	) {
		if (!jid) return { username, name };
		const resolved = await this.resolveIncomingChatJid(
			deviceId,
			jid,
			altJid,
			username,
		);
		return {
			jid: resolved.jid,
			number: resolved.phoneNumber,
			lid: resolved.lid,
			username: resolved.username,
			identityKey: resolved.identityKey,
			name,
		};
	}

	async downloadDeviceMedia(deviceId: string, raw: unknown) {
		const connection = this.connections.get(deviceId);
		if (!connection?.socket) {
			throw new Error("Device socket is not connected");
		}
		return downloadMediaMessage(
			raw as WAMessage,
			"buffer",
			{},
			{
				logger: connection.socket.logger,
				reuploadRequest: connection.socket.updateMediaMessage,
			},
		);
	}

	private async handleContactsUpsert(
		deviceId: string,
		socket: NonNullable<DeviceConnection["socket"]>,
		contacts: Partial<Contact>[],
		knownMappings: BaileysEventMap["lid-mapping.update"][] = [],
	) {
		if (this.connections.get(deviceId)?.socket !== socket) return;
		const lidJids = [
			...new Set(
				contacts
					.map((item) => item.lid ?? item.id)
					.filter(
						(jid): jid is string =>
							typeof jid === "string" && jid.endsWith("@lid"),
					),
			),
		];
		const pnByLid = new Map(
			knownMappings.map((mapping) => [mapping.lid, toPhoneJid(mapping.pn)]),
		);
		const unresolvedLids = lidJids.filter((lid) => !pnByLid.has(lid));
		const lidMappings = unresolvedLids.length
			? await socket.signalRepository.lidMapping
					.getPNsForLIDs(unresolvedLids)
					.catch(() => [])
			: [];
		if (this.connections.get(deviceId)?.socket !== socket) return;
		for (const mapping of lidMappings ?? []) {
			pnByLid.set(mapping.lid, toPhoneJid(mapping.pn));
		}

		const mapped = contacts
			.map((item) => {
				const rawJid = item.id;
				if (
					!rawJid ||
					rawJid.endsWith("@g.us") ||
					rawJid.endsWith("@newsletter")
				) {
					return null;
				}

				const lid = item.lid ?? (isLidJid(rawJid) ? rawJid : undefined);
				const phoneJid = item.phoneNumber
					? toPhoneJid(item.phoneNumber)
					: lid
						? pnByLid.get(lid)
						: isPhoneJid(rawJid)
							? rawJid
							: undefined;
				const jid = rawJid;
				const phoneNumber = phoneJid
					? normalizeContactNumber(phoneJid)
					: undefined;

				return {
					jid,
					phoneNumber: phoneNumber ?? undefined,
					lid,
					identityKey: derivePrivateIdentityKey({
						jid,
						number: phoneNumber,
						lid,
					}),
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

	private async syncParticipatingGroups(
		deviceId: string,
		socket: NonNullable<DeviceConnection["socket"]>,
	) {
		if (
			this.connections.get(deviceId)?.socket !== socket ||
			!socket.groupFetchAllParticipating
		) {
			return;
		}

		try {
			const groups = await socket.groupFetchAllParticipating();
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleGroupsUpsert(deviceId, Object.values(groups ?? {}));
		} catch {
			// Some sessions cannot fetch all group metadata immediately after connect.
		}
	}

	private async resolveGroupMetadata(
		deviceId: string,
		socket: NonNullable<DeviceConnection["socket"]>,
		jid: string,
	) {
		if (this.connections.get(deviceId)?.socket !== socket) return null;
		const cached = await groupMetadataStore.get(deviceId, jid);
		if (this.connections.get(deviceId)?.socket !== socket) return null;
		if (cached) return cached;

		try {
			const metadata = await socket.groupMetadata(jid);
			if (this.connections.get(deviceId)?.socket !== socket) return null;
			this.handleGroupsUpsert(deviceId, [metadata]);
			return metadata;
		} catch {
			return null;
		}
	}

	private mapGroups(groups: unknown[]): SyncedGroup[] {
		return groups
			.map((item): SyncedGroup | null => {
				if (!item || typeof item !== "object") return null;
				const record = item as Record<string, unknown>;
				const jid = getStringValue(record.id) ?? getStringValue(record.jid);
				if (!jid?.endsWith("@g.us")) return null;
				const participants = Array.isArray(record.participants)
					? record.participants
					: undefined;
				return {
					jid,
					subject:
						getStringValue(record.subject) ??
						getStringValue(record.name) ??
						jid,
					description:
						getStringValue(record.desc) ?? getStringValue(record.description),
					ownerJid: getStringValue(record.owner),
					participantCount:
						participants?.length ??
						getNumberValue(record.size) ??
						getNumberValue(record.participantCount),
					isMember: true,
					raw: item,
				};
			})
			.filter((item): item is SyncedGroup => item != null);
	}

	private updateGroupMetadataCache(deviceId: string, groups: unknown[]) {
		for (const group of groups) {
			if (!group || typeof group !== "object") continue;
			const record = group as {
				id?: unknown;
				jid?: unknown;
				participants?: unknown;
			};
			const jid = getStringValue(record.id) ?? getStringValue(record.jid);
			if (!jid?.endsWith("@g.us")) continue;

			if (!Array.isArray(record.participants)) {
				groupMetadataStore.invalidate(deviceId, jid);
				continue;
			}
			groupMetadataStore.set(
				deviceId,
				group as Parameters<typeof groupMetadataStore.set>[1],
			);
		}
	}

	private async handleGroupParticipantsUpdate(
		deviceId: string,
		socket: DeviceConnection["socket"],
		update: BaileysEventMap["group-participants.update"],
	) {
		if (!socket || this.connections.get(deviceId)?.socket !== socket) return;

		groupMetadataStore.invalidateDirty(deviceId, update.id);
		try {
			const metadata = await socket.groupMetadata(update.id);
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleGroupsUpsert(deviceId, [metadata], {
				reconcileParticipants: true,
			});
		} catch {
			// Keep the group dirty so Baileys fetches fresh metadata when needed.
		}
	}

	private handleGroupsUpsert(
		deviceId: string,
		groups: unknown[],
		options: { reconcileParticipants?: boolean } = {},
	) {
		this.updateGroupMetadataCache(deviceId, groups);
		const mapped = this.mapGroups(groups);
		if (mapped.length > 0) {
			this.emit("device:groups", {
				deviceId,
				groups: mapped,
				reconcileParticipants: options.reconcileParticipants,
			});
		}
	}

	private mapChannels(channels: unknown[]): SyncedNewsletter[] {
		return channels
			.map((item): SyncedNewsletter | null => {
				if (!item || typeof item !== "object") return null;
				const rootRecord = item as Record<string, unknown>;
				const notification = rootRecord.xwa2_notify_newsletter_on_join;
				const record =
					notification && typeof notification === "object"
						? (notification as Record<string, unknown>)
						: rootRecord;
				const rawJid = getStringValue(record.id) ?? getStringValue(record.jid);
				if (!rawJid?.endsWith("@newsletter")) return null;

				const threadMetadata =
					record.thread_metadata && typeof record.thread_metadata === "object"
						? (record.thread_metadata as Record<string, unknown>)
						: undefined;
				const jid = toNewsletterJid(rawJid);
				const name =
					getTextValue(record.name) ??
					getTextValue(record.subject) ??
					getTextValue(threadMetadata?.name) ??
					jid;

				return {
					jid,
					name,
					description:
						getTextValue(record.description) ??
						getTextValue(record.desc) ??
						getTextValue(threadMetadata?.description),
					ownerJid: getStringValue(record.owner),
					subscribersCount:
						getNumberValue(record.subscribers) ??
						getNumberValue(record.subscribers_count) ??
						getNumberValue(threadMetadata?.subscribers_count) ??
						getNumberValue(threadMetadata?.followers_count),
					isSubscribed: true,
					verificationStatus:
						getStringValue(record.verification) ??
						getStringValue(threadMetadata?.verification),
					raw: item,
				};
			})
			.filter((item): item is SyncedNewsletter => item != null);
	}

	private handleChannelsUpsert(deviceId: string, channels: unknown[]) {
		const mapped = this.mapChannels(channels);
		if (mapped.length > 0) {
			this.emit("device:channels", { deviceId, channels: mapped });
		}
	}

	private async handleNewsletterView(
		deviceId: string,
		socket: NonNullable<DeviceConnection["socket"]>,
		id: string,
	) {
		if (this.connections.get(deviceId)?.socket !== socket) return;

		const jid = toNewsletterJid(id);
		try {
			const metadata = await socket.newsletterMetadata("jid", jid);
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleChannelsUpsert(deviceId, [{ ...(metadata ?? {}), id: jid }]);
		} catch {
			if (this.connections.get(deviceId)?.socket !== socket) return;
			this.handleChannelsUpsert(deviceId, [{ id: jid }]);
		}
	}

	private async resetDeviceAuth(
		deviceId: string,
		statusReason = "baileys_logged_out",
		lastError?: string,
		expectedGeneration?: number,
	) {
		if (
			expectedGeneration !== undefined &&
			!this.isCurrentConnectionGeneration(deviceId, expectedGeneration)
		) {
			return;
		}
		this.disposeAuthState(deviceId);
		await clearDbAuthState(deviceId);
		if (
			expectedGeneration !== undefined &&
			!this.isCurrentConnectionGeneration(deviceId, expectedGeneration)
		) {
			return;
		}
		await db
			.update(device)
			.set({
				phoneNumber: null,
				status: "disconnected",
				statusReason,
				lastError: lastError ?? null,
				updatedAt: new Date(),
			})
			.where(eq(device.id, deviceId));
		if (
			expectedGeneration !== undefined &&
			!this.isCurrentConnectionGeneration(deviceId, expectedGeneration)
		) {
			return;
		}

		this.emit("device:status", {
			deviceId,
			status: "disconnected",
			statusReason,
			lastError,
		});
	}

	private async updateDeviceStatus(
		deviceId: string,
		status: DeviceStatus,
		phoneNumber?: string,
		context?: { statusReason?: string; lastError?: string },
	) {
		const values: Partial<typeof device.$inferInsert> = {
			status,
			updatedAt: new Date(),
		};

		if (phoneNumber) {
			values.phoneNumber = phoneNumber;
		}
		if (status === "connected") {
			values.lastConnectedAt = new Date();
			values.statusReason = null;
			values.lastError = null;
		} else if (context) {
			values.statusReason = context.statusReason;
			values.lastError = context.lastError;
		}

		await db.update(device).set(values).where(eq(device.id, deviceId));
		const connection = this.connections.get(deviceId);
		if (connection) {
			connection.status = status;
		}

		this.emit("device:status", {
			deviceId,
			status,
			phoneNumber,
			statusReason: context?.statusReason,
			lastError: context?.lastError,
		});
	}

	private async getDeviceProvider(deviceId: string) {
		const [row] = await db
			.select({ provider: device.provider })
			.from(device)
			.where(eq(device.id, deviceId))
			.limit(1);
		return row?.provider ?? "baileys";
	}
}

export const connectionManager = new ConnectionManager();
