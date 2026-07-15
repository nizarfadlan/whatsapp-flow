import { TRPCError } from "@trpc/server";
import {
	chatGroup,
	groupParticipant,
	groupTag,
	tag,
} from "@whatsapp-flow/db/schema/contact";
import { device } from "@whatsapp-flow/db/schema/device";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { startDeviceResourceSync } from "../engine/device-resource-sync";
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

			const groups = await ctx.db
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
			if (groups.length === 0) return [];

			const tagRows = await ctx.db
				.select({ groupId: groupTag.groupId, id: tag.id, name: tag.name })
				.from(groupTag)
				.innerJoin(tag, eq(groupTag.tagId, tag.id))
				.where(
					and(
						inArray(
							groupTag.groupId,
							groups.map((row) => row.id),
						),
						eq(tag.userId, ctx.session.user.id),
					),
				)
				.orderBy(asc(tag.name));
			const tagsByGroupId = new Map<string, { id: string; name: string }[]>();
			for (const tagRow of tagRows) {
				const tags = tagsByGroupId.get(tagRow.groupId) ?? [];
				tags.push({ id: tagRow.id, name: tagRow.name });
				tagsByGroupId.set(tagRow.groupId, tags);
			}
			return groups.map((row) => ({
				...row,
				tags: tagsByGroupId.get(row.id) ?? [],
			}));
		}),

	setTags: protectedProcedure
		.input(
			z.object({
				groupId: z.string().min(1),
				tagIds: z.array(z.string().min(1)).max(100),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tagIds = [...new Set(input.tagIds)];
			const [ownedGroup] = await ctx.db
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
			if (!ownedGroup) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
			}
			if (tagIds.length > 0) {
				const ownedTags = await ctx.db
					.select({ id: tag.id })
					.from(tag)
					.where(
						and(eq(tag.userId, ctx.session.user.id), inArray(tag.id, tagIds)),
					);
				if (ownedTags.length !== tagIds.length) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
				}
			}
			await ctx.db.delete(groupTag).where(eq(groupTag.groupId, input.groupId));
			if (tagIds.length > 0) {
				await ctx.db
					.insert(groupTag)
					.values(tagIds.map((tagId) => ({ groupId: input.groupId, tagId })));
			}
			return { success: true };
		}),

	syncOne: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const [owned] = await ctx.db
				.select({
					deviceId: chatGroup.deviceId,
					jid: chatGroup.jid,
					provider: device.provider,
				})
				.from(chatGroup)
				.innerJoin(device, eq(chatGroup.deviceId, device.id))
				.where(
					and(
						eq(chatGroup.id, input.id),
						eq(device.userId, ctx.session.user.id),
					),
				)
				.limit(1);
			if (!owned) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
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
				resource: "groups",
				scopeKey: owned.jid,
				db: ctx.db,
			});
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
