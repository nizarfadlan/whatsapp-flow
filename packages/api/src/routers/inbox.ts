import { TRPCError } from "@trpc/server";
import { device } from "@whatsapp-flow/db/schema/device";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import {
	connectionManager,
	sendWhatsAppMessage,
} from "@whatsapp-flow/whatsapp";
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
					chatType: inboxThread.chatType,
					chatJid: inboxThread.chatJid,
					contactId: inboxThread.contactId,
					groupId: inboxThread.groupId,
					groupJid: inboxThread.groupJid,
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
					chatType: inboxThread.chatType,
					chatJid: inboxThread.chatJid,
					contactId: inboxThread.contactId,
					groupId: inboxThread.groupId,
					groupJid: inboxThread.groupJid,
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

	sendMessage: protectedProcedure
		.input(
			z.object({
				threadId: z.string().min(1),
				text: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const rows = await ctx.db
				.select({
					id: inboxThread.id,
					deviceId: inboxThread.deviceId,
					chatJid: inboxThread.chatJid,
					contactNumber: inboxThread.contactNumber,
				})
				.from(inboxThread)
				.innerJoin(device, eq(inboxThread.deviceId, device.id))
				.where(
					and(
						eq(inboxThread.id, input.threadId),
						eq(device.userId, ctx.session.user.id),
					),
				)
				.limit(1);

			const thread = rows[0];
			if (!thread) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
			}

			const jid = thread.chatJid ?? `${thread.contactNumber}@s.whatsapp.net`;
			const connection = connectionManager.getConnection(thread.deviceId);
			if (!connection?.socket) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Device is not connected",
				});
			}

			await sendWhatsAppMessage(connection.socket, jid, {
				type: "text",
				text: input.text,
			});

			const now = new Date();
			const [message] = await ctx.db
				.insert(inboxMessage)
				.values({
					id: crypto.randomUUID(),
					threadId: thread.id,
					direction: "outbound",
					messageType: "text",
					text: input.text,
				})
				.returning();

			await ctx.db
				.update(inboxThread)
				.set({ lastMessageText: input.text, lastMessageAt: now })
				.where(eq(inboxThread.id, thread.id));

			connectionManager.emit("inbox:updated", {
				deviceId: thread.deviceId,
				threadId: thread.id,
			});

			return message;
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
