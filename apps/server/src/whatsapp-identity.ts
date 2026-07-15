import type { createDb } from "@whatsapp-flow/db";
import { contact as contactTable } from "@whatsapp-flow/db/schema/contact";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import {
	derivePrivateIdentityKey,
	isLidJid,
	normalizeContactNumber,
	toPhoneJid,
} from "@whatsapp-flow/whatsapp";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

type PrivateContactInput = {
	deviceId: string;
	jid: string;
	number?: string | null;
	lid?: string | null;
	username?: string | null;
	identityKey?: string | null;
	name?: string | null;
	pushName?: string | null;
	providerContactId?: string | null;
	avatarUrl?: string | null;
	source: "sync" | "manual" | "message";
	isWaContact?: boolean;
};

type PrivateThreadInput = {
	deviceId: string;
	contactId: string;
	identityKey: string;
	jid: string;
	phoneNumber?: string | null;
	lid?: string | null;
	name?: string | null;
	now: Date;
};

export type PrivateThreadSurvivorCandidate = {
	id: string;
	threadKey: string;
	lastMessageAt: Date;
};

function compact<T>(values: (T | null | undefined | false)[]) {
	return values.filter(Boolean) as T[];
}

function rankContact(row: {
	phoneNumber: string | null;
	lid: string | null;
	updatedAt: Date;
}) {
	return (
		(row.phoneNumber ? 4 : 0) +
		(row.lid ? 2 : 0) +
		row.updatedAt.getTime() / 1_000_000_000_000
	);
}

export function buildPrivateContactIdentity(input: {
	jid: string;
	number?: string | null;
	lid?: string | null;
	identityKey?: string | null;
}) {
	const phoneNumber = normalizeContactNumber(input.number);
	const lid = input.lid ?? (isLidJid(input.jid) ? input.jid : null);
	const identityKey =
		input.identityKey ??
		derivePrivateIdentityKey({ jid: input.jid, number: phoneNumber, lid });

	return { phoneNumber, lid, identityKey };
}

export function buildPrivateThreadAliases(input: {
	jid: string;
	phoneNumber?: string | null;
	lid?: string | null;
}) {
	const phoneNumber = normalizeContactNumber(input.phoneNumber);
	return [
		...new Set(
			compact([
				input.jid,
				phoneNumber ? toPhoneJid(phoneNumber) : null,
				input.lid,
			]),
		),
	];
}

export function choosePrivateThreadSurvivor(
	threads: PrivateThreadSurvivorCandidate[],
	identityKey: string,
) {
	return (
		[...threads].sort((a, b) => {
			if (a.threadKey === identityKey && b.threadKey !== identityKey) return -1;
			if (b.threadKey === identityKey && a.threadKey !== identityKey) return 1;
			return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
		})[0] ?? null
	);
}

