import { db } from "@whatsapp-flow/db";
import { device } from "@whatsapp-flow/db/schema/device";
import {
	type AuthenticationCreds,
	type AuthenticationState,
	BufferJSON,
	initAuthCreds,
	makeCacheableSignalKeyStore,
	type SignalDataSet,
	type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { eq } from "drizzle-orm";

type StoredAuthState = {
	creds?: unknown;
	keys?: Partial<{
		[T in keyof SignalDataTypeMap]: Record<string, unknown>;
	}>;
};

type KeyStore = NonNullable<StoredAuthState["keys"]>;

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

function deserialize<T>(value: unknown): T {
	return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
}

async function readStoredAuthState(deviceId: string): Promise<StoredAuthState> {
	const rows = await db
		.select({ sessionData: device.sessionData })
		.from(device)
		.where(eq(device.id, deviceId))
		.limit(1);

	return (rows[0]?.sessionData as StoredAuthState | null) ?? {};
}

async function writeStoredAuthState(deviceId: string, state: StoredAuthState) {
	await enqueueAuthStateWrite(deviceId, async () => {
		await db
			.update(device)
			.set({ sessionData: state, updatedAt: new Date() })
			.where(eq(device.id, deviceId));
	});
}

export async function clearDbAuthState(deviceId: string) {
	await enqueueAuthStateWrite(deviceId, async () => {
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
	const creds = stored.creds
		? deserialize<AuthenticationCreds>(stored.creds)
		: initAuthCreds();
	const keys: KeyStore = stored.keys ?? {};

	const persist = async () => {
		await writeStoredAuthState(deviceId, {
			creds: serialize(creds),
			keys,
		});
	};

	return {
		state: {
			creds,
			keys: makeCacheableSignalKeyStore({
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

					await persist();
				},
				clear: async () => {
					for (const type of Object.keys(keys) as (keyof SignalDataTypeMap)[]) {
						delete keys[type];
					}

					await persist();
				},
			}),
		},
		saveCreds: persist,
	};
}
