import { db as defaultDb } from "@whatsapp-flow/db";
import {
	channel,
	contact as contactTable,
} from "@whatsapp-flow/db/schema/contact";
import { device } from "@whatsapp-flow/db/schema/device";
import { deviceSyncRun } from "@whatsapp-flow/db/schema/sync";
import {
	connectionManager,
	type SyncedContact,
	type SyncedGroup,
	type SyncedNewsletter,
} from "@whatsapp-flow/whatsapp";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { logger } from "../observability/logger";
import { enqueueJob, type JobRecord } from "./job-queue";
import {
	type DeviceResourceSyncJobPayload,
	deviceResourceSyncJobIdempotencyKey,
} from "./job-types";

export type DeviceSyncResource = "contacts" | "groups" | "newsletters";
export type DeviceSyncMode = "normal" | "repair";

type SyncDatabase = typeof defaultDb;
type SyncCounts = {
	processed: number;
	created: number;
	updated: number;
	skipped: number;
	failed: number;
};

export type DeviceResourceSyncPersistence = {
	persistContacts(input: {
		deviceId: string;
		contacts: SyncedContact[];
	}): Promise<SyncCounts>;
	persistGroups(input: {
		deviceId: string;
		groups: SyncedGroup[];
		authoritative?: boolean;
		reconcileParticipants?: boolean;
	}): Promise<SyncCounts>;
	persistNewsletters(input: {
		deviceId: string;
		newsletters: SyncedNewsletter[];
	}): Promise<SyncCounts>;
};

export async function startDeviceResourceSync(input: {
	deviceId: string;
	requestedByUserId: string;
	resource: DeviceSyncResource | "all";
	scopeKey?: string;
	mode?: DeviceSyncMode;
	db?: SyncDatabase;
}) {
	const database = input.db ?? defaultDb;
	const resources: DeviceSyncResource[] =
		input.resource === "all"
			? ["contacts", "groups", "newsletters"]
			: [input.resource];
	const requestId = crypto.randomUUID();
	const scopeKey = input.scopeKey ?? "all";
	const mode = input.mode ?? "normal";

	return database.transaction(async (tx) => {
		const runs: (typeof deviceSyncRun.$inferSelect)[] = [];
		for (const resource of resources) {
			const [inserted] = await tx
				.insert(deviceSyncRun)
				.values({
					id: crypto.randomUUID(),
					requestId,
					deviceId: input.deviceId,
					requestedByUserId: input.requestedByUserId,
					resource,
					scopeKey,
					mode,
				})
				.onConflictDoNothing()
				.returning();

			if (!inserted) {
				const [active] = await tx
					.select()
					.from(deviceSyncRun)
					.where(
						and(
							eq(deviceSyncRun.deviceId, input.deviceId),
							eq(deviceSyncRun.resource, resource),
							eq(deviceSyncRun.scopeKey, scopeKey),
							inArray(deviceSyncRun.status, ["queued", "running"]),
						),
					)
					.limit(1);
				if (!active)
					throw new Error("Active sync conflict could not be resolved");
				runs.push(active);
				continue;
			}

			const job = await enqueueJob(
				{
					kind: "device.resource_sync",
					payload: { syncRunId: inserted.id },
					idempotencyKey: deviceResourceSyncJobIdempotencyKey(inserted.id),
					maxAttempts: 5,
				},
				tx,
			);
			const [run] = await tx
				.update(deviceSyncRun)
				.set({ jobId: job.id, updatedAt: new Date() })
				.where(eq(deviceSyncRun.id, inserted.id))
				.returning();
			if (!run) throw new Error("Sync run disappeared while enqueueing");
			runs.push(run);
		}
		return { requestId, runs };
	});
}

export async function listDeviceResourceSyncRuns(input: {
	deviceId: string;
	limit?: number;
	db?: SyncDatabase;
}) {
	return (input.db ?? defaultDb)
		.select()
		.from(deviceSyncRun)
		.where(eq(deviceSyncRun.deviceId, input.deviceId))
		.orderBy(desc(deviceSyncRun.createdAt))
		.limit(input.limit ?? 30);
}

async function loadKnownContacts(
	run: typeof deviceSyncRun.$inferSelect,
	database: SyncDatabase,
): Promise<SyncedContact[]> {
	const conditions = [eq(contactTable.deviceId, run.deviceId)];
	if (run.scopeKey !== "all") {
		conditions.push(eq(contactTable.identityKey, run.scopeKey));
	}
	const rows = await database
		.select({
			jid: contactTable.jid,
			phoneNumber: contactTable.phoneNumber,
			lid: contactTable.lid,
			identityKey: contactTable.identityKey,
			name: contactTable.name,
			pushName: contactTable.pushName,
			isWaContact: contactTable.isWaContact,
			avatarUrl: contactTable.avatarUrl,
		})
		.from(contactTable)
		.where(and(...conditions));
	return rows.map((row) => ({
		...row,
		phoneNumber: row.phoneNumber ?? undefined,
		lid: row.lid ?? undefined,
		name: row.name ?? undefined,
		pushName: row.pushName ?? undefined,
		avatarUrl: row.avatarUrl ?? undefined,
	}));
}

async function loadKnownNewsletterJids(
	run: typeof deviceSyncRun.$inferSelect,
	database: SyncDatabase,
) {
	const conditions = [eq(channel.deviceId, run.deviceId)];
	if (run.scopeKey !== "all") conditions.push(eq(channel.jid, run.scopeKey));
	return database
		.select({ jid: channel.jid })
		.from(channel)
		.where(and(...conditions));
}

