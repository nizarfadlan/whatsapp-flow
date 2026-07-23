import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { makeCurrentUser, makeSession } from "../test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

const { flowLogRouter } = await import("./flow-log");
const dialect = new PgDialect();

function createCaller(whereConditions: SQL[]) {
	const results = [
		[makeCurrentUser()],
		[
			{
				tenantId: "tenant-1",
				userId: "user-1",
				role: "member",
				organization: {
					id: "tenant-1",
					name: "Organization",
					slug: "organization",
					status: "active",
				},
			},
		],
		[
			{
				tenantId: "tenant-1",
				userId: "user-1",
				role: "member",
				organization: {
					id: "tenant-1",
					name: "Organization",
					slug: "organization",
					status: "active",
				},
			},
		],
		[{ key: "organization.flows.read" }],
		[],
	];
	const db = {
		select() {
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
				where(condition: SQL) {
					whereConditions.push(condition);
					return this;
				},
				limit() {
					return Promise.resolve(results.shift() ?? []);
				},
				orderBy() {
					return Promise.resolve(results.shift() ?? []);
				},
			};
		},
	};
	return flowLogRouter.createCaller({
		auth: null,
		session: makeSession(),
		db,
		requestIp: "127.0.0.1",
		requestUserAgent: "bun-test",
	} as never);
}

describe("flowLogRouter tenant scoping", () => {
	test("does not return a log outside the active organization", async () => {
		const whereConditions: SQL[] = [];
		const result = await createCaller(whereConditions).getById({
			id: "foreign-log",
			tenantId: "tenant-1",
		});
		expect(result).toBeNull();
		const condition = whereConditions[4];
		if (!condition) throw new Error("Expected tenant-scoped log query");
		const sql = dialect.sqlToQuery(condition).sql;
		expect(sql).toContain('"flow_execution_log"."id" = $1');
		expect(sql).toContain('"flow"."tenant_id" = $2');
	});
});
