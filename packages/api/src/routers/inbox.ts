import { device } from "@whatsapp-flow/db/schema/device";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

export const inboxRouter = router({
	list: protectedProcedure
		.input(
			z.object({
				deviceId: z.string().optional(),
				limit: z.number().min(1).max(100).optional().default(50),
			}),
		)
		.query(async ({ ctx, input }) => {
			const conditions = [eq(device.userId, ctx.session.user.id)];
			if (input.deviceId) {
				conditions.push(eq(inboxThread.deviceId, input.deviceId));
			}

			const rows = await ctx.db
				.select({
					id: inboxThread.id,
					deviceId: inboxThread.deviceId,
					contactNumber: inboxThread.contactNumber,
					contactName: inboxThread.contactName,
					lastMessageText: inboxThread.lastMessageText,
					lastMessageAt: inboxThread.lastMessageAt,
					unreadCount: inboxThread.unreadCount,
				})
				.from(inboxThread)
				.innerJoin(device, eq(inboxThread.deviceId, device.id))
				.where(and(...conditions))
				.orderBy(desc(inboxThread.lastMessageAt))
				.limit(input.limit);

			return rows;
		}),

	getThread: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const rows = await ctx.db
				.select({
					id: inboxThread.id,
					deviceId: inboxThread.deviceId,
					contactNumber: inboxThread.contactNumber,
					contactName: inboxThread.contactName,
					lastMessageText: inboxThread.lastMessageText,
					lastMessageAt: inboxThread.lastMessageAt,
					unreadCount: inboxThread.unreadCount,
				})
				.from(inboxThread)
				.innerJoin(device, eq(inboxThread.deviceId, device.id))
				.where(
					and(
						eq(inboxThread.id, input.id),
						eq(device.userId, ctx.session.user.id),
					),
				)
				.limit(1);

			return rows[0] ?? null;
		}),

	messages: protectedProcedure
		.input(
			z.object({
				threadId: z.string().min(1),
				cursor: z.string().optional(),
				limit: z.number().min(1).max(100).optional().default(30),
			}),
		)
		.query(async ({ ctx, input }) => {
			// Verify thread ownership
			const thread = await ctx.db
				.select({ id: inboxThread.id })
				.from(inboxThread)
				.innerJoin(device, eq(inboxThread.deviceId, device.id))
				.where(
					and(
						eq(inboxThread.id, input.threadId),
						eq(device.userId, ctx.session.user.id),
					),
				)
				.limit(1);

			if (!thread[0]) return [];

			const conditions = [eq(inboxMessage.threadId, input.threadId)];
			if (input.cursor) {
				conditions.push(gte(inboxMessage.createdAt, new Date(input.cursor)));
			}

			return ctx.db
				.select()
				.from(inboxMessage)
				.where(and(...conditions))
				.orderBy(asc(inboxMessage.createdAt))
				.limit(input.limit);
		}),

	markRead: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const thread = await ctx.db
				.select({ id: inboxThread.id })
				.from(inboxThread)
				.innerJoin(device, eq(inboxThread.deviceId, device.id))
				.where(
					and(
						eq(inboxThread.id, input.id),
						eq(device.userId, ctx.session.user.id),
					),
				)
				.limit(1);

			if (!thread[0]) {
				return { success: false };
			}

			await ctx.db
				.update(inboxThread)
				.set({ unreadCount: 0 })
				.where(eq(inboxThread.id, input.id));

			return { success: true };
		}),
});
