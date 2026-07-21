import { describe, expect, test } from "bun:test";
import {
	classifyMigrationDatabase,
	formatDrizzleKitFailure,
	isKnownMigrationLedgerPrefix,
	requiredApplicationTablesForAppliedMigrations,
} from "./migrate";

const migrationEntries = [
	{ createdAt: 100, hash: "first-hash" },
	{ createdAt: 200, hash: "second-hash" },
	{ createdAt: 300, hash: "third-hash" },
] as const;

describe("isKnownMigrationLedgerPrefix", () => {
	test("accepts non-empty exact ordered prefixes from the checked-in journal", () => {
		expect(
			isKnownMigrationLedgerPrefix([migrationEntries[0]], migrationEntries),
		).toBe(true);
		expect(
			isKnownMigrationLedgerPrefix(
				migrationEntries.slice(0, 2),
				migrationEntries,
			),
		).toBe(true);
		expect(
			isKnownMigrationLedgerPrefix(migrationEntries, migrationEntries),
		).toBe(true);
	});

	test("refuses empty, skipped, reordered, timestamp-mismatched, and hash-mismatched ledgers", () => {
		expect(isKnownMigrationLedgerPrefix([], migrationEntries)).toBe(false);
		expect(
			isKnownMigrationLedgerPrefix(
				[migrationEntries[0], migrationEntries[2]],
				migrationEntries,
			),
		).toBe(false);
		expect(
			isKnownMigrationLedgerPrefix(
				[migrationEntries[1], migrationEntries[0]],
				migrationEntries,
			),
		).toBe(false);
		expect(
			isKnownMigrationLedgerPrefix(
				[migrationEntries[0], { createdAt: 200, hash: "unexpected-hash" }],
				migrationEntries,
			),
		).toBe(false);
		expect(
			isKnownMigrationLedgerPrefix(
				[{ createdAt: 999, hash: "first-hash" }],
				migrationEntries,
			),
		).toBe(false);
		expect(
			isKnownMigrationLedgerPrefix(
				[...migrationEntries, { createdAt: 400, hash: "fourth-hash" }],
				migrationEntries,
			),
		).toBe(false);
	});
});

describe("requiredApplicationTablesForAppliedMigrations", () => {
	test("allows the baseline prefix to upgrade into tenant sharing", () => {
		expect(requiredApplicationTablesForAppliedMigrations(1)).not.toContain(
			"flow_access_grant",
		);
	});

	test("requires tenant sharing tables after their migration is recorded", () => {
		expect(requiredApplicationTablesForAppliedMigrations(2)).toEqual(
			expect.arrayContaining([
				"device_access_grant",
				"flow_access_grant",
				"flow_trigger_secret",
				"tenant",
				"tenant_invitation",
				"tenant_member",
			]),
		);
	});
});

describe("classifyMigrationDatabase", () => {
	test("allows an application schema with a known pending-migration prefix", () => {
		expect(
			classifyMigrationDatabase({
				hasApplicationTables: true,
				hasMigrationLedgerRows: true,
				hasKnownMigrationLedgerPrefix: true,
				missingRequiredApplicationTables: [],
			}),
		).toBe("migrated");
	});

	test("refuses a known ledger whose required schema is incomplete", () => {
		expect(
			classifyMigrationDatabase({
				hasApplicationTables: true,
				hasMigrationLedgerRows: true,
				hasKnownMigrationLedgerPrefix: true,
				missingRequiredApplicationTables: ["flow_access_grant"],
			}),
		).toBe("inconsistent");
	});

	test("keeps populated databases without a known ledger unsafe", () => {
		expect(
			classifyMigrationDatabase({
				hasApplicationTables: true,
				hasMigrationLedgerRows: false,
				hasKnownMigrationLedgerPrefix: false,
				missingRequiredApplicationTables: [],
			}),
		).toBe("inconsistent");
		expect(
			classifyMigrationDatabase({
				hasApplicationTables: true,
				hasMigrationLedgerRows: true,
				hasKnownMigrationLedgerPrefix: false,
				missingRequiredApplicationTables: [],
			}),
		).toBe("inconsistent");
	});

	test("allows an empty database to migrate", () => {
		expect(
			classifyMigrationDatabase({
				hasApplicationTables: false,
				hasMigrationLedgerRows: false,
				hasKnownMigrationLedgerPrefix: false,
				missingRequiredApplicationTables: [],
			}),
		).toBe("empty");
	});
});

describe("formatDrizzleKitFailure", () => {
	test("labels captured output without exposing database URLs", () => {
		const databaseUrl =
			"postgresql://migration-user:super-secret@database:5432/flow";
		const failure = formatDrizzleKitFailure({
			exitCode: 1,
			stdout: `Connecting to ${databaseUrl}`,
			stderr:
				"Connection to postgres://other-user:other-secret@other:5432/db failed",
			databaseUrl,
		});

		expect(failure).toContain("drizzle-kit migrate failed with exit code 1.");
		expect(failure).toContain("Captured stdout:");
		expect(failure).toContain("Captured stderr:");
		expect(failure).toContain("DATABASE_URL=<redacted>");
		expect(failure).not.toContain("super-secret");
		expect(failure).not.toContain("other-secret");
	});

	test("redacts URLs whose passwords contain quote characters", () => {
		const databaseUrl =
			"postgresql://migration-user:expected-secret@database:5432/flow";
		const quotedPasswordUrl =
			"postgresql://other-user:super-'secret\"@other:5432/flow";
		const failure = formatDrizzleKitFailure({
			exitCode: 1,
			stdout: `Connecting to '${quotedPasswordUrl}'`,
			stderr: "",
			databaseUrl,
		});

		expect(failure).toContain("DATABASE_URL=<redacted>");
		expect(failure).not.toContain("super-'secret\"");
		expect(failure).not.toContain("other:5432/flow");
	});
});
