import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { Client } from "pg";

const applicationTables = [
	"account",
	"app_settings",
	"audit_export",
	"audit_log",
	"auth_provider_setting",
	"baileys_message_content",
	"channel",
	"chat_group",
	"contact",
	"contact_tag",
	"device",
	"device_access_grant",
	"device_provider_secret",
	"device_sync_run",
	"flow",
	"flow_access_grant",
	"flow_execution_event",
	"flow_execution_log",
	"flow_node_secret",
	"flow_session",
	"flow_trigger_secret",
	"group_participant",
	"group_tag",
	"inbox_message",
	"inbox_thread",
	"job_queue",
	"permission",
	"role",
	"role_permission",
	"session",
	"smtp_setting",
	"tag",
	"tenant",
	"tenant_invitation",
	"tenant_member",
	"tenant_member_provenance",
	"tenant_permission",
	"tenant_role",
	"tenant_role_assignment",
	"tenant_role_permission",
	"user",
	"user_invitation",
	"user_role_assignment",
	"verification",
	"webhook_delivery",
	"webhook_endpoint",
] as const;

type ApplicationTable = (typeof applicationTables)[number];

const migrationJournal = JSON.parse(
	readFileSync(
		new URL("../src/migrations/meta/_journal.json", import.meta.url),
		"utf8",
	),
) as { entries: { tag: string; when: number }[] };

const tenantSharingMigrationIndex = migrationJournal.entries.findIndex(
	({ tag }) => tag === "0003_awesome_stark_industries",
);
const organizationFoundationMigrationIndex = migrationJournal.entries.findIndex(
	({ tag }) => tag === "0005_keen_lord_tyger",
);

if (tenantSharingMigrationIndex === -1) {
	throw new Error(
		"Migration journal is missing the tenant-sharing migration: 0001_massive_doctor_doom.",
	);
}

if (organizationFoundationMigrationIndex === -1) {
	throw new Error(
		"Migration journal is missing the organization foundation migration: 0005_keen_lord_tyger.",
	);
}

const applicationTableMigrationIndexes: Partial<
	Record<ApplicationTable, number>
> = {
	device_access_grant: tenantSharingMigrationIndex,
	flow_access_grant: tenantSharingMigrationIndex,
	flow_trigger_secret: tenantSharingMigrationIndex,
	tenant: tenantSharingMigrationIndex,
	tenant_invitation: tenantSharingMigrationIndex,
	tenant_member: tenantSharingMigrationIndex,
	tenant_member_provenance: organizationFoundationMigrationIndex,
	tenant_permission: organizationFoundationMigrationIndex,
	tenant_role: organizationFoundationMigrationIndex,
	tenant_role_assignment: organizationFoundationMigrationIndex,
	tenant_role_permission: organizationFoundationMigrationIndex,
};

export type MigrationLedgerEntry = {
	createdAt: number;
	hash: string;
};

const expectedMigrationLedgerEntries: readonly MigrationLedgerEntry[] =
	migrationJournal.entries.map(({ tag, when }) => ({
		createdAt: when,
		hash: createHash("sha256")
			.update(
				readFileSync(new URL(`../src/migrations/${tag}.sql`, import.meta.url)),
			)
			.digest("hex"),
	}));

export type MigrationDatabaseState = "empty" | "migrated" | "inconsistent";

export function requiredApplicationTablesForAppliedMigrations(
	appliedMigrationCount: number,
): readonly ApplicationTable[] {
	return applicationTables.filter(
		(table) =>
			appliedMigrationCount > (applicationTableMigrationIndexes[table] ?? 0),
	);
}

export function isKnownMigrationLedgerPrefix(
	appliedMigrationEntries: readonly MigrationLedgerEntry[],
	migrationEntries = expectedMigrationLedgerEntries,
): boolean {
	return (
		appliedMigrationEntries.length > 0 &&
		appliedMigrationEntries.length <= migrationEntries.length &&
		appliedMigrationEntries.every(
			(entry, index) =>
				entry.createdAt === migrationEntries[index]?.createdAt &&
				entry.hash === migrationEntries[index]?.hash,
		)
	);
}

export function classifyMigrationDatabase({
	hasApplicationTables,
	hasMigrationLedgerRows,
	hasKnownMigrationLedgerPrefix,
	missingRequiredApplicationTables,
}: {
	hasApplicationTables: boolean;
	hasMigrationLedgerRows: boolean;
	hasKnownMigrationLedgerPrefix: boolean;
	missingRequiredApplicationTables: readonly string[];
}): MigrationDatabaseState {
	if (!hasApplicationTables && !hasMigrationLedgerRows) {
		return "empty";
	}

	if (
		hasApplicationTables &&
		hasKnownMigrationLedgerPrefix &&
		missingRequiredApplicationTables.length === 0
	) {
		return "migrated";
	}

	return "inconsistent";
}

