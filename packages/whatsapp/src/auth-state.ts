import { decryptSecret, encryptSecret } from "@whatsapp-flow/auth/crypto";
import { db } from "@whatsapp-flow/db";
import { device, deviceProviderSecret } from "@whatsapp-flow/db/schema/device";
import {
	type AuthenticationCreds,
	type AuthenticationState,
	BufferJSON,
	initAuthCreds,
	type SignalDataSet,
	type SignalDataTypeMap,
	wrapLegacyStore,
} from "baileys";
import { and, eq } from "drizzle-orm";

type BridgeStore = Record<string, Record<string, unknown>>;

type StoredAuthState = {
	creds?: unknown;
	keys?: Partial<{
		[T in keyof SignalDataTypeMap]: Record<string, unknown>;
	}>;
	bridge?: BridgeStore;
};

type KeyStore = NonNullable<StoredAuthState["keys"]>;

const BAILEYS_AUTH_STATE_KEY = "auth_state";
const RAW_BRIDGE_STORES = new Set(["msg_secret"]);
const authStateWriteQueues = new Map<string, Promise<void>>();

function enqueueAuthStateWrite(deviceId: string, write: () => Promise<void>) {
	const previous = authStateWriteQueues.get(deviceId) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(write);
	authStateWriteQueues.set(deviceId, next);

	return next.finally(() => {
		if (authStateWriteQueues.get(deviceId) === next) {
			authStateWriteQueues.delete(deviceId);
		}
	});
}

