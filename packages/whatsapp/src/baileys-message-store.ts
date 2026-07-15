import { db } from "@whatsapp-flow/db";
import { baileysMessageContent } from "@whatsapp-flow/db/schema/baileys-message";
import type * as schema from "@whatsapp-flow/db/schema/index";
import {
	BufferJSON,
	type proto,
	type WAMessage,
	type WAMessageKey,
} from "baileys";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { BoundedDeviceCache } from "./bounded-device-cache";

export { BoundedDeviceCache } from "./bounded-device-cache";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_MESSAGES_PER_DEVICE = 500;

type Database = NodePgDatabase<typeof schema>;

type StoredMessageKey = {
	remoteJid: string;
	providerMessageId: string;
	fromMe: boolean;
	participant: string;
};

function toStoredMessageKey(key: WAMessageKey): StoredMessageKey | null {
	if (!key.remoteJid || !key.id) return null;
	return {
		remoteJid: key.remoteJid,
		providerMessageId: key.id,
		fromMe: key.fromMe ?? false,
		participant: key.fromMe ? "" : (key.participant ?? ""),
	};
}

export function getMessageCacheKey(key: WAMessageKey): string | null {
	const storedKey = toStoredMessageKey(key);
	return storedKey ? JSON.stringify(storedKey) : null;
}

export function serializeMessageContent(content: proto.IMessage): unknown {
	return JSON.parse(JSON.stringify(content, BufferJSON.replacer));
}

export function reviveMessageContent(content: unknown): proto.IMessage {
	return JSON.parse(
		JSON.stringify(content),
		BufferJSON.reviver,
	) as proto.IMessage;
}

function providerTimestamp(message: WAMessage) {
	const timestamp = message.messageTimestamp;
	if (timestamp == null) return null;
	const seconds = Number(timestamp);
	return Number.isFinite(seconds) && seconds > 0
		? new Date(seconds * 1_000)
		: null;
}

export class BaileysMessageStore {
	private readonly cache: BoundedDeviceCache<proto.IMessage>;

	constructor(
		private readonly database: Database = db,
		options: {
			cacheTtlMs?: number;
			maxMessagesPerDevice?: number;
			now?: () => number;
		} = {},
	) {
		this.cache = new BoundedDeviceCache(
			options.maxMessagesPerDevice ?? DEFAULT_MAX_MESSAGES_PER_DEVICE,
			options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
			options.now,
		);
	}

	async store(deviceId: string, message: WAMessage) {
		const key = toStoredMessageKey(message.key);
		const cacheKey = getMessageCacheKey(message.key);
		if (!key || !cacheKey || !message.message) return;

		const content = serializeMessageContent(message.message);
		this.cache.set(deviceId, cacheKey, message.message);
		await this.database
			.insert(baileysMessageContent)
			.values({
				deviceId,
				...key,
				content,
				providerTimestamp: providerTimestamp(message),
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: [
					baileysMessageContent.deviceId,
					baileysMessageContent.remoteJid,
					baileysMessageContent.providerMessageId,
					baileysMessageContent.fromMe,
					baileysMessageContent.participant,
				],
				set: {
					content,
					providerTimestamp: providerTimestamp(message),
					updatedAt: new Date(),
				},
			});
	}

	async get(deviceId: string, key: WAMessageKey) {
		const storedKey = toStoredMessageKey(key);
		const cacheKey = getMessageCacheKey(key);
		if (!storedKey || !cacheKey) return undefined;

		const cached = this.cache.get(deviceId, cacheKey);
		if (cached) return cached;

		const [stored] = await this.database
			.select({ content: baileysMessageContent.content })
			.from(baileysMessageContent)
			.where(
				and(
					eq(baileysMessageContent.deviceId, deviceId),
					eq(baileysMessageContent.remoteJid, storedKey.remoteJid),
					eq(
						baileysMessageContent.providerMessageId,
						storedKey.providerMessageId,
					),
					eq(baileysMessageContent.fromMe, storedKey.fromMe),
					eq(baileysMessageContent.participant, storedKey.participant),
				),
			)
			.limit(1);
		if (!stored) return undefined;

		const content = reviveMessageContent(stored.content);
		this.cache.set(deviceId, cacheKey, content);
		return content;
	}

	invalidateDevice(deviceId: string) {
		this.cache.clearDevice(deviceId);
	}
}

export const baileysMessageStore = new BaileysMessageStore();