function recoveryError({
	hasApplicationTables,
	hasMigrationLedger,
	hasMigrationLedgerRows,
	hasKnownMigrationLedgerPrefix,
	missingApplicationTables,
	missingRequiredApplicationTables,
}: {
	hasApplicationTables: boolean;
	hasMigrationLedger: boolean;
	hasMigrationLedgerRows: boolean;
	hasKnownMigrationLedgerPrefix: boolean;
	missingApplicationTables: readonly string[];
	missingRequiredApplicationTables: readonly string[];
}): string {
	if (
		hasKnownMigrationLedgerPrefix &&
		missingRequiredApplicationTables.length > 0
	) {
		return [
			"Migration preflight refused to run: the Drizzle migration ledger records migrations whose required application tables are missing.",
			`Missing required tables: ${missingRequiredApplicationTables.join(", ")}.`,
			"This database may have been partially restored or its migration ledger may not match its schema.",
			"Recover it using the approved recovery procedure before rerunning db:migrate.",
		].join("\n");
	}

	if (hasApplicationTables && !hasMigrationLedgerRows) {
		const ledgerState = hasMigrationLedger ? "empty" : "missing";

		return [
			`Migration preflight refused to run: application tables exist, but the Drizzle migration ledger is ${ledgerState}.`,
			"Running migrations now could reapply historical migrations to an existing database.",
			"Recover the migration ledger using the approved recovery procedure, then rerun db:migrate.",
		].join("\n");
	}

	if (hasApplicationTables && !hasKnownMigrationLedgerPrefix) {
		return [
			"Migration preflight refused to run: the Drizzle migration ledger does not match a known ordered prefix from the checked-in migration journal.",
			...(missingApplicationTables.length > 0
				? [`Missing required tables: ${missingApplicationTables.join(", ")}.`]
				: []),
			"This database may have been partially restored or use an incompatible migration lineage.",
			"Recover it using the approved recovery procedure before rerunning db:migrate.",
		].join("\n");
	}

	return [
		"Migration preflight refused to run: the Drizzle migration ledger has entries, but no known application tables exist.",
		"This database may have been partially reset or pointed at the wrong DATABASE_URL.",
		"Verify the database and recover it using the approved recovery procedure before rerunning db:migrate.",
	].join("\n");
}

async function inspectDatabase(databaseUrl: string) {
	const client = new Client({ connectionString: databaseUrl });
	await client.connect();

	try {
		const { rows: tableRows } = await client.query<{ table_name: string }>(
			`select table_name
			 from information_schema.tables
			 where table_schema = 'public'
				and table_name = any($1::text[])`,
			[applicationTables],
		);
		const { rows: ledgerRows } = await client.query<{ exists: boolean }>(
			`select exists (
				select 1
				from information_schema.tables
				where table_schema = 'drizzle'
					and table_name = '__drizzle_migrations'
			)`,
		);
		const hasMigrationLedger = ledgerRows[0]?.exists ?? false;
		let appliedMigrationEntries: MigrationLedgerEntry[] = [];

		if (hasMigrationLedger) {
			const { rows } = await client.query<{
				created_at: string | number;
				hash: string;
			}>(
				"select hash, created_at from drizzle.__drizzle_migrations order by id",
			);
			appliedMigrationEntries = rows.map((row) => ({
				createdAt: Number(row.created_at),
				hash: row.hash,
			}));
		}
		const hasMigrationLedgerRows = appliedMigrationEntries.length > 0;
		const hasKnownMigrationLedgerPrefix = isKnownMigrationLedgerPrefix(
			appliedMigrationEntries,
		);

		const foundApplicationTables = new Set(
			tableRows.map((row) => row.table_name),
		);
		const missingApplicationTables = applicationTables.filter(
			(table) => !foundApplicationTables.has(table),
		);
		const requiredApplicationTables = hasKnownMigrationLedgerPrefix
			? requiredApplicationTablesForAppliedMigrations(
					appliedMigrationEntries.length,
				)
			: [];
		const missingRequiredApplicationTables = requiredApplicationTables.filter(
			(table) => !foundApplicationTables.has(table),
		);

		return {
			hasApplicationTables: foundApplicationTables.size > 0,
			hasMigrationLedger,
			hasMigrationLedgerRows,
			hasKnownMigrationLedgerPrefix,
			missingApplicationTables,
			missingRequiredApplicationTables,
		};
	} finally {
		await client.end();
	}
}

export function redactDatabaseCredentials(
	output: string,
	databaseUrl: string,
): string {
	return output
		.replaceAll(databaseUrl, "DATABASE_URL=<redacted>")
		.replace(/postgres(?:ql)?:\/\/\S+/giu, "DATABASE_URL=<redacted>");
}

export function formatDrizzleKitFailure({
	exitCode,
	stdout,
	stderr,
	databaseUrl,
}: {
	exitCode: number;
	stdout: string;
	stderr: string;
	databaseUrl: string;
}): string {
	return [
		`drizzle-kit migrate failed with exit code ${exitCode}.`,
		"Captured stdout:",
		redactDatabaseCredentials(stdout, databaseUrl) || "(no output)",
		"Captured stderr:",
		redactDatabaseCredentials(stderr, databaseUrl) || "(no output)",
	].join("\n");
}

async function runDrizzleKit(databaseUrl: string): Promise<void> {
	const child = Bun.spawn(["drizzle-kit", "migrate"], {
		stdin: "inherit",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);

	if (exitCode !== 0) {
		throw new Error(
			formatDrizzleKitFailure({ exitCode, stdout, stderr, databaseUrl }),
		);
	}

	process.stdout.write(stdout);
	process.stderr.write(stderr);
}

async function main() {
	dotenv.config({ path: "../../apps/server/.env" });

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error(
			"DATABASE_URL is required. Set it in the environment or apps/server/.env.",
		);
	}

	const inspection = await inspectDatabase(databaseUrl);
	const state = classifyMigrationDatabase(inspection);

	if (state === "inconsistent") {
		throw new Error(recoveryError(inspection));
	}

	await runDrizzleKit(databaseUrl);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
