import { db } from "@whatsapp-flow/db";
import {
	channel,
	chatGroup,
	contact as contactTable,
	groupParticipant,
} from "@whatsapp-flow/db/schema/contact";
import type {
	SyncedContact,
	SyncedGroup,
	SyncedNewsletter,
} from "@whatsapp-flow/whatsapp";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import {
	buildPrivateContactIdentity,
	mergePrivateThreadsForContact,
	upsertPrivateContact,
} from "./whatsapp-identity";

export type SyncPersistenceResult = {
	processed: number;
	created: number;
	updated: number;
	skipped: number;
	failed: number;
};

function emptyResult(): SyncPersistenceResult {
	return { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
}

export async function persistSyncedContacts(input: {
	deviceId: string;
	contacts: SyncedContact[];
}) {
	const result = emptyResult();
	const now = new Date();
	for (const item of input.contacts) {
		try {
			const identity = buildPrivateContactIdentity({
				jid: item.jid,
				number: item.phoneNumber,
				lid: item.lid,
				identityKey: item.identityKey,
			});
			const [existing] = await db
				.select({ id: contactTable.id })
				.from(contactTable)
				.where(
					and(
						eq(contactTable.deviceId, input.deviceId),
						eq(contactTable.identityKey, identity.identityKey),
					),
				)
				.limit(1);
			const savedContact = await upsertPrivateContact(db, {
				deviceId: input.deviceId,
				jid: item.jid,
				number: item.phoneNumber,
				lid: item.lid,
				identityKey: item.identityKey,
				name: item.name,
				pushName: item.pushName,
				isWaContact: item.isWaContact,
				avatarUrl: item.avatarUrl,
				source: "sync",
			});
			if (!savedContact) {
				result.skipped += 1;
				continue;
			}
			await mergePrivateThreadsForContact(db, {
				deviceId: input.deviceId,
				contactId: savedContact.id,
				identityKey: savedContact.identityKey,
				jid: savedContact.jid,
				phoneNumber: savedContact.phoneNumber,
				lid: savedContact.lid,
				name: savedContact.name,
				now,
			});
			result.processed += 1;
			if (existing) result.updated += 1;
			else result.created += 1;
		} catch {
			result.failed += 1;
		}
	}
	return result;
}

export async function persistSyncedGroups(input: {
	deviceId: string;
	groups: SyncedGroup[];
	authoritative?: boolean;
	reconcileParticipants?: boolean;
}) {
	const result = emptyResult();
	const now = new Date();
	const jids = [...new Set(input.groups.map((item) => item.jid))];
	const existingRows =
		jids.length > 0
			? await db
					.select({ jid: chatGroup.jid })
					.from(chatGroup)
					.where(
						and(
							eq(chatGroup.deviceId, input.deviceId),
							inArray(chatGroup.jid, jids),
						),
					)
			: [];
	const existingJids = new Set(existingRows.map((row) => row.jid));

	for (const item of input.groups) {
		try {
			const [savedGroup] = await db
				.insert(chatGroup)
				.values({
					id: crypto.randomUUID(),
					deviceId: input.deviceId,
					jid: item.jid,
					subject: item.subject,
					description: item.description ?? null,
					ownerJid: item.ownerJid ?? null,
					participantCount: item.participantCount ?? 0,
					isMember: item.isMember ?? true,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [chatGroup.deviceId, chatGroup.jid],
					set: {
						subject: item.subject === item.jid ? undefined : item.subject,
						description: item.description ?? undefined,
						ownerJid: item.ownerJid ?? undefined,
						participantCount: item.participantCount,
						isMember: item.isMember ?? true,
						updatedAt: now,
					},
				})
				.returning({ id: chatGroup.id });
			if (!savedGroup) {
				result.skipped += 1;
				continue;
			}
			const participantJids = await upsertGroupParticipantsFromRaw(
				savedGroup.id,
				item.raw,
				now,
			);
			if (input.reconcileParticipants && participantJids) {
				const staleParticipants =
					participantJids.length > 0
						? and(
								eq(groupParticipant.groupId, savedGroup.id),
								notInArray(groupParticipant.jid, participantJids),
							)
						: eq(groupParticipant.groupId, savedGroup.id);
				await db.delete(groupParticipant).where(staleParticipants);
			}
			result.processed += 1;
			if (existingJids.has(item.jid)) result.updated += 1;
			else result.created += 1;
		} catch {
			result.failed += 1;
		}
	}
	if (input.authoritative) {
		await db
			.update(chatGroup)
			.set({ isMember: false, updatedAt: now })
			.where(
				and(
					eq(chatGroup.deviceId, input.deviceId),
					jids.length > 0 ? notInArray(chatGroup.jid, jids) : undefined,
				),
			);
	}
	return result;
}

export async function persistSyncedNewsletters(input: {
	deviceId: string;
	newsletters: SyncedNewsletter[];
}) {
	const result = emptyResult();
	const now = new Date();
	const jids = [...new Set(input.newsletters.map((item) => item.jid))];
	const existingRows =
		jids.length > 0
			? await db
					.select({ jid: channel.jid })
					.from(channel)
					.where(
						and(
							eq(channel.deviceId, input.deviceId),
							inArray(channel.jid, jids),
						),
					)
			: [];
	const existingJids = new Set(existingRows.map((row) => row.jid));

	for (const item of input.newsletters) {
		try {
			await db
				.insert(channel)
				.values({
					id: crypto.randomUUID(),
					deviceId: input.deviceId,
					jid: item.jid,
					name: item.name,
					description: item.description ?? null,
					ownerJid: item.ownerJid ?? null,
					subscribersCount: item.subscribersCount ?? 0,
					isSubscribed: item.isSubscribed ?? true,
					verificationStatus: item.verificationStatus ?? null,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [channel.deviceId, channel.jid],
					set: {
						name: item.name,
						description: item.description ?? null,
						ownerJid: item.ownerJid ?? null,
						subscribersCount: item.subscribersCount ?? 0,
						isSubscribed: item.isSubscribed ?? true,
						verificationStatus: item.verificationStatus ?? null,
						updatedAt: now,
					},
				});
			result.processed += 1;
			if (existingJids.has(item.jid)) result.updated += 1;
			else result.created += 1;
		} catch {
			result.failed += 1;
		}
	}
	return result;
}

export async function upsertGroupParticipantSender(
	groupId: string,
	jid: string | null | undefined,
	now: Date,
) {
	if (!jid) return;
	await db
		.insert(groupParticipant)
		.values({
			id: crypto.randomUUID(),
			groupId,
			jid,
			role: "member",
		})
		.onConflictDoUpdate({
			target: [groupParticipant.groupId, groupParticipant.jid],
			set: { updatedAt: now },
		});
}

export async function upsertGroupParticipantsFromRaw(
	groupId: string,
	raw: unknown,
	now: Date,
) {
	if (!raw || typeof raw !== "object") return null;
	const participants = (raw as Record<string, unknown>).participants;
	if (!Array.isArray(participants)) return null;

	const participantJids: string[] = [];
	for (const participant of participants) {
		if (!participant || typeof participant !== "object") continue;
		const record = participant as Record<string, unknown>;
		const jid =
			typeof record.id === "string"
				? record.id
				: typeof record.jid === "string"
					? record.jid
					: undefined;
		if (!jid) continue;
		participantJids.push(jid);
		const admin = typeof record.admin === "string" ? record.admin : undefined;
		const role =
			admin === "superadmin"
				? "superadmin"
				: admin === "admin"
					? "admin"
					: "member";
		await db
			.insert(groupParticipant)
			.values({
				id: crypto.randomUUID(),
				groupId,
				jid,
				role,
			})
			.onConflictDoUpdate({
				target: [groupParticipant.groupId, groupParticipant.jid],
				set: { role, updatedAt: now },
			});
	}
	return participantJids;
}
