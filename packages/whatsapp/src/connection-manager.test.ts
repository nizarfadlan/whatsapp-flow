import { describe, expect, mock, test } from "bun:test";

mock.module("@whatsapp-flow/db", () => ({
	db: {
		select: () => ({
			from: () => ({ where: () => ({ limit: async () => [] }) }),
		}),
	},
}));
mock.module("@whatsapp-flow/db/schema/device", () => ({
	device: { id: "id", provider: "provider" },
}));
mock.module("baileys", () => ({
	DEFAULT_CONNECTION_CONFIG: {},
	downloadMediaMessage: mock(),
	fetchLatestBaileysVersion: mock(),
	getAggregateVotesInPollMessage: mock(),
	makeWASocket: mock(),
}));
mock.module("drizzle-orm", () => ({ eq: mock() }));
mock.module("qrcode", () => ({ default: { toDataURL: mock() } }));
mock.module("./auth-state", () => ({
	clearDbAuthState: mock(),
	useDbAuthState: mock(),
}));
mock.module("./baileys-message-store", () => ({
	BoundedDeviceCache: class {},
	baileysMessageStore: { invalidateDevice: mock() },
}));
mock.module("./disconnect-classification", () => ({
	classifyDisconnectReason: mock(),
	describeDisconnectOperation: mock(),
}));
mock.module("./group-metadata-store", () => ({
	groupMetadataStore: { invalidateDevice: mock() },
}));
mock.module("./message-content", () => ({
	normalizeBaileysMessage: mock(),
}));
const { ConnectionManager } = await import("./connection-manager");

type PairingSocket = {
	authState: { creds: { registered: boolean } };
	waitForSocketOpen: ReturnType<typeof mock>;
	requestPairingCode: ReturnType<typeof mock>;
};

function createPairingSocket(registered = false) {
	let signalWaitStarted = () => {};
	const waitStarted = new Promise<void>((resolve) => {
		signalWaitStarted = resolve;
	});
	let resolveReady = () => {};
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	const requestPairingCode = mock(() => Promise.resolve("123-456"));
	const waitForSocketOpen = mock(() => {
		signalWaitStarted();
		return ready;
	});

	return {
		socket: {
			authState: { creds: { registered } },
			waitForSocketOpen,
			requestPairingCode,
		} satisfies PairingSocket,
		waitStarted,
		resolveReady,
	};
}

function prepareManager(socket: PairingSocket) {
	const manager = new ConnectionManager();
	const connection = {
		provider: "baileys" as const,
		qrCode: null,
		status: "connecting" as const,
		socket: socket as never,
	};
	const internals = manager as unknown as {
		connections: Map<string, typeof connection>;
		getDeviceProvider: (deviceId: string) => Promise<"baileys">;
	};

	internals.connections.set("device-1", connection);
	internals.getDeviceProvider = async () => "baileys";
	manager.connect = mock(async () => connection);
	return { manager, internals, connection };
}

describe("ConnectionManager.requestPairingCode", () => {
	test("waits for socket readiness before requesting a normalized pairing code", async () => {
		const { socket, waitStarted, resolveReady } = createPairingSocket();
		const { manager } = prepareManager(socket);

		const pairingCode = manager.requestPairingCode(
			"device-1",
			"+1 (555) 123-4567",
		);
		await waitStarted;
		expect(socket.requestPairingCode).not.toHaveBeenCalled();

		resolveReady();
		await expect(pairingCode).resolves.toBe("123-456");
		expect(socket.requestPairingCode).toHaveBeenCalledTimes(1);
		expect(socket.requestPairingCode).toHaveBeenCalledWith("15551234567");
	});

	test("rejects when the socket is replaced while waiting for readiness", async () => {
		const { socket, waitStarted, resolveReady } = createPairingSocket();
		const { manager, internals, connection } = prepareManager(socket);

		const pairingCode = manager.requestPairingCode("device-1", "15551234567");
		await waitStarted;
		internals.connections.set("device-1", {
			...connection,
			socket: {} as never,
		});
		resolveReady();

		await expect(pairingCode).rejects.toThrow(
			"Connection was replaced before requesting pairing code",
		);
		expect(socket.requestPairingCode).not.toHaveBeenCalled();
	});

	test("rejects an already registered device without waiting or requesting a code", async () => {
		const { socket } = createPairingSocket(true);
		const { manager } = prepareManager(socket);

		await expect(
			manager.requestPairingCode("device-1", "15551234567"),
		).rejects.toThrow("Device is already registered");
		expect(socket.waitForSocketOpen).not.toHaveBeenCalled();
		expect(socket.requestPairingCode).not.toHaveBeenCalled();
	});
});