async function syncContacts(
	run: typeof deviceSyncRun.$inferSelect,
	database: SyncDatabase,
	persistence: DeviceResourceSyncPersistence,
) {
	if (run.mode === "repair") {
		await connectionManager.repairContactAppState(run.deviceId);
	}
	const contacts = await loadKnownContacts(run, database);
	const refreshed: SyncedContact[] = [];
	let failed = 0;
	for (let index = 0; index < contacts.length; index += 10) {
		const batch = contacts.slice(index, index + 10);
		const results = await Promise.allSettled(
			batch.map((contact) =>
				connectionManager.refreshContact(run.deviceId, {
					...contact,
					phoneNumber: contact.phoneNumber ?? undefined,
					lid: contact.lid ?? undefined,
					name: contact.name ?? undefined,
					pushName: contact.pushName ?? undefined,
					avatarUrl: contact.avatarUrl ?? undefined,
				}),
			),
		);
		for (const result of results) {
			if (result.status === "fulfilled") refreshed.push(result.value);
			else failed += 1;
		}
	}
	const counts = await persistence.persistContacts({
		deviceId: run.deviceId,
		contacts: refreshed,
	});
	return {
		discovered: contacts.length,
		...counts,
		failed: counts.failed + failed,
	};
}

async function syncGroups(
	run: typeof deviceSyncRun.$inferSelect,
	persistence: DeviceResourceSyncPersistence,
) {
	const groups = await connectionManager.fetchGroups(
		run.deviceId,
		run.scopeKey === "all" ? undefined : run.scopeKey,
	);
	const counts = await persistence.persistGroups({
		deviceId: run.deviceId,
		groups,
		authoritative: run.scopeKey === "all",
		reconcileParticipants: true,
	});
	return { discovered: groups.length, ...counts };
}

async function syncNewsletters(
	run: typeof deviceSyncRun.$inferSelect,
	database: SyncDatabase,
	persistence: DeviceResourceSyncPersistence,
) {
	const known = await loadKnownNewsletterJids(run, database);
	const newsletters: SyncedNewsletter[] = [];
	let failed = 0;
	for (let index = 0; index < known.length; index += 10) {
		const batch = known.slice(index, index + 10);
		const results = await Promise.allSettled(
			batch.map(({ jid }) =>
				connectionManager.fetchNewsletter(run.deviceId, jid),
			),
		);
		for (const result of results) {
			if (result.status === "fulfilled" && result.value) {
				newsletters.push(result.value);
			} else {
				failed += 1;
			}
		}
	}
	const counts = await persistence.persistNewsletters({
		deviceId: run.deviceId,
		newsletters,
	});
	return {
		discovered: known.length,
		...counts,
		failed: counts.failed + failed,
	};
}

export async function processDeviceResourceSyncJob(
	job: JobRecord & {
		kind: "device.resource_sync";
		payload: DeviceResourceSyncJobPayload;
	},
	persistence: DeviceResourceSyncPersistence,
	database: SyncDatabase = defaultDb,
) {
	const [run] = await database
		.select()
		.from(deviceSyncRun)
		.where(eq(deviceSyncRun.id, job.payload.syncRunId))
		.limit(1);
	if (!run || run.jobId !== job.id) return;
	if (["succeeded", "partial", "failed", "cancelled"].includes(run.status))
		return;

	const [owned] = await database
		.update(deviceSyncRun)
		.set({
			status: "running",
			claimAttempt: job.attempts,
			startedAt: run.startedAt ?? new Date(),
			completedAt: null,
			lastError: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(deviceSyncRun.id, run.id),
				eq(deviceSyncRun.jobId, job.id),
				inArray(deviceSyncRun.status, ["queued", "running"]),
				or(
					isNull(deviceSyncRun.claimAttempt),
					lt(deviceSyncRun.claimAttempt, job.attempts),
				),
			),
		)
		.returning();
	if (!owned) return;

	try {
		const [ownedDevice] = await database
			.select({ provider: device.provider })
			.from(device)
			.where(eq(device.id, run.deviceId))
			.limit(1);
		if (ownedDevice?.provider !== "baileys") {
			throw new Error("Resource sync currently supports Baileys devices only");
		}

		const counts =
			run.resource === "contacts"
				? await syncContacts(run, database, persistence)
				: run.resource === "groups"
					? await syncGroups(run, persistence)
					: await syncNewsletters(run, database, persistence);
		const status = counts.failed > 0 ? "partial" : "succeeded";
		const completed = await database
			.update(deviceSyncRun)
			.set({
				status,
				progress: 100,
				discoveredCount: counts.discovered,
				processedCount: counts.processed,
				createdCount: counts.created,
				updatedCount: counts.updated,
				skippedCount: counts.skipped,
				failedCount: counts.failed,
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(deviceSyncRun.id, run.id),
					eq(deviceSyncRun.jobId, job.id),
					eq(deviceSyncRun.claimAttempt, job.attempts),
				),
			)
			.returning({ id: deviceSyncRun.id });
		if (completed.length === 0) return;
		logger.info("device.resource_sync.completed", {
			syncRunId: run.id,
			deviceId: run.deviceId,
			resource: run.resource,
			status,
			...counts,
		});
	} catch (error) {
		const terminal = job.attempts >= job.maxAttempts;
		await database
			.update(deviceSyncRun)
			.set({
				status: terminal ? "failed" : "queued",
				lastError: error instanceof Error ? error.message : "Sync failed",
				completedAt: terminal ? new Date() : null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(deviceSyncRun.id, run.id),
					eq(deviceSyncRun.jobId, job.id),
					eq(deviceSyncRun.claimAttempt, job.attempts),
				),
			);
		throw error;
	}
}
