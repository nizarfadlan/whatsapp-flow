import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { makeCurrentUser, makeSession } from "../test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

const { userRouter } = await import("./user");

type MockDbInput = {
	selects?: unknown[][];
	updates?: unknown[][];
	deletes?: unknown[][];
};

function createMockDb(input: MockDbInput = {}) {
	const selects = [...(input.selects ?? [])];
	const updates = [...(input.updates ?? [])];
	const deletes = [...(input.deletes ?? [])];
	const auditValues: unknown[] = [];

	function nextSelect() {
		return selects.shift() ?? [];
	}

	function query() {
		return {
			from() {
				return this;
			},
			where() {
				return this;
			},
			orderBy() {
				return this;
			},
			limit() {
				return Promise.resolve(nextSelect());
			},
			groupBy() {
				return Promise.resolve(nextSelect());
			},
		};
	}

	return {
		auditValues,
		select: query,
		update: () => ({
			set() {
				return this;
			},
			where() {
				return this;
			},
			returning() {
				return Promise.resolve(updates.shift() ?? []);
			},
		}),
		delete: () => ({
			where() {
				return this;
			},
			returning() {
				return Promise.resolve(deletes.shift() ?? []);
			},
		}),
		insert: () => ({
			values(value: unknown) {
				if (value && typeof value === "object" && "action" in value) {
					auditValues.push(value);
				}
				return this;
			},
			onConflictDoNothing() {
				return Promise.resolve();
			},
		}),
	};
}

function createCaller(db: ReturnType<typeof createMockDb>) {
	return userRouter.createCaller({
		auth: null,
		session: makeSession(),
		db,
		requestIp: "127.0.0.1",
		requestUserAgent: "bun-test",
	} as never);
}

async function expectRouterError(
	value: Promise<unknown>,
	code: TRPCError["code"],
	message: string,
) {
	try {
		await value;
	} catch (error) {
		expect(error).toBeInstanceOf(TRPCError);
		expect((error as TRPCError).code).toBe(code);
		expect((error as TRPCError).message).toContain(message);
		return;
	}
	throw new Error(`Expected ${code}`);
}

describe("userRouter guardrails", () => {
	test("blocks self-demotion", async () => {
		const currentUser = makeCurrentUser({ role: "admin" });
		const db = createMockDb({ selects: [[currentUser], [currentUser]] });

		await expectRouterError(
			createCaller(db).updateRole({ userId: "user-1", role: "member" }),
			"BAD_REQUEST",
			"cannot demote your own admin account",
		);
	});

	test("blocks self-session revoke", async () => {
		const db = createMockDb({
			selects: [[makeCurrentUser({ role: "admin" })]],
		});

		await expectRouterError(
			createCaller(db).revokeSessions({ userId: "user-1" }),
			"BAD_REQUEST",
			"cannot revoke your own active sessions",
		);
	});

	test("blocks self-suspension", async () => {
		const db = createMockDb({
			selects: [[makeCurrentUser({ role: "admin" })]],
		});

		await expectRouterError(
			createCaller(db).suspend({ userId: "user-1", reason: "test" }),
			"BAD_REQUEST",
			"cannot suspend your own account",
		);
	});

	test("protects last active persisted admin", async () => {
		const currentUser = makeCurrentUser({ id: "admin-2", role: "admin" });
		const target = makeCurrentUser({ id: "admin-1", role: "admin" });
		const db = createMockDb({
			selects: [[currentUser], [target], [{ total: 1 }]],
		});

		await expectRouterError(
			createCaller(db).suspend({ userId: "admin-1", reason: "test" }),
			"BAD_REQUEST",
			"At least one active persisted admin user is required",
		);
	});

	test("writes audit events for role updates", async () => {
		const currentUser = makeCurrentUser({ role: "admin" });
		const target = makeCurrentUser({
			id: "member-1",
			email: "member@example.com",
			role: "member",
		});
		const updated = { ...target, role: "admin" as const };
		const db = createMockDb({
			selects: [[currentUser], [target]],
			updates: [[updated]],
		});

		await expect(
			createCaller(db).updateRole({ userId: "member-1", role: "admin" }),
		).resolves.toMatchObject({ id: "member-1", role: "admin" });
		expect(db.auditValues).toHaveLength(1);
		expect(db.auditValues[0]).toMatchObject({
			action: "user.role_updated",
			targetType: "user",
			targetId: "member-1",
		});
	});
});
