import { TRPCError } from "@trpc/server";
import { contact } from "@whatsapp-flow/db/schema/contact";
import { device } from "@whatsapp-flow/db/schema/device";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
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
			const jid = `${number}@s.whatsapp.net`;
			const [row] = await ctx.db
				.insert(contact)
				.values({
					id: crypto.randomUUID(),
					deviceId: input.deviceId,
					jid,
					phoneNumber: number,
					name: input.name ?? null,
					source: "manual",
				})
				.onConflictDoUpdate({
					target: [contact.deviceId, contact.jid],
					set: {
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
				updates.jid = `${updates.phoneNumber}@s.whatsapp.net`;
			}
			if (input.isBlocked !== undefined) updates.isBlocked = input.isBlocked;

			const [updated] = await ctx.db
				.update(contact)
				.set(updates)
				.where(eq(contact.id, input.id))
				.returning();
			return updated;
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
