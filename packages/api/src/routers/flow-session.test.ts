import { describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { makeCurrentUser, makeSession } from "../test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

mock.module("@whatsapp-flow/whatsapp", () => ({
	connectionManager: { emit: mock(() => undefined) },
	derivePrivateIdentityKey: ({ jid }: { jid?: string | null }) =>
		`jid:${jid ?? "unknown"}`,
	deriveThreadKey: ({ chatJid }: { chatJid?: string | null }) =>
		`thread:${chatJid ?? "unknown"}`,
	phoneNumberFromJid: (jid?: string | null) =>
		jid?.endsWith("@s.whatsapp.net") ? jid.split("@")[0] : null,
	sendDeviceMessage: mock(() => Promise.resolve({ provider: "baileys" })),
}));

const { flowSessionRouter } = await import("./flow-session");
const dialect = new PgDialect();

function createCaller(whereConditions: SQL[]) {
	const membership = {
		tenantId: "tenant-1",
		userId: "user-1",
		role: "member",
		organization: {
			id: "tenant-1",
			name: "Organization",
			slug: "organization",
			status: "active",
		},
	};
	const results = [
		[makeCurrentUser()],
		[membership],
		[membership],
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
				where(condition: SQL) {
					whereConditions.push(condition);
					return this;
				},
				limit() {
					return Promise.resolve(results.shift() ?? []);
				},
			};
		},
	};
	return flowSessionRouter.createCaller({
		auth: null,
		session: makeSession(),
		db,
		requestIp: "127.0.0.1",
		requestUserAgent: "bun-test",
	} as never);
}

describe("flowSessionRouter tenant scoping", () => {
	test("does not return a session outside the active organization", async () => {
		const whereConditions: SQL[] = [];
		await expect(
			createCaller(whereConditions).get({
				id: "foreign-session",
				tenantId: "tenant-1",
			}),
		).resolves.toBeNull();
		const condition = whereConditions[4];
		if (!condition) throw new Error("Expected tenant-scoped session query");
		const sql = dialect.sqlToQuery(condition).sql;
		expect(sql).toContain('"flow_session"."id" = $1');
		expect(sql).toContain('"flow"."tenant_id" = $2');
	});
});
