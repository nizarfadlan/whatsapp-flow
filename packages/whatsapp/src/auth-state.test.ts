import { beforeEach, describe, expect, mock, test } from "bun:test";

let storedSecret: string | undefined;
let writes = 0;
let clearBarrier: Promise<void> | null = null;

const db = {
	select: (fields: Record<string, unknown>) => ({
		from: () => ({
			where: () => ({
				limit: async () =>
					"encryptedValue" in fields && storedSecret
						? [{ encryptedValue: storedSecret }]
						: [],
			}),
		}),
	}),
	insert: () => ({
		values: (value: { encryptedValue: string }) => ({
			onConflictDoUpdate: async () => {
				storedSecret = value.encryptedValue;
				writes += 1;
			},
		}),
	}),
	delete: () => ({
		where: async () => {
			await clearBarrier;
			storedSecret = undefined;
		},
	}),
	update: () => ({
		set: () => ({ where: async () => {} }),
	}),
};

mock.module("@whatsapp-flow/db", () => ({ db }));
mock.module("@whatsapp-flow/db/schema/device", () => ({
	device: { id: "id", sessionData: "sessionData" },
	deviceProviderSecret: {
		deviceId: "deviceId",
		key: "key",
		encryptedValue: "encryptedValue",
	},
}));
mock.module("@whatsapp-flow/auth/crypto", () => ({
	encryptSecret: (value: string) => value,
	decryptSecret: (value: string) => value,
}));
const { clearDbAuthState, useDbAuthState } = await import("./auth-state");

beforeEach(async () => {
	writes = 0;
	clearBarrier = null;
	await clearDbAuthState("device-1");
});

describe("useDbAuthState lifecycle", () => {
	test("flush persists the current credentials", async () => {
		const authState = await useDbAuthState("device-1");
		authState.state.creds.registered = true;

		await authState.flush();

		expect(writes).toBe(1);
		expect(JSON.parse(storedSecret ?? "{}").creds.registered).toBe(true);
	});

	test("pending debounced writes cannot persist after disposal or clearing", async () => {
		const disposed = await useDbAuthState("device-1");
		await disposed.state.keys.set({
			"pre-key": { one: { keyId: 1 } },
		} as never);
		disposed.dispose();
		await Bun.sleep(300);
		expect(storedSecret).toBeUndefined();

		const cleared = await useDbAuthState("device-1");
		await cleared.state.keys.set({ "pre-key": { two: { keyId: 2 } } } as never);
		await clearDbAuthState("device-1");
		await Bun.sleep(300);
		expect(storedSecret).toBeUndefined();
	});

	test("a load queued after a clear sees the cleared auth state", async () => {
		const persisted = await useDbAuthState("device-1");
		persisted.state.creds.registered = true;
		await persisted.flush();

		let releaseClear = () => {};
		clearBarrier = new Promise<void>((resolve) => {
			releaseClear = resolve;
		});
		const clear = clearDbAuthState("device-1");
		await Promise.resolve();
		const load = useDbAuthState("device-1");

		releaseClear();
		await clear;
		const authState = await load;

		expect(authState.state.creds.registered).toBe(false);
		expect(storedSecret).toBeUndefined();
	});

	test("older auth-state generations cannot overwrite a newer state", async () => {
		const older = await useDbAuthState("device-1");
		older.state.creds.registered = true;

		const newer = await useDbAuthState("device-1");
		newer.state.creds.registered = false;
		await newer.flush();
		await older.flush();

		expect(writes).toBe(1);
		expect(JSON.parse(storedSecret ?? "{}").creds.registered).toBe(false);
	});

	test("corrupt stored auth state is cleared and recovered", async () => {
		storedSecret = "not valid JSON";

		const authState = await useDbAuthState("device-1");
		expect(authState.state.creds.registered).toBe(false);

		await authState.flush();
		expect(() => JSON.parse(storedSecret ?? "")).not.toThrow();
	});
});
