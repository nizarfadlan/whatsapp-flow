import { TRPCError } from "@trpc/server";
import { device } from "@whatsapp-flow/db/schema/device";
import {
	webhookDelivery,
	webhookEndpoint,
} from "@whatsapp-flow/db/schema/webhook";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

function generateSecret() {
	return `whsec_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export const webhookRouter = router({
	listEndpoints: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select()
			.from(webhookEndpoint)
			.where(eq(webhookEndpoint.userId, ctx.session.user.id))
			.orderBy(desc(webhookEndpoint.createdAt));
	}),

	createEndpoint: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				url: z.string().url(),
				deviceId: z.string().nullable().optional(),
				subscribedEvents: z.array(z.string()).default(["*"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.deviceId) {
				// Verify device ownership
				const [owned] = await ctx.db
					.select({ id: device.id })
					.from(device)
					.where(
						and(
							eq(device.id, input.deviceId),
							eq(device.userId, ctx.session.user.id),
						),
					)
					.limit(1);
				if (!owned) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Device not found",
					});
				}
			}

			const [row] = await ctx.db
				.insert(webhookEndpoint)
				.values({
					id: crypto.randomUUID(),
					userId: ctx.session.user.id,
					deviceId: input.deviceId ?? null,
					name: input.name,
					url: input.url,
					secret: generateSecret(),
					subscribedEvents: input.subscribedEvents,
					isActive: true,
				})
				.returning();
			return row;
		}),

	updateEndpoint: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1).optional(),
				url: z.string().url().optional(),
				isActive: z.boolean().optional(),
				subscribedEvents: z.array(z.string()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { id, ...updates } = input;

			const [owned] = await ctx.db
				.select({ id: webhookEndpoint.id })
				.from(webhookEndpoint)
				.where(
					and(
						eq(webhookEndpoint.id, id),
						eq(webhookEndpoint.userId, ctx.session.user.id),
					),
				)
				.limit(1);
			if (!owned) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Webhook endpoint not found",
				});
			}

			if (Object.keys(updates).length > 0) {
				const [updated] = await ctx.db
					.update(webhookEndpoint)
					.set({ ...updates, updatedAt: new Date() })
					.where(eq(webhookEndpoint.id, id))
					.returning();
				return updated;
			}
			return owned;
		}),

	deleteEndpoint: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const [owned] = await ctx.db
				.select({ id: webhookEndpoint.id })
				.from(webhookEndpoint)
				.where(
					and(
						eq(webhookEndpoint.id, input.id),
						eq(webhookEndpoint.userId, ctx.session.user.id),
					),
				)
				.limit(1);
			if (!owned) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Webhook endpoint not found",
				});
			}
			await ctx.db
				.delete(webhookEndpoint)
				.where(eq(webhookEndpoint.id, input.id));
			return { success: true };
		}),

	regenerateSecret: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const [owned] = await ctx.db
				.select({ id: webhookEndpoint.id })
				.from(webhookEndpoint)
				.where(
					and(
						eq(webhookEndpoint.id, input.id),
						eq(webhookEndpoint.userId, ctx.session.user.id),
					),
				)
				.limit(1);
			if (!owned) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Webhook endpoint not found",
				});
			}

			const [updated] = await ctx.db
				.update(webhookEndpoint)
				.set({ secret: generateSecret(), updatedAt: new Date() })
				.where(eq(webhookEndpoint.id, input.id))
				.returning();
			if (!updated) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to regenerate secret",
				});
			}
			return { secret: updated.secret };
		}),

	listDeliveries: protectedProcedure
		.input(
			z.object({
				endpointId: z.string().min(1),
				limit: z.number().min(1).max(100).default(50),
			}),
		)
		.query(async ({ ctx, input }) => {
			const [owned] = await ctx.db
				.select({ id: webhookEndpoint.id })
				.from(webhookEndpoint)
				.where(
					and(
						eq(webhookEndpoint.id, input.endpointId),
						eq(webhookEndpoint.userId, ctx.session.user.id),
					),
				)
				.limit(1);
			if (!owned) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Webhook endpoint not found",
				});
			}

			return ctx.db
				.select()
				.from(webhookDelivery)
				.where(eq(webhookDelivery.endpointId, input.endpointId))
				.orderBy(desc(webhookDelivery.createdAt))
				.limit(input.limit);
		}),
});
