import { decryptSecret, encryptSecret } from "@whatsapp-flow/auth/crypto";
import { db } from "@whatsapp-flow/db";
import { device, deviceProviderSecret } from "@whatsapp-flow/db/schema/device";
import {
	type AuthenticationCreds,
	type AuthenticationState,
	BufferJSON,
	initAuthCreds,
	proto,
	type SignalDataSet,
	type SignalDataTypeMap,
} from "baileys";
import { and, eq } from "drizzle-orm";

type StoredAuthState = {
	creds?: unknown;
	keys?: Partial<{
		[T in keyof SignalDataTypeMap]: Record<string, unknown>;
	}>;
};

type KeyStore = NonNullable<StoredAuthState["keys"]>;

const BAILEYS_AUTH_STATE_KEY = "auth_state";
const authStateWriteQueues = new Map<string, Promise<void>>();
const authStateGenerations = new Map<string, number>();

function nextAuthStateGeneration(deviceId: string) {
	const generation = (authStateGenerations.get(deviceId) ?? 0) + 1;
	authStateGenerations.set(deviceId, generation);
	return generation;
}

function isCurrentAuthStateGeneration(deviceId: string, generation: number) {
	return authStateGenerations.get(deviceId) === generation;
}

function enqueueAuthStateOperation<T>(
	deviceId: string,
	operation: () => Promise<T>,
) {
	const previous = authStateWriteQueues.get(deviceId) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(operation);
	const completion = next.then(
		() => undefined,
		() => undefined,
	);
	authStateWriteQueues.set(deviceId, completion);

	return next.finally(() => {
		if (authStateWriteQueues.get(deviceId) === completion) {
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

function decodeBase64TextBuffer(buffer: Buffer) {
	const text = buffer.toString("utf8");
	const decoded = base64StringToBuffer(text);
	return decoded && [32, 33, 64].includes(decoded.length) ? decoded : buffer;
}

function toAuthBuffer(value: unknown) {
	if (Buffer.isBuffer(value)) return decodeBase64TextBuffer(value);
	if (value instanceof Uint8Array)
		return decodeBase64TextBuffer(Buffer.from(value));
	if (typeof value === "string") return base64StringToBuffer(value);
	return null;
}

function normalizePublicKey(value: unknown) {
	const publicKey = toAuthBuffer(value);
	if (!publicKey) return value;
	return publicKey.length === 33 && publicKey[0] === 5
		? publicKey.subarray(1)
		: publicKey;
}

function coerceKeyPairBuffers(keyPair?: {
	public?: unknown;
	private?: unknown;
}) {
	if (!keyPair) return;
	keyPair.private = toAuthBuffer(keyPair.private) ?? keyPair.private;
	keyPair.public = normalizePublicKey(keyPair.public);
}

function normalizeAuthCreds(creds: AuthenticationCreds) {
	coerceKeyPairBuffers(creds.noiseKey);
	coerceKeyPairBuffers(creds.signedIdentityKey);
	coerceKeyPairBuffers(creds.signedPreKey?.keyPair);
	coerceKeyPairBuffers(creds.pairingEphemeralKeyPair);

	creds.signedPreKey.signature =
		toAuthBuffer(creds.signedPreKey.signature) ?? creds.signedPreKey.signature;
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

async function writeStoredAuthState(
	deviceId: string,
	generation: number,
	state: StoredAuthState,
	isDisposed: () => boolean,
) {
	await enqueueAuthStateOperation(deviceId, async () => {
		if (isDisposed() || !isCurrentAuthStateGeneration(deviceId, generation)) {
			return;
		}

		const encryptedValue = encryptSecret(
			JSON.stringify(state, BufferJSON.replacer),
		);
		await db
			.insert(deviceProviderSecret)
			.values({
				id: crypto.randomUUID(),
				deviceId,
				provider: "baileys",
				key: BAILEYS_AUTH_STATE_KEY,
				encryptedValue,
			})
			.onConflictDoUpdate({
				target: [deviceProviderSecret.deviceId, deviceProviderSecret.key],
				set: {
					provider: "baileys",
					encryptedValue,
					updatedAt: new Date(),
				},
			});
		await db
			.update(device)
			.set({ sessionData: null, updatedAt: new Date() })
			.where(eq(device.id, deviceId));
	});
}

async function clearStoredAuthState(deviceId: string) {
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
}

export function clearDbAuthState(deviceId: string) {
	return enqueueAuthStateOperation(deviceId, async () => {
		const generation = nextAuthStateGeneration(deviceId);
		await clearStoredAuthState(deviceId);
		return generation;
	});
}

export type DbAuthState = {
	state: AuthenticationState;
	saveCreds: () => Promise<void>;
	flush: () => Promise<void>;
	dispose: () => void;
};

export async function useDbAuthState(deviceId: string): Promise<DbAuthState> {
	const loaded = await enqueueAuthStateOperation(deviceId, async () => {
		let generation = nextAuthStateGeneration(deviceId);
		try {
			const stored = await readStoredAuthState(deviceId);
			const creds = stored.creds
				? deserialize<AuthenticationCreds>(stored.creds)
				: initAuthCreds();
			normalizeAuthCreds(creds);
			return {
				generation,
				creds,
				keys: deserialize<KeyStore>(stored.keys ?? {}),
			};
		} catch {
			console.warn("Stored Baileys auth state is invalid; resetting session", {
				deviceId,
			});
			generation = nextAuthStateGeneration(deviceId);
			await clearStoredAuthState(deviceId);
			return { generation, creds: initAuthCreds(), keys: {} };
		}
	});
	const { generation, creds, keys } = loaded;

	let persistTimer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	const persist = async () => {
		if (persistTimer) {
			clearTimeout(persistTimer);
			persistTimer = null;
		}
		if (disposed) return;
		await writeStoredAuthState(
			deviceId,
			generation,
			{ creds: serialize(creds), keys },
			() => disposed,
		);
	};

	const schedulePersist = () => {
		if (disposed) return;
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			persistTimer = null;
			persist().catch(() => {
				console.warn("Failed to persist Baileys auth state", { deviceId });
			});
		}, 250);
	};

	const dispose = () => {
		disposed = true;
		if (persistTimer) {
			clearTimeout(persistTimer);
			persistTimer = null;
		}
	};

	const keyStore = {
		get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
			const values: Partial<Record<string, SignalDataTypeMap[T]>> = {};
			const typeKeys = (keys[type] ?? {}) as Record<string, unknown>;

			for (const id of ids) {
				const value = typeKeys[id];
				if (value) {
					const deserialized = deserialize<SignalDataTypeMap[T]>(value);
					values[id] =
						type === "app-state-sync-key"
							? (proto.Message.AppStateSyncKeyData.fromObject(
									deserialized as Record<string, unknown>,
								) as unknown as SignalDataTypeMap[T])
							: deserialized;
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
	return {
		state: {
			creds,
			keys: keyStore,
		},
		saveCreds: persist,
		flush: persist,
		dispose,
	};
}
