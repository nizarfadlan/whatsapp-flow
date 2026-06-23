import { chatGroup, groupParticipant } from "@whatsapp-flow/db/schema/contact";
import { device } from "@whatsapp-flow/db/schema/device";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

export const groupRouter = router({
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
			if (input.deviceId)
				conditions.push(eq(chatGroup.deviceId, input.deviceId));
			if (input.search?.trim()) {
				const q = `%${input.search.trim()}%`;
				const searchClause = or(
					ilike(chatGroup.subject, q),
					ilike(chatGroup.description, q),
					ilike(chatGroup.jid, q),
				);
				if (searchClause) conditions.push(searchClause);
			}

			return ctx.db
				.select({
					id: chatGroup.id,
					deviceId: chatGroup.deviceId,
					jid: chatGroup.jid,
					subject: chatGroup.subject,
					description: chatGroup.description,
					ownerJid: chatGroup.ownerJid,
					participantCount: chatGroup.participantCount,
					isMember: chatGroup.isMember,
					source: chatGroup.source,
					updatedAt: chatGroup.updatedAt,
				})
				.from(chatGroup)
				.innerJoin(device, eq(chatGroup.deviceId, device.id))
				.where(and(...conditions))
				.orderBy(desc(chatGroup.updatedAt))
				.limit(input.limit);
		}),

	participants: protectedProcedure
		.input(z.object({ groupId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const owned = await ctx.db
				.select({ id: chatGroup.id })
				.from(chatGroup)
				.innerJoin(device, eq(chatGroup.deviceId, device.id))
				.where(
					and(
						eq(chatGroup.id, input.groupId),
						eq(device.userId, ctx.session.user.id),
					),
				)
				.limit(1);
			if (!owned[0]) return [];

			return ctx.db
				.select({
					id: groupParticipant.id,
					jid: groupParticipant.jid,
					role: groupParticipant.role,
					updatedAt: groupParticipant.updatedAt,
				})
				.from(groupParticipant)
				.where(eq(groupParticipant.groupId, input.groupId));
		}),
});