function serialize<T>(value: T): unknown {
	return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

const BINARY_AUTH_FIELD_NAMES = new Set([
	"public",
	"private",
	"signature",
	"keyData",
]);

function isByteArray(value: unknown[]): value is number[] {
	return value.every(
		(item): item is number =>
			typeof item === "number" &&
			Number.isInteger(item) &&
			item >= 0 &&
			item <= 255,
	);
}

function base64StringToBuffer(value: string) {
	if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;

	const buffer = Buffer.from(value, "base64");
	const normalizedValue = value.replace(/=+$/, "");
	const normalizedBuffer = buffer.toString("base64").replace(/=+$/, "");

	return normalizedBuffer === normalizedValue ? buffer : null;
}

function numericObjectToBuffer(value: Record<string, unknown>) {
	const entries = Object.entries(value);
	if (entries.length === 0) return null;
	const indexed = entries
		.map(([key, item]) => [Number(key), item] as const)
		.sort(([a], [b]) => a - b);
	if (
		indexed.some(
			([index, item], expected) =>
				!Number.isInteger(index) ||
				index !== expected ||
				typeof item !== "number",
		)
	) {
		return null;
	}
	const bytes = indexed.map(([, item]) => item);
	return isByteArray(bytes) ? Buffer.from(bytes) : null;
}

function reviveBinaryValues(value: unknown, key?: string): unknown {
	const revived = BufferJSON.reviver("", value);
	if (revived !== value) return revived;
	if (typeof value === "string" && key && BINARY_AUTH_FIELD_NAMES.has(key)) {
		return base64StringToBuffer(value) ?? value;
	}
	if (Buffer.isBuffer(value)) return value;
	if (value instanceof Uint8Array) return Buffer.from(value);
	if (Array.isArray(value))
		return value.map((item) => reviveBinaryValues(item));
	if (!value || typeof value !== "object") return value;

	const record = value as Record<string, unknown>;
	if (record.type === "Buffer") {
		if (typeof record.data === "string")
			return Buffer.from(record.data, "base64");
		if (Array.isArray(record.data) && isByteArray(record.data)) {
			return Buffer.from(record.data);
		}
		if (record.data && typeof record.data === "object") {
			const buffer = numericObjectToBuffer(
				record.data as Record<string, unknown>,
			);
			if (buffer) return buffer;
		}
	}

	const buffer = numericObjectToBuffer(record);
	if (buffer) return buffer;

	return Object.fromEntries(
		Object.entries(record).map(([itemKey, item]) => [
			itemKey,
			reviveBinaryValues(item, itemKey),
		]),
	);
}

function deserialize<T>(value: unknown): T {
	return reviveBinaryValues(value) as T;
}

function isBinaryValue(value: unknown) {
	return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function normalizeKeyPair(keyPair: { public?: unknown; private?: unknown }) {
	if (!isBinaryValue(keyPair.public) || !isBinaryValue(keyPair.private)) {
		throw new Error("Stored Baileys auth state contains invalid key material");
	}

	const publicKey = Buffer.from(keyPair.public);
	const privateKey = Buffer.from(keyPair.private);
	if (privateKey.length !== 32) {
		throw new Error("Stored Baileys auth state contains invalid private key");
	}
	if (publicKey.length === 33 && publicKey[0] === 5) {
		keyPair.public = publicKey.subarray(1);
	} else if (publicKey.length !== 32) {
		throw new Error("Stored Baileys auth state contains invalid public key");
	}
	keyPair.private = privateKey;
}

function normalizeAuthCreds(creds: AuthenticationCreds) {
	const keyPairs = [
		creds.noiseKey,
		creds.signedIdentityKey,
		creds.signedPreKey?.keyPair,
		creds.pairingEphemeralKeyPair,
	].filter(Boolean) as { public?: unknown; private?: unknown }[];

	for (const keyPair of keyPairs) {
		normalizeKeyPair(keyPair);
	}

	if (creds.signedPreKey?.signature) {
		const signature = Buffer.from(creds.signedPreKey.signature);
		if (signature.length !== 64) {
			throw new Error("Stored Baileys auth state contains invalid signature");
		}
		creds.signedPreKey.signature = signature;
	}
}

async function readStoredAuthState(deviceId: string): Promise<StoredAuthState> {
	const [encrypted] = await db
		.select({ encryptedValue: deviceProviderSecret.encryptedValue })
		.from(deviceProviderSecret)
		.where(
			and(
				eq(deviceProviderSecret.deviceId, deviceId),
				eq(deviceProviderSecret.key, BAILEYS_AUTH_STATE_KEY),
			),
		)
		.limit(1);

	if (encrypted) {
		return deserialize<StoredAuthState>(
			JSON.parse(decryptSecret(encrypted.encryptedValue)),
		);
	}

	const rows = await db
		.select({ sessionData: device.sessionData })
		.from(device)
		.where(eq(device.id, deviceId))
		.limit(1);

	return deserialize<StoredAuthState>(rows[0]?.sessionData ?? {});
}

async function writeStoredAuthState(deviceId: string, state: StoredAuthState) {
	await enqueueAuthStateWrite(deviceId, async () => {
		await db
			.insert(deviceProviderSecret)
			.values({
				id: crypto.randomUUID(),
				deviceId,
				provider: "baileys",
				key: BAILEYS_AUTH_STATE_KEY,
				encryptedValue: encryptSecret(
					JSON.stringify(state, BufferJSON.replacer),
				),
			})
			.onConflictDoUpdate({
				target: [deviceProviderSecret.deviceId, deviceProviderSecret.key],
				set: {
					provider: "baileys",
					encryptedValue: encryptSecret(
						JSON.stringify(state, BufferJSON.replacer),
					),
					updatedAt: new Date(),
				},
			});
		await db
			.update(device)
			.set({ sessionData: null, updatedAt: new Date() })
			.where(eq(device.id, deviceId));
	});
}

export async function clearDbAuthState(deviceId: string) {
	await enqueueAuthStateWrite(deviceId, async () => {
		await db
			.delete(deviceProviderSecret)
			.where(
				and(
					eq(deviceProviderSecret.deviceId, deviceId),
					eq(deviceProviderSecret.key, BAILEYS_AUTH_STATE_KEY),
				),
			);
		await db
			.update(device)
			.set({ sessionData: null, updatedAt: new Date() })
			.where(eq(device.id, deviceId));
	});
}

export async function useDbAuthState(deviceId: string): Promise<{
	state: AuthenticationState;
	saveCreds: () => Promise<void>;
}> {
	const stored = await readStoredAuthState(deviceId);
	let creds: AuthenticationCreds;
	let keys: KeyStore;
	let bridge: BridgeStore;
	try {
		creds = stored.creds
			? deserialize<AuthenticationCreds>(stored.creds)
			: initAuthCreds();
		normalizeAuthCreds(creds);
		keys = deserialize<KeyStore>(stored.keys ?? {});
		bridge = deserialize<BridgeStore>(stored.bridge ?? {});
	} catch (error) {
		console.warn("Stored Baileys auth state is invalid; resetting session", {
			deviceId,
			error,
		});
		await clearDbAuthState(deviceId);
		creds = initAuthCreds();
		keys = {};
		bridge = {};
	}

	let persistTimer: ReturnType<typeof setTimeout> | null = null;

	const persist = async () => {
		if (persistTimer) {
			clearTimeout(persistTimer);
			persistTimer = null;
		}
		await writeStoredAuthState(deviceId, {
			creds: serialize(creds),
			keys,
			bridge,
		});
	};

	const schedulePersist = () => {
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			persistTimer = null;
			persist().catch((error) => {
				console.warn("Failed to persist Baileys auth state", {
					deviceId,
					error,
				});
			});
		}, 250);
	};

	const keyStore = {
		get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
			const values: Partial<Record<string, SignalDataTypeMap[T]>> = {};
			const typeKeys = (keys[type] ?? {}) as Record<string, unknown>;

			for (const id of ids) {
				const value = typeKeys[id];
				if (value) {
					values[id] = deserialize<SignalDataTypeMap[T]>(value);
				}
			}

			return values as Record<string, SignalDataTypeMap[T]>;
		},
		set: async (data: SignalDataSet) => {
			for (const [type, entries] of Object.entries(data) as [
				keyof SignalDataTypeMap,
				Record<string, unknown>,
			][]) {
				keys[type] ??= {};

				for (const [id, value] of Object.entries(entries)) {
					if (value === null) {
						delete keys[type]?.[id];
						continue;
					}

					keys[type][id] = serialize(value);
				}
			}

			schedulePersist();
		},
		clear: async () => {
			for (const type of Object.keys(keys) as (keyof SignalDataTypeMap)[]) {
				delete keys[type];
			}

			schedulePersist();
		},
	};
	const legacyBridgeStore = await wrapLegacyStore(
		{ creds, keys: keyStore },
		persist,
	);
	const store: NonNullable<AuthenticationState["store"]> = {
		async get(storeName, key) {
			if (RAW_BRIDGE_STORES.has(storeName)) {
				const value = bridge[storeName]?.[key];
				return value ? Buffer.from(deserialize<Uint8Array>(value)) : null;
			}

			return legacyBridgeStore.get(storeName, key);
		},
		async set(storeName, key, value) {
			if (RAW_BRIDGE_STORES.has(storeName)) {
				bridge[storeName] ??= {};
				bridge[storeName][key] = serialize(Buffer.from(value));
				schedulePersist();
				return;
			}

			await legacyBridgeStore.set(storeName, key, value);
		},
		async delete(storeName, key) {
			if (RAW_BRIDGE_STORES.has(storeName)) {
				delete bridge[storeName]?.[key];
				schedulePersist();
				return;
			}

			await legacyBridgeStore.delete(storeName, key);
		},
		async flush() {
			await legacyBridgeStore.flush();
			await persist();
		},
	};

	return {
		state: {
			creds,
			keys: keyStore,
			store,
		},
		saveCreds: persist,
	};
}
