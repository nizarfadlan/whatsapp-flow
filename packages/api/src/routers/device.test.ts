import { describe, expect, mock, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { makeCurrentUser, makeSession } from "../test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

mock.module("@whatsapp-flow/whatsapp", () => ({
	configureMetaDevice: mock(() => Promise.resolve()),
	configureMetaDeviceFromEmbeddedSignup: mock(() => Promise.resolve()),
	connectionManager: {
		connect: mock(() => Promise.resolve({ status: "connected" })),
		disconnect: mock(() => Promise.resolve()),
		getConnection: mock(() => null),
		getQrCode: mock(() => null),
		logout: mock(() => Promise.resolve()),
		requestPairingCode: mock(() => Promise.resolve("123456")),
	},
	getMetaConfigSummary: mock(() => Promise.resolve(null)),
}));

const { deviceRouter } = await import("./device");

type Selection = Record<string, unknown> | undefined;

function createMockDb(selects: unknown[][]) {
	const selections: Selection[] = [];

	function query(selection?: Selection) {
		selections.push(selection);
		return {
			from() {
				return this;
			},
			innerJoin() {
				return this;
			},
			leftJoin() {
				return this;
			},
			where() {
				return this;
			},
			limit() {
				return Promise.resolve(selects.shift() ?? []);
			},
			orderBy() {
				return Promise.resolve(selects.shift() ?? []);
			},
		};
	}

	return { db: { select: query }, selections };
}

function createCaller(selects: unknown[][]) {
	const mockDb = createMockDb(selects);
	return {
		caller: deviceRouter.createCaller({
			auth: null,
			session: makeSession(),
			db: mockDb.db,
			requestIp: "127.0.0.1",
			requestUserAgent: "bun-test",
		} as never),
		selections: mockDb.selections,
	};
}

async function expectNotFound(value: Promise<unknown>) {
	try {
		await value;
	} catch (error) {
		expect(error).toBeInstanceOf(TRPCError);
		expect((error as TRPCError).code).toBe("NOT_FOUND");
		return;
	}
	throw new Error("Expected NOT_FOUND");
}

describe("deviceRouter.list", () => {
	test("returns server-derived ownership and tenant context for device controls", async () => {
		const { caller, selections } = createCaller([
			[makeCurrentUser()],
			[
				{
					id: "device-1",
					tenantId: "tenant-1",
					ownerUserId: "user-1",
					isOwner: true,
					name: "Support line",
				},
			],
		]);

		await expect(caller.list()).resolves.toHaveLength(1);
		expect(Object.keys(selections[1] ?? {}).sort()).toEqual([
			"businessAccountId",
			"createdAt",
			"displayPhoneNumber",
			"externalId",
			"id",
			"isOwner",
			"lastConnectedAt",
			"lastError",
			"lastWebhookAt",
			"name",
			"ownerUserId",
			"phoneNumber",
			"provider",
			"status",
			"statusReason",
			"tenantId",
			"updatedAt",
		]);
	});
});

describe("deviceRouter.listForDeploy", () => {
	test("lists only deploy-safe fields for owned and explicitly granted devices", async () => {
		const { caller, selections } = createCaller([
			[makeCurrentUser()],
			[
				{
					flow: { id: "flow-1", tenantId: "tenant-1", userId: "user-1" },
					grantCapability: null,
				},
			],
			[
				{
					id: "device-1",
					name: "Support line",
					provider: "baileys",
					status: "connected",
				},
			],
		]);

		await expect(caller.listForDeploy({ flowId: "flow-1" })).resolves.toEqual([
			{
				id: "device-1",
				name: "Support line",
				provider: "baileys",
				status: "connected",
			},
		]);
		expect(Object.keys(selections[2] ?? {}).sort()).toEqual([
			"id",
			"name",
			"provider",
			"status",
		]);
	});

	test("does not list devices when the caller lacks active flow tenant membership", async () => {
		const { caller } = createCaller([[makeCurrentUser()], []]);

		await expectNotFound(caller.listForDeploy({ flowId: "flow-1" }));
	});
});
