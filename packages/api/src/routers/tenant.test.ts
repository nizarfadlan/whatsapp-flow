import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { makeCurrentUser, makeSession } from "../test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

const { tenantRouter } = await import("./tenant");

function createMockDb(selects: unknown[][], whereConditions?: unknown[]) {
	function query() {
		return {
			from() {
				return this;
			},
			innerJoin() {
				return this;
			},
			where(condition: unknown) {
				whereConditions?.push(condition);
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

	return { select: query };
}

function createCaller(selects: unknown[][]) {
	return tenantRouter.createCaller({
		auth: null,
		session: makeSession(),
		db: createMockDb(selects),
		requestIp: "127.0.0.1",
		requestUserAgent: "bun-test",
	} as never);
}

function createInviteRevokedDuringAcceptanceDb() {
	const selects = [
		[makeCurrentUser()],
		[{ id: "invite-1", email: "admin@example.com" }],
	];
	let memberInsertions = 0;

	function query() {
		return {
			from() {
				return this;
			},
			where() {
				return this;
			},
			limit() {
				return Promise.resolve(selects.shift() ?? []);
			},
		};
	}

	const db = {
		select: query,
		transaction(callback: (tx: unknown) => Promise<unknown>) {
			return callback(db);
		},
		update() {
			return {
				set() {
					return this;
				},
				where() {
					return this;
				},
				returning() {
					return Promise.resolve([]);
				},
			};
		},
		insert() {
			memberInsertions += 1;
			return {
				values() {
					return this;
				},
				onConflictDoNothing() {
					return Promise.resolve();
				},
			};
		},
	};

	return { db, getMemberInsertions: () => memberInsertions };
}

async function expectNotFound(value: Promise<unknown>, message: string) {
	try {
		await value;
	} catch (error) {
		expect(error).toBeInstanceOf(TRPCError);
		expect((error as TRPCError).code).toBe("NOT_FOUND");
		expect((error as TRPCError).message).toContain(message);
		return;
	}
	throw new Error("Expected NOT_FOUND");
}

describe("tenantRouter public invite lookup", () => {
	test("returns only generic validity for an active invite", async () => {
		const invite = await createCaller([
			[
				{
					status: "pending",
					revokedAt: null,
					expiresAt: new Date(Date.now() + 60_000),
				},
			],
		]).getInvite({ token: "a".repeat(32) });

		expect(invite).toEqual({ valid: true });
		expect(Object.keys(invite)).toEqual(["valid"]);
	});
});

describe("tenantRouter invite acceptance", () => {
	test("does not add a member when invite revocation wins the claim", async () => {
		const { db, getMemberInsertions } = createInviteRevokedDuringAcceptanceDb();
		const caller = tenantRouter.createCaller({
			auth: null,
			session: makeSession(),
			db,
			requestIp: "127.0.0.1",
			requestUserAgent: "bun-test",
		} as never);

		await expectNotFound(
			caller.acceptInvite({ token: "a".repeat(32) }),
			"Invite not found",
		);
		expect(getMemberInsertions()).toBe(0);
	});
});

describe("tenantRouter access boundaries", () => {
	test("does not let a global admin list another tenant's members", async () => {
		await expectNotFound(
			createCaller([[makeCurrentUser({ role: "admin" })], []]).listMembers({
				tenantId: "tenant-2",
			}),
			"Tenant not found",
		);
	});

	test("does not let a flow owner manage a flow after losing tenant membership", async () => {
		await expectNotFound(
			createCaller([[makeCurrentUser()], []]).listFlowGrants({
				tenantId: "tenant-1",
				flowId: "flow-1",
			}),
			"Tenant not found",
		);
	});

	test("does not let a device owner manage a device after losing tenant membership", async () => {
		await expectNotFound(
			createCaller([[makeCurrentUser()], []]).listDeviceGrants({
				tenantId: "tenant-1",
				deviceId: "device-1",
			}),
			"Tenant not found",
		);
	});
});