export async function upsertPrivateContact(db: Db, input: PrivateContactInput) {
	const identity = buildPrivateContactIdentity(input);
	const candidates = compact([
		eq(contactTable.identityKey, identity.identityKey),
		identity.phoneNumber
			? eq(contactTable.phoneNumber, identity.phoneNumber)
			: null,
		identity.lid ? eq(contactTable.lid, identity.lid) : null,
		eq(contactTable.jid, input.jid),
		input.providerContactId
			? eq(contactTable.providerContactId, input.providerContactId)
			: null,
	]);

	const matches = await db
		.select({
			id: contactTable.id,
			jid: contactTable.jid,
			identityKey: contactTable.identityKey,
			phoneNumber: contactTable.phoneNumber,
			lid: contactTable.lid,
			name: contactTable.name,
			pushName: contactTable.pushName,
			profileName: contactTable.profileName,
			providerContactId: contactTable.providerContactId,
			updatedAt: contactTable.updatedAt,
		})
		.from(contactTable)
		.where(and(eq(contactTable.deviceId, input.deviceId), or(...candidates)))
		.orderBy(desc(contactTable.updatedAt));

	const now = new Date();
	if (matches.length === 0) {
		const [created] = await db
			.insert(contactTable)
			.values({
				id: crypto.randomUUID(),
				deviceId: input.deviceId,
				jid: input.jid,
				identityKey: identity.identityKey,
				phoneNumber: identity.phoneNumber,
				lid: identity.lid,
				name: input.name ?? null,
				pushName: input.pushName ?? input.name ?? null,
				profileName: input.name ?? null,
				providerContactId:
					input.providerContactId ??
					identity.phoneNumber ??
					identity.lid ??
					null,
				isWaContact: input.isWaContact ?? true,
				avatarUrl: input.avatarUrl ?? null,
				source: input.source,
			})
			.returning({
				id: contactTable.id,
				jid: contactTable.jid,
				identityKey: contactTable.identityKey,
				phoneNumber: contactTable.phoneNumber,
				lid: contactTable.lid,
				name: contactTable.name,
			});
		return created;
	}

	const survivor = [...matches].sort(
		(a, b) => rankContact(b) - rankContact(a),
	)[0];
	if (!survivor) return null;
	const duplicates = matches.filter((row) => row.id !== survivor.id);
	if (duplicates.length > 0) {
		const duplicateIds = duplicates.map((row) => row.id);
		await db
			.update(inboxThread)
			.set({ contactId: survivor.id, updatedAt: now })
			.where(inArray(inboxThread.contactId, duplicateIds));
		await db.delete(contactTable).where(inArray(contactTable.id, duplicateIds));
	}

	const [updated] = await db
		.update(contactTable)
		.set({
			jid: input.jid,
			identityKey: identity.identityKey,
			phoneNumber: identity.phoneNumber ?? survivor.phoneNumber,
			lid: identity.lid ?? survivor.lid,
			name: input.name ?? survivor.name,
			pushName: input.pushName ?? input.name ?? survivor.pushName,
			profileName: input.name ?? survivor.profileName,
			providerContactId:
				input.providerContactId ??
				survivor.providerContactId ??
				identity.phoneNumber ??
				identity.lid ??
				null,
			isWaContact: input.isWaContact ?? true,
			avatarUrl: input.avatarUrl ?? undefined,
			updatedAt: now,
		})
		.where(eq(contactTable.id, survivor.id))
		.returning({
			id: contactTable.id,
			jid: contactTable.jid,
			identityKey: contactTable.identityKey,
			phoneNumber: contactTable.phoneNumber,
			lid: contactTable.lid,
			name: contactTable.name,
		});

	return updated;
}

export async function mergePrivateThreadsForContact(
	db: Db,
	input: PrivateThreadInput,
) {
	const aliases = buildPrivateThreadAliases(input);
	const aliasConditions = aliases.map((jid) => eq(inboxThread.chatJid, jid));
	const conditions = compact([
		eq(inboxThread.threadKey, input.identityKey),
		eq(inboxThread.contactId, input.contactId),
		aliasConditions.length > 0 ? or(...aliasConditions) : null,
	]);

	const threads = await db
		.select({
			id: inboxThread.id,
			threadKey: inboxThread.threadKey,
			lastMessageAt: inboxThread.lastMessageAt,
			updatedAt: inboxThread.updatedAt,
		})
		.from(inboxThread)
		.where(
			and(
				eq(inboxThread.deviceId, input.deviceId),
				eq(inboxThread.chatType, "private"),
				or(...conditions),
			),
		);

	if (threads.length === 0) return null;

	const survivor = choosePrivateThreadSurvivor(threads, input.identityKey);
	if (!survivor) return null;
	const duplicateIds = threads
		.filter((thread) => thread.id !== survivor.id)
		.map((thread) => thread.id);

	for (const duplicateId of duplicateIds) {
		await db.delete(inboxMessage).where(
			and(
				eq(inboxMessage.threadId, duplicateId),
				sql`${inboxMessage.providerMessageId} is not null`,
				sql`exists (
						select 1 from ${inboxMessage} kept
						where kept.thread_id = ${survivor.id}
						and kept.provider_message_id = ${inboxMessage.providerMessageId}
					)`,
			),
		);
		await db
			.update(inboxMessage)
			.set({ threadId: survivor.id, updatedAt: input.now })
			.where(eq(inboxMessage.threadId, duplicateId));
		await db.delete(inboxThread).where(eq(inboxThread.id, duplicateId));
	}

	await db
		.update(inboxThread)
		.set({
			threadKey: input.identityKey,
			chatJid: input.jid,
			contactId: input.contactId,
			contactNumber: input.phoneNumber ?? null,
			contactName: input.name ?? null,
			updatedAt: input.now,
		})
		.where(eq(inboxThread.id, survivor.id));

	return survivor.id;
}
