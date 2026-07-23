import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { makeCurrentUser, makeSession } from "../test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

const { organizationRouter } = await import("./organization");

const dialect = new PgDialect();

function toSql(condition: SQL) {
	return dialect.sqlToQuery(condition).sql;
}

type QueryTrace = {
	whereConditions: SQL[];
	joinConditions: SQL[];
};

function createOrganizationQueryDb(results: unknown[][]) {
	const trace: QueryTrace = { whereConditions: [], joinConditions: [] };

	const db = {
		select() {
			return {
				from() {
					return this;
				},
				innerJoin(_table: unknown, condition: SQL) {
					trace.joinConditions.push(condition);
					return this;
				},
				where(condition: SQL) {
					trace.whereConditions.push(condition);
					return this;
				},
				orderBy() {
					return Promise.resolve(results.shift() ?? []);
				},
				limit() {
					return Promise.resolve(results.shift() ?? []);
				},
			};
		},
	};

	return { db, trace };
}

function createCaller(results: unknown[][]) {
	const { db, trace } = createOrganizationQueryDb(results);
	return {
		caller: organizationRouter.createCaller({
			auth: null,
			session: makeSession(),
			db,
			requestIp: "127.0.0.1",
			requestUserAgent: "bun-test",
		} as never),
		trace,
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

describe("organizationRouter discovery", () => {
	test("listMine selects only the caller's active organization memberships", async () => {
		const organizations = [
			{
				id: "tenant-1",
				name: "Active organization",
				slug: "active-organization",
				status: "active" as const,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
			},
		];
		const { caller, trace } = createCaller([
			[makeCurrentUser()],
			organizations,
		]);

		await expect(caller.listMine()).resolves.toEqual(organizations);
		const condition = trace.whereConditions[1];
		if (!condition)
			throw new Error("Expected organization membership condition");
		const sql = toSql(condition);
		expect(sql).toContain('"tenant_member"."user_id" = $1');
		expect(sql).toContain('"tenant_member"."status" = $2');
		expect(sql).toContain('"tenant"."status" = $3');
	});

	test("getBySlug does not reveal organizations without an active membership", async () => {
		const { caller, trace } = createCaller([[makeCurrentUser()], []]);

		await expectNotFound(caller.getBySlug({ slug: "other-organization" }));
		const condition = trace.whereConditions[1];
		if (!condition) throw new Error("Expected organization slug condition");
		const sql = toSql(condition);
		expect(sql).toContain('"tenant_member"."user_id" = $1');
		expect(sql).toContain('"tenant_member"."status" = $2');
		expect(sql).toContain('"tenant"."status" = $3');
		expect(sql).toContain('"tenant"."slug" = $4');
	});

	test("normalizes safe organization slugs before lookup", async () => {
		const organization = {
			id: "tenant-1",
			name: "Organization",
			slug: "organization",
			status: "active" as const,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
		};
		const { caller } = createCaller([[makeCurrentUser()], [organization]]);

		await expect(
			caller.getBySlug({ slug: "  ORGANIZATION  " }),
		).resolves.toEqual(organization);
	});
});

describe("organizationRouter role assignment input", () => {
	test("requires one explicit role identifier set", async () => {
		const { caller } = createCaller([]);

		await expect(
			caller.assignRoles({
				tenantId: "tenant-1",
				userId: "user-2",
			}),
		).rejects.toBeInstanceOf(TRPCError);
		await expect(
			caller.assignRoles({
				tenantId: "tenant-1",
				userId: "user-2",
				roleIds: ["role-1"],
				roleKeys: ["viewer"],
			}),
		).rejects.toBeInstanceOf(TRPCError);
	});

	function createOrganizationMutationDb(selectResults: unknown[][]) {
		const events: string[] = [];
		const createQuery = () => {
			const query = {
				from() {
					return query;
				},
				innerJoin() {
					return query;
				},
				where() {
					return query;
				},
				orderBy() {
					return query;
				},
				limit() {
					return query;
				},
				// biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
				then(
					resolve: (value: unknown[]) => unknown,
					reject: (reason: unknown) => unknown,
				) {
					return Promise.resolve(selectResults.shift() ?? []).then(
						resolve,
						reject,
					);
				},
			};
			return query;
		};
		const tx = {
			execute() {
				events.push("lock");
				return Promise.resolve();
			},
			select() {
				return createQuery();
			},
			delete() {
				events.push("state mutation");
				return { where: () => Promise.resolve() };
			},
			insert() {
				events.push("audit write");
				return {
					values(values: Record<string, unknown>) {
						return {
							returning: () =>
								Promise.resolve([
									{
										...values,
										sequence: 1,
										createdAt: new Date("2026-01-01T00:00:00.000Z"),
									},
								]),
						};
					},
				};
			},
			update() {
				return { set: () => ({ where: () => Promise.resolve() }) };
			},
		};
		const db = {
			select() {
				return createQuery();
			},
			transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => {
				events.push("transaction started");
				const value = await callback(tx);
				events.push("transaction resolved");
				return value;
			},
		};
		return { db, events };
	}

	function createOrganizationMutationCaller(selectResults: unknown[][]) {
		const { db, events } = createOrganizationMutationDb(selectResults);
		return {
			caller: organizationRouter.createCaller({
				auth: null,
				session: makeSession(),
				db,
				requestIp: "127.0.0.1",
				requestUserAgent: "bun-test",
			} as never),
			events,
		};
	}

	describe("organizationRouter role assignment safeguards", () => {
		test("denies an admin assigning the Owner role to themselves", async () => {
			const { caller } = createOrganizationMutationCaller([
				[makeCurrentUser()],
				[
					{
						tenantId: "tenant-1",
						userId: "user-1",
						role: "admin",
						organization: {
							id: "tenant-1",
							name: "Organization",
							slug: "organization",
							status: "active" as const,
						},
					},
				],
				[
					{
						tenantId: "tenant-1",
						userId: "user-1",
						role: "admin",
						organization: {
							id: "tenant-1",
							name: "Organization",
							slug: "organization",
							status: "active" as const,
						},
					},
				],
				[{ key: "organization.roles.assign" }],
				[{ id: "owner-role", key: "owner", name: "Owner" }],
				[{ userId: "user-1", email: "admin@example.com" }],
				[],
				[],
			]);

			await expect(
				caller.assignRoles({
					tenantId: "tenant-1",
					userId: "user-1",
					roleKeys: ["owner"],
				}),
			).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Only an active Owner can change the Owner role",
			});
		});

		test("writes the role-assignment audit record before its transaction resolves", async () => {
			const { caller, events } = createOrganizationMutationCaller([
				[makeCurrentUser()],
				[
					{
						tenantId: "tenant-1",
						userId: "user-1",
						role: "admin",
						organization: {
							id: "tenant-1",
							name: "Organization",
							slug: "organization",
							status: "active" as const,
						},
					},
				],
				[
					{
						tenantId: "tenant-1",
						userId: "user-1",
						role: "admin",
						organization: {
							id: "tenant-1",
							name: "Organization",
							slug: "organization",
							status: "active" as const,
						},
					},
				],
				[{ key: "organization.roles.assign" }],
				[{ userId: "user-2", email: "member@example.com" }],
				[],
				[],
			]);

			await expect(
				caller.assignRoles({
					tenantId: "tenant-1",
					userId: "user-2",
					roleKeys: [],
				}),
			).resolves.toEqual({ success: true, roles: [] });
			expect(events.indexOf("audit write")).toBeLessThan(
				events.indexOf("transaction resolved"),
			);
		});
	});
});
