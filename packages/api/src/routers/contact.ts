import { TRPCError } from "@trpc/server";
import { contact } from "@whatsapp-flow/db/schema/contact";
import { device } from "@whatsapp-flow/db/schema/device";
import { inboxThread } from "@whatsapp-flow/db/schema/inbox";
import {
	connectionManager,
	derivePrivateIdentityKey,
	deriveThreadKey,
	toPhoneJid,
} from "@whatsapp-flow/whatsapp";
import { and, desc, eq, ilike, isNull, like, or } from "drizzle-orm";
import { z } from "zod";
import { startDeviceResourceSync } from "../engine/device-resource-sync";
import { protectedProcedure, router } from "../index";

function normalizeNumber(value: string) {
	return value.replace(/[^\d]/g, "");
}

async function requireDeviceOwnership(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	deviceId: string,
	userId: string,
) {
	const rows = await db
		.select({ id: device.id })
		.from(device)
		.where(and(eq(device.id, deviceId), eq(device.userId, userId)))
		.limit(1);
	if (!rows[0]) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
	}
}

export const contactRouter = router({
	list: protectedProcedure
		.input(
			z.object({
				deviceId: z.string().optional(),
				search: z.string().optional(),
				limit: z.number().min(1).max(100).default(50),
			}),
		)
		.query(async ({ ctx, input }) => {
			const conditions = [eq(device.userId, ctx.session.user.id)];
			if (input.deviceId) conditions.push(eq(contact.deviceId, input.deviceId));
			if (input.search?.trim()) {
				const q = `%${input.search.trim()}%`;
				const searchClause = or(
					ilike(contact.name, q),
					ilike(contact.pushName, q),
					ilike(contact.phoneNumber, q),
					ilike(contact.jid, q),
				);
				if (searchClause) conditions.push(searchClause);
			}

			return ctx.db
				.select({
					id: contact.id,
					deviceId: contact.deviceId,
					jid: contact.jid,
					phoneNumber: contact.phoneNumber,
					lid: contact.lid,
					name: contact.name,
					pushName: contact.pushName,
					isWaContact: contact.isWaContact,
					isBlocked: contact.isBlocked,
					source: contact.source,
					avatarUrl: contact.avatarUrl,
					updatedAt: contact.updatedAt,
				})
				.from(contact)
				.innerJoin(device, eq(contact.deviceId, device.id))
				.where(and(...conditions))
				.orderBy(desc(contact.updatedAt))
				.limit(input.limit);
		}),

	create: protectedProcedure
		.input(
			z.object({
				deviceId: z.string().min(1),
				phoneNumber: z.string().min(3),
				name: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await requireDeviceOwnership(ctx.db, input.deviceId, ctx.session.user.id);
			const number = normalizeNumber(input.phoneNumber);
			const jid = toPhoneJid(number);
			const identityKey = derivePrivateIdentityKey({ jid, number });
			const [row] = await ctx.db
				.insert(contact)
				.values({
					id: crypto.randomUUID(),
					deviceId: input.deviceId,
					jid,
					identityKey,
					phoneNumber: number,
					name: input.name ?? null,
					source: "manual",
				})
				.onConflictDoUpdate({
					target: [contact.deviceId, contact.identityKey],
					set: {
						jid,
						phoneNumber: number,
						name: input.name ?? null,
						source: "manual",
						updatedAt: new Date(),
					},
				})
				.returning();
			return row;
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().nullable().optional(),
				phoneNumber: z.string().optional(),
				isBlocked: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const rows = await ctx.db
				.select({ id: contact.id })
				.from(contact)
				.innerJoin(device, eq(contact.deviceId, device.id))
				.where(
					and(eq(contact.id, input.id), eq(device.userId, ctx.session.user.id)),
				)
				.limit(1);
			if (!rows[0])
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Contact not found",
				});

			const updates: Partial<typeof contact.$inferInsert> = {
				updatedAt: new Date(),
			};
			if (input.name !== undefined) updates.name = input.name;
			if (input.phoneNumber !== undefined) {
				updates.phoneNumber = normalizeNumber(input.phoneNumber);
				updates.jid = toPhoneJid(updates.phoneNumber);
				updates.identityKey = derivePrivateIdentityKey({
					jid: updates.jid,
					number: updates.phoneNumber,
				});
			}
			if (input.isBlocked !== undefined) updates.isBlocked = input.isBlocked;

			const [updated] = await ctx.db
				.update(contact)
				.set(updates)
				.where(eq(contact.id, input.id))
				.returning();
			return updated;
		}),

	dedupLidContacts: protectedProcedure
		.input(z.object({ deviceId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireDeviceOwnership(ctx.db, input.deviceId, ctx.session.user.id);

			const connection = connectionManager.getConnection(input.deviceId);
			if (!connection?.socket) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Baileys device must be connected to resolve LID contacts",
				});
			}

			const lidRows = await ctx.db
				.select({
					id: contact.id,
					jid: contact.jid,
					lid: contact.lid,
				})
				.from(contact)
				.where(
					and(
						eq(contact.deviceId, input.deviceId),
						like(contact.jid, "%@lid"),
						isNull(contact.phoneNumber),
					),
				);

			const lidJids = [
				...new Set(
					lidRows
						.map((row) => row.lid ?? row.jid)
						.filter((jid) => jid.endsWith("@lid")),
				),
			];
			const mappings = lidJids.length
				? await connection.socket.signalRepository.lidMapping.getPNsForLIDs(
						lidJids,
					)
				: null;
			const pnByLid = new Map(
				(mappings ?? []).map((mapping) => [
					mapping.lid,
					toPhoneJid(mapping.pn),
				]),
			);

			let resolved = 0;
			let merged = 0;
			let updated = 0;
			const now = new Date();

			for (const row of lidRows) {
				const lid = row.lid ?? row.jid;
				const pnJid = pnByLid.get(lid);
				if (!pnJid) continue;

				resolved += 1;
				const phoneNumber = normalizeNumber(pnJid);
				const identityKey = derivePrivateIdentityKey({
					jid: pnJid,
					number: phoneNumber,
				});
				const threadKey = deriveThreadKey({
					chatType: "private",
					chatJid: pnJid,
					contactIdentityKey: identityKey,
				});
				const [existing] = await ctx.db
					.select({ id: contact.id })
					.from(contact)
					.where(
						and(
							eq(contact.deviceId, input.deviceId),
							or(
								eq(contact.identityKey, identityKey),
								eq(contact.jid, pnJid),
								eq(contact.phoneNumber, phoneNumber),
							),
						),
					)
					.limit(1);

				if (existing && existing.id !== row.id) {
					await ctx.db
						.update(inboxThread)
						.set({
							contactId: existing.id,
							threadKey,
							chatJid: pnJid,
							contactNumber: phoneNumber,
							updatedAt: now,
						})
						.where(eq(inboxThread.contactId, row.id));
					await ctx.db.delete(contact).where(eq(contact.id, row.id));
					merged += 1;
					continue;
				}

				await ctx.db
					.update(contact)
					.set({
						jid: pnJid,
						identityKey,
						phoneNumber,
						lid,
						updatedAt: now,
					})
					.where(eq(contact.id, row.id));
				await ctx.db
					.update(inboxThread)
					.set({
						threadKey,
						chatJid: pnJid,
						contactNumber: phoneNumber,
						updatedAt: now,
					})
					.where(eq(inboxThread.contactId, row.id));
				updated += 1;
			}

			return {
				processed: lidRows.length,
				resolved,
				merged,
				updated,
			};
		}),

	syncOne: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				mode: z.enum(["normal", "repair"]).default("normal"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [owned] = await ctx.db
				.select({
					deviceId: contact.deviceId,
					identityKey: contact.identityKey,
					provider: device.provider,
				})
				.from(contact)
				.innerJoin(device, eq(contact.deviceId, device.id))
				.where(
					and(eq(contact.id, input.id), eq(device.userId, ctx.session.user.id)),
				)
				.limit(1);
			if (!owned) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Contact not found",
				});
			}
			if (
				owned.provider !== "baileys" ||
				connectionManager.getConnection(owned.deviceId)?.status !== "connected"
			) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "A connected Baileys device is required",
				});
			}
			return startDeviceResourceSync({
				deviceId: owned.deviceId,
				requestedByUserId: ctx.session.user.id,
				resource: "contacts",
				scopeKey: owned.identityKey,
				mode: input.mode,
				db: ctx.db,
			});
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const rows = await ctx.db
				.select({ id: contact.id })
				.from(contact)
				.innerJoin(device, eq(contact.deviceId, device.id))
				.where(
					and(eq(contact.id, input.id), eq(device.userId, ctx.session.user.id)),
				)
				.limit(1);
			if (!rows[0])
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Contact not found",
				});
			await ctx.db.delete(contact).where(eq(contact.id, input.id));
			return { success: true };
		}),
});
