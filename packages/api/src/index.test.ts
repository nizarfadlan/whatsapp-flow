import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { makeCurrentUser, makeSession } from "./test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.ADMIN_EMAILS = "bootstrap@example.com";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

const { adminProcedure, protectedProcedure, publicProcedure, router } =
	await import("./index");

const testRouter = router({
	protected: protectedProcedure.query(({ ctx }) => ctx.currentUser),
	admin: adminProcedure.query(({ ctx }) => ctx.currentUser),
});

const errorRouter = router({
	internal: publicProcedure.query(() => {
		const error = Object.assign(new Error("select * from private_table"), {
			code: "42P01",
		});
		throw error;
	}),
	forbidden: publicProcedure.query(() => {
		throw new TRPCError({ code: "FORBIDDEN", message: "Permission required" });
	}),
});

function callErrorRouter(path: string) {
	return fetchRequestHandler({
		endpoint: "/trpc",
		req: new Request(`http://localhost/trpc/${path}`),
		router: errorRouter,
		createContext: () => ({}) as never,
	});
}

function createDbForCurrentUser(
	currentUser: unknown,
	permissionRows: Array<{ permissionKey: string }> = [],
) {
	return {
		select: () => ({
			joined: false,
			from() {
				return this;
			},
			innerJoin() {
				this.joined = true;
				return this;
			},
			where() {
				if (this.joined) return Promise.resolve(permissionRows);
				return this;
			},
			limit() {
				return Promise.resolve(currentUser ? [currentUser] : []);
			},
		}),
	};
}

function createCaller(currentUser: unknown, session = makeSession()) {
	return testRouter.createCaller({
		auth: null,
		session,
		db: createDbForCurrentUser(currentUser),
		requestIp: null,
		requestUserAgent: null,
	} as never);
}

async function expectProcedureError(
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

describe("tRPC error formatting", () => {
	test("hides unexpected database errors from clients", async () => {
		const response = await callErrorRouter("internal");
		const body = await response.json();
		const serialized = JSON.stringify(body);

		expect(response.status).toBe(500);
		expect(body).toMatchObject({
			error: {
				message: "Internal server error",
				data: {
					code: "INTERNAL_SERVER_ERROR",
					httpStatus: 500,
					path: "internal",
				},
			},
		});
		expect(serialized).not.toContain("private_table");
		expect(serialized).not.toContain("42P01");
		expect(body.error.data).not.toHaveProperty("stack");
	});

	test("preserves expected tRPC errors", async () => {
		const response = await callErrorRouter("forbidden");
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body).toMatchObject({
			error: {
				message: "Permission required",
				data: { code: "FORBIDDEN", httpStatus: 403, path: "forbidden" },
			},
		});
	});
});

describe("protectedProcedure", () => {
	test("rejects unauthenticated users", async () => {
		await expectProcedureError(
			createCaller(null, null as never).protected(),
			"UNAUTHORIZED",
			"Authentication required",
		);
	});

	test("rejects missing users", async () => {
		await expectProcedureError(
			createCaller(null).protected(),
			"UNAUTHORIZED",
			"User not found",
		);
	});

	test("rejects suspended users", async () => {
		await expectProcedureError(
			createCaller(makeCurrentUser({ status: "suspended" })).protected(),
			"FORBIDDEN",
			"Account suspended",
		);
	});

	test("allows active users", async () => {
		await expect(
			createCaller(makeCurrentUser()).protected(),
		).resolves.toMatchObject({
			id: "user-1",
			status: "active",
		});
	});
});

describe("adminProcedure", () => {
	test("allows persisted admins", async () => {
		await expect(
			createCaller(makeCurrentUser({ role: "admin" })).admin(),
		).resolves.toMatchObject({ role: "admin" });
	});

	test("allows ADMIN_EMAILS bootstrap admins", async () => {
		await expect(
			createCaller(
				makeCurrentUser({ email: "bootstrap@example.com", role: "member" }),
			).admin(),
		).resolves.toMatchObject({ email: "bootstrap@example.com" });
	});

	test("rejects members without bootstrap admin email", async () => {
		await expectProcedureError(
			createCaller(makeCurrentUser({ role: "member" })).admin(),
			"FORBIDDEN",
			"Permission required",
		);
	});
});
