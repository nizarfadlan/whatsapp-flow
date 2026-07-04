import { channel } from "@whatsapp-flow/db/schema/contact";
import { device } from "@whatsapp-flow/db/schema/device";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

export const channelRouter = router({
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
			if (input.deviceId) conditions.push(eq(channel.deviceId, input.deviceId));
			if (input.search?.trim()) {
				const q = `%${input.search.trim()}%`;
				const searchClause = or(
					ilike(channel.name, q),
					ilike(channel.description, q),
					ilike(channel.jid, q),
				);
				if (searchClause) conditions.push(searchClause);
			}

			return ctx.db
				.select({
					id: channel.id,
					deviceId: channel.deviceId,
					jid: channel.jid,
					name: channel.name,
					description: channel.description,
					ownerJid: channel.ownerJid,
					subscribersCount: channel.subscribersCount,
					isSubscribed: channel.isSubscribed,
					verificationStatus: channel.verificationStatus,
					source: channel.source,
					updatedAt: channel.updatedAt,
				})
				.from(channel)
				.innerJoin(device, eq(channel.deviceId, device.id))
				.where(and(...conditions))
				.orderBy(desc(channel.updatedAt))
				.limit(input.limit);
		}),
});
