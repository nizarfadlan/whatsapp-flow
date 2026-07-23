import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	getActiveOrganizationMembership,
	hasOrganizationPermission,
	requireOrganizationPermission,
} from "./organization";
import { requireFlowAccess } from "./tenant-access";

type QueryTrace = {
	fromCalls: number;
	innerJoinCalls: number;
	joinConditions: SQL[];
	whereCalls: number;
	whereConditions: SQL[];
	limitCalls: number;
};

const dialect = new PgDialect();

function toSql(condition: SQL) {
	return dialect.sqlToQuery(condition).sql;
}

function createChainedQueryFake(selects: unknown[][]) {
	const trace: QueryTrace = {
		fromCalls: 0,
		innerJoinCalls: 0,
		joinConditions: [],
		whereCalls: 0,
		whereConditions: [],
		limitCalls: 0,
	};

	return {
		db: {
			select() {
				return {
					from() {
						trace.fromCalls += 1;
						return this;
					},
					innerJoin(_table: unknown, condition: SQL) {
						trace.innerJoinCalls += 1;
						trace.joinConditions.push(condition);
						return this;
					},
					leftJoin() {
						return this;
					},
					where(condition: SQL) {
						trace.whereCalls += 1;
						trace.whereConditions.push(condition);
						return this;
					},
					limit() {
						trace.limitCalls += 1;
						return Promise.resolve(selects.shift() ?? []);
					},
				};
			},
		},
		trace,
	};
}

async function expectError(
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

describe("organization authorization", () => {
	test("resolves only active organization memberships", async () => {
		const { db, trace } = createChainedQueryFake([
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
		]);

		await expect(
			getActiveOrganizationMembership(db as never, "tenant-1", "user-1"),
		).resolves.toEqual({
			tenantId: "tenant-1",
			userId: "user-1",
			role: "member",
			organization: {
				id: "tenant-1",
				name: "Organization",
				slug: "organization",
				status: "active",
			},
		});
		expect(trace).toMatchObject({
			fromCalls: 1,
			innerJoinCalls: 1,
			whereCalls: 1,
			limitCalls: 1,
		});
		const [whereCondition] = trace.whereConditions;
		const [joinCondition] = trace.joinConditions;
		if (!whereCondition || !joinCondition) {
			throw new Error("Expected membership query conditions");
		}
		expect(toSql(whereCondition)).toContain('"tenant_member"."status" = $3');
		expect(toSql(whereCondition)).toContain('"tenant"."status" = $4');
		expect(toSql(joinCondition)).toBe(
			'"tenant"."id" = "tenant_member"."tenant_id"',
		);
	});

	test("does not resolve suspended, removed, or archived organization access", async () => {
		for (const state of ["suspended", "removed", "archived"]) {
			const { db } = createChainedQueryFake([[]]);
			await expect(
				getActiveOrganizationMembership(db as never, "tenant-1", "user-1"),
			).resolves.toBeNull();
			expect(state).toBeTruthy();
		}
	});

	test("calculates permissions from same-organization role assignments", async () => {
		const { db, trace } = createChainedQueryFake([[{ key: "flows.manage" }]]);

		await expect(
			hasOrganizationPermission(
				db as never,
				"tenant-1",
				"user-1",
				"flows.manage",
			),
		).resolves.toBeTrue();
		expect(trace).toMatchObject({
			fromCalls: 1,
			innerJoinCalls: 5,
			whereCalls: 1,
			limitCalls: 1,
		});
		const joinSql = trace.joinConditions.map(toSql).join(" ");
		expect(joinSql).toContain(
			'"tenant_member"."tenant_id" = "tenant_role_assignment"."tenant_id"',
		);
		expect(joinSql).toContain(
			'"tenant_role"."tenant_id" = "tenant_role_assignment"."tenant_id"',
		);
		expect(joinSql).toContain(
			'"tenant_role_permission"."tenant_id" = "tenant_role_assignment"."tenant_id"',
		);
		expect(joinSql).toContain(
			'"tenant_permission"."tenant_id" = "tenant_role_assignment"."tenant_id"',
		);
		expect(joinSql).toContain('"tenant_member"."status" = $1');
		expect(joinSql).toContain('"tenant"."status" = $1');
	});

	test("returns a generic not-found error before revealing organization permissions", async () => {
		const { db } = createChainedQueryFake([[]]);

		await expectError(
			requireOrganizationPermission(
				db as never,
				"tenant-1",
				"user-1",
				"flows.manage",
			),
			"NOT_FOUND",
			"Tenant not found",
		);
	});

	test("rejects active members without the requested organization permission", async () => {
		const { db } = createChainedQueryFake([
			[{ tenantId: "tenant-1", userId: "user-1", role: "member" }],
			[],
		]);

		await expectError(
			requireOrganizationPermission(
				db as never,
				"tenant-1",
				"user-1",
				"flows.manage",
			),
			"FORBIDDEN",
			"Organization permission required",
		);
	});

	test("does not let a resource grant authorize without active membership", async () => {
		const { db, trace } = createChainedQueryFake([[]]);

		await expectError(
			requireFlowAccess(db as never, "flow-1", "user-1", "viewer"),
			"NOT_FOUND",
			"Flow not found",
		);
		expect(trace.innerJoinCalls).toBe(2);
	});
});
