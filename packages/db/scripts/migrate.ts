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
	"device_provider_secret",
	"device_sync_run",
	"flow",
	"flow_execution_event",
	"flow_execution_log",
	"flow_node_secret",
	"flow_session",
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
	"user",
	"user_invitation",
	"user_role_assignment",
	"verification",
	"webhook_delivery",
	"webhook_endpoint",
] as const;

export type MigrationDatabaseState = "empty" | "migrated" | "inconsistent";

export function classifyMigrationDatabase({
	hasApplicationTables,
	hasCompleteApplicationSchema,
	hasMigrationLedgerRows,
}: {
	hasApplicationTables: boolean;
	hasCompleteApplicationSchema: boolean;
	hasMigrationLedgerRows: boolean;
}): MigrationDatabaseState {
	if (!hasApplicationTables && !hasMigrationLedgerRows) {
		return "empty";
	}

	if (hasCompleteApplicationSchema && hasMigrationLedgerRows) {
		return "migrated";
	}

	return "inconsistent";
}

function recoveryError({
	hasApplicationTables,
	hasMigrationLedger,
	hasMigrationLedgerRows,
	missingApplicationTables,
}: {
	hasApplicationTables: boolean;
	hasMigrationLedger: boolean;
	hasMigrationLedgerRows: boolean;
	missingApplicationTables: readonly string[];
}): string {
	if (hasApplicationTables && !hasMigrationLedgerRows) {
		const ledgerState = hasMigrationLedger ? "empty" : "missing";

		return [
			`Migration preflight refused to run: application tables exist, but the Drizzle migration ledger is ${ledgerState}.`,
			"Running migrations now could reapply historical migrations to an existing database.",
			"Recover the migration ledger using the approved recovery procedure, then rerun db:migrate.",
		].join("\n");
	}

	if (hasApplicationTables) {
		return [
			"Migration preflight refused to run: the Drizzle migration ledger has entries, but the application schema is incomplete.",
			`Missing required tables: ${missingApplicationTables.join(", ")}.`,
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
		let hasMigrationLedgerRows = false;

		if (hasMigrationLedger) {
			const { rows } = await client.query<{ exists: boolean }>(
				"select exists (select 1 from drizzle.__drizzle_migrations)",
			);
			hasMigrationLedgerRows = rows[0]?.exists ?? false;
		}

		const foundApplicationTables = new Set(
			tableRows.map((row) => row.table_name),
		);
		const missingApplicationTables = applicationTables.filter(
			(table) => !foundApplicationTables.has(table),
		);

		return {
			hasApplicationTables: foundApplicationTables.size > 0,
			hasCompleteApplicationSchema: missingApplicationTables.length === 0,
			hasMigrationLedger,
			hasMigrationLedgerRows,
			missingApplicationTables,
		};
	} finally {
		await client.end();
	}
}

async function runDrizzleKit(): Promise<never> {
	const child = Bun.spawn(["drizzle-kit", "migrate"], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	process.exit(await child.exited);
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

	await runDrizzleKit();
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
