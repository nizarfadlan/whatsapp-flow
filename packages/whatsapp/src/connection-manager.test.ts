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
const baileys = (await import("baileys")) as unknown as {
	fetchLatestBaileysVersion: ReturnType<typeof mock>;
	makeWASocket: ReturnType<typeof mock>;
};
const authStateModule = (await import("./auth-state")) as unknown as {
	useDbAuthState: ReturnType<typeof mock>;
};
const QRCode = (await import("qrcode")).default as unknown as {
	toDataURL: ReturnType<typeof mock>;
};
const disconnectClassification = (await import(
	"./disconnect-classification"
)) as unknown as {
	classifyDisconnectReason: ReturnType<typeof mock>;
	describeDisconnectOperation: ReturnType<typeof mock>;
};

async function captureDiagnosticWrites(action: () => Promise<void>) {
	const consoleLog = console.log;
	const consoleWarn = console.warn;
	const consoleError = console.error;
	const writes: unknown[][] = [];
	const capture = (...args: unknown[]) => writes.push(args);
	console.log = mock(capture);
	console.warn = mock(capture);
	console.error = mock(capture);
	try {
		await action();
		return writes;
	} finally {
		console.log = consoleLog;
		console.warn = consoleWarn;
		console.error = consoleError;
	}
}

function diagnosticEvents(writes: unknown[][]) {
	return writes.map(([line]) => JSON.parse(String(line)).event as string);
}

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

describe("ConnectionManager Baileys diagnostics", () => {
	test("passes a sanitizing logger to Baileys without emitting library arguments", async () => {
		const socket = {
			authState: { creds: { registered: false } },
			end: mock(),
			ev: { on: mock() },
		};
		const authState = {
			dispose: mock(),
			saveCreds: mock(),
			state: {},
		};
		const manager = new ConnectionManager();
		const internals = manager as unknown as {
			connectionGenerations: Map<string, number>;
			createConnection: (
				deviceId: string,
				generation: number,
			) => Promise<unknown>;
			updateDeviceStatus: ReturnType<typeof mock>;
		};
		internals.connectionGenerations.set("device-1", 1);
		internals.updateDeviceStatus = mock(async () => {});
		baileys.fetchLatestBaileysVersion.mockResolvedValue({
			version: [2, 3000, 0],
		});
		baileys.makeWASocket.mockReturnValue(socket);
		authStateModule.useDbAuthState.mockResolvedValue(authState);

		const sensitiveValue = "sensitive-qr-and-phone-number";
		const writes = await captureDiagnosticWrites(async () => {
			await internals.createConnection("device-1", 1);
			const options = baileys.makeWASocket.mock.calls.at(-1)?.[0] as {
				logger: { error: (obj: unknown, message?: string) => void };
			};
			expect(options.logger).toBeDefined();
			options.logger.error({ qr: sensitiveValue }, sensitiveValue);
		});

		expect(JSON.stringify(writes)).not.toContain(sensitiveValue);
	});
});

test("emits sanitized QR, open, close, and reconnect lifecycle records", async () => {
	const socket = { user: undefined };
	const authState = { dispose: mock(), flush: mock(async () => {}) };
	const manager = new ConnectionManager();
	const connection = {
		provider: "baileys" as const,
		qrCode: null,
		status: "connecting" as const,
		socket: socket as never,
	};
	const internals = manager as unknown as {
		authStates: Map<string, typeof authState>;
		clearReconnectTimer: (deviceId: string) => void;
		connectionGenerations: Map<string, number>;
		connections: Map<string, typeof connection>;
		handleConnectionUpdate: (...args: unknown[]) => Promise<void>;
		syncParticipatingGroups: ReturnType<typeof mock>;
		updateDeviceStatus: ReturnType<typeof mock>;
	};
	internals.connectionGenerations.set("device-1", 1);
	internals.connections.set("device-1", connection);
	internals.authStates.set("device-1", authState);
	internals.syncParticipatingGroups = mock(async () => {});
	internals.updateDeviceStatus = mock(async () => {});
	disconnectClassification.classifyDisconnectReason.mockReturnValue({
		disposition: "retry",
		reason: "connection_lost",
	});
	disconnectClassification.describeDisconnectOperation.mockReturnValue(
		"Reconnect the device",
	);
	const sensitiveValue = "qr:credential:phone:message";
	QRCode.toDataURL.mockResolvedValue("data:image/png;base64,safe-output");

	const writes = await captureDiagnosticWrites(async () => {
		await internals.handleConnectionUpdate("device-1", 1, socket, authState, {
			connection: "connecting",
			isNewLogin: true,
			isOnline: false,
			qr: sensitiveValue,
			receivedPendingNotifications: false,
		} as never);
		await internals.handleConnectionUpdate("device-1", 1, socket, authState, {
			connection: "open",
		} as never);
		await internals.handleConnectionUpdate("device-1", 1, socket, authState, {
			connection: "close",
			lastDisconnect: {
				error: {
					detail: sensitiveValue,
					output: { statusCode: 428 },
				},
			},
		} as never);
		internals.clearReconnectTimer("device-1");
	});

	expect(diagnosticEvents(writes)).toEqual(
		expect.arrayContaining([
			"baileys.connection.updated",
			"baileys.connection.qr_received",
			"baileys.connection.opened",
			"baileys.connection.closed",
			"baileys.connection.reconnect_scheduled",
		]),
	);
	expect(JSON.stringify(writes)).not.toContain(sensitiveValue);
});

test("logs QR encoding failures without serializing the QR or error", async () => {
	const socket = {};
	const authState = { dispose: mock(), flush: mock(async () => {}) };
	const manager = new ConnectionManager();
	const connection = {
		provider: "baileys" as const,
		qrCode: null,
		status: "connecting" as const,
		socket: socket as never,
	};
	const internals = manager as unknown as {
		connectionGenerations: Map<string, number>;
		connections: Map<string, typeof connection>;
		handleConnectionUpdate: (...args: unknown[]) => Promise<void>;
	};
	internals.connectionGenerations.set("device-1", 1);
	internals.connections.set("device-1", connection);
	const sensitiveValue = "unserializable-qr-and-auth-state";
	QRCode.toDataURL.mockRejectedValue(new Error(sensitiveValue));

	const writes = await captureDiagnosticWrites(() =>
		internals.handleConnectionUpdate("device-1", 1, socket, authState, {
			qr: sensitiveValue,
		} as never),
	);

	expect(diagnosticEvents(writes)).toEqual(
		expect.arrayContaining([
			"baileys.connection.updated",
			"baileys.connection.qr_received",
			"baileys.connection.qr_encoding_failed",
		]),
	);
	expect(JSON.stringify(writes)).not.toContain(sensitiveValue);
});

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
