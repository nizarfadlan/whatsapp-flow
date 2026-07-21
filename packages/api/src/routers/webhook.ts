import { TRPCError } from "@trpc/server";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import { tenantMember } from "@whatsapp-flow/db/schema/tenant";
import {
	webhookDelivery,
	webhookEndpoint,
} from "@whatsapp-flow/db/schema/webhook";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireTenantMembership } from "../authorization/tenant-access";
import { WEBHOOK_EVENT_TYPES } from "../engine/webhook-events";
import { assertSafeOutboundWebhookUrl } from "../engine/webhook-url-safety";
import { protectedProcedure, router } from "../index";

const webhookEventInputSchema = z
	.array(z.union([z.enum(WEBHOOK_EVENT_TYPES), z.literal("*")]))
	.default(["*"]);

const safeEndpointSelect = {
	id: webhookEndpoint.id,
	userId: webhookEndpoint.userId,
	deviceId: webhookEndpoint.deviceId,
	name: webhookEndpoint.name,
	url: webhookEndpoint.url,
	isActive: webhookEndpoint.isActive,
	subscribedEvents: webhookEndpoint.subscribedEvents,
	deviceIds: webhookEndpoint.deviceIds,
	flowIds: webhookEndpoint.flowIds,
	createdAt: webhookEndpoint.createdAt,
	updatedAt: webhookEndpoint.updatedAt,
};

function generateSecret() {
	return `whsec_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function normalizeStringIds(value: string[] | undefined) {
	return [...new Set((value ?? []).filter(Boolean))];
}

function normalizeSubscribedEvents(events: ("*" | string)[] | undefined) {
	const unique = [...new Set(events?.filter(Boolean) ?? ["*"])];
	if (unique.length === 0 || unique.includes("*")) return ["*"];
	return unique;
}

async function validateWebhookUrl(url: string) {
	try {
		await assertSafeOutboundWebhookUrl(url);
	} catch (error) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				error instanceof Error ? error.message : "Webhook URL is invalid",
		});
	}
}

async function requireTenantWebhookControl(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	tenantId: string,
	userId: string,
) {
	const membership = await requireTenantMembership(db, tenantId, userId);
	if (membership.role !== "owner") {
		throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
	}
}

async function requireWebhookEndpointControl(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	endpointId: string,
	userId: string,
) {
	const rows = await db
		.select({ endpoint: webhookEndpoint })
		.from(webhookEndpoint)
		.innerJoin(
			tenantMember,
			and(
				eq(tenantMember.tenantId, webhookEndpoint.tenantId),
				eq(tenantMember.userId, userId),
				eq(tenantMember.role, "owner"),
			),
		)
		.where(eq(webhookEndpoint.id, endpointId))
		.limit(1);

	const endpoint = rows[0]?.endpoint;
	if (!endpoint) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Webhook endpoint not found",
		});
	}

	return endpoint;
}

async function validateOwnedDevices(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	ids: string[],
	userId: string,
	tenantId: string,
) {
	if (ids.length === 0) return;
	const rows = await db
		.select({ id: device.id })
		.from(device)
		.where(
			and(
				eq(device.userId, userId),
				eq(device.tenantId, tenantId),
				inArray(device.id, ids),
			),
		);

	if (rows.length !== ids.length) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
	}
}

async function validateOwnedFlows(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	ids: string[],
	userId: string,
	tenantId: string,
) {
	if (ids.length === 0) return;
	const rows = await db
		.select({ id: flow.id })
		.from(flow)
		.where(
			and(
				eq(flow.userId, userId),
				eq(flow.tenantId, tenantId),
				inArray(flow.id, ids),
			),
		);

	if (rows.length !== ids.length) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
	}
}

export const webhookRouter = router({
	listEndpoints: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select(safeEndpointSelect)
			.from(webhookEndpoint)
			.innerJoin(
				tenantMember,
				and(
					eq(tenantMember.tenantId, webhookEndpoint.tenantId),
					eq(tenantMember.userId, ctx.session.user.id),
					eq(tenantMember.role, "owner"),
				),
			)
			.orderBy(desc(webhookEndpoint.createdAt));
	}),

	createEndpoint: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				tenantId: z.string().min(1).optional(),
				url: z.string().url(),
				isActive: z.boolean().optional().default(true),
				deviceIds: z.array(z.string().min(1)).optional().default([]),
				flowIds: z.array(z.string().min(1)).optional().default([]),
				subscribedEvents: webhookEventInputSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tenantId = input.tenantId ?? ctx.session.user.id;
			await requireTenantWebhookControl(ctx.db, tenantId, ctx.session.user.id);
			const deviceIds = normalizeStringIds(input.deviceIds);
			const flowIds = normalizeStringIds(input.flowIds);
			const subscribedEvents = normalizeSubscribedEvents(
				input.subscribedEvents,
			);

			await validateWebhookUrl(input.url);
			await validateOwnedDevices(
				ctx.db,
				deviceIds,
				ctx.session.user.id,
				tenantId,
			);
			await validateOwnedFlows(ctx.db, flowIds, ctx.session.user.id, tenantId);

			const [row] = await ctx.db
				.insert(webhookEndpoint)
				.values({
					id: crypto.randomUUID(),
					userId: ctx.session.user.id,
					tenantId,
					name: input.name,
					url: input.url,
					secret: generateSecret(),
					subscribedEvents,
					deviceIds,
					flowIds,
					isActive: input.isActive,
				})
				.returning(safeEndpointSelect);
			return row;
		}),

	updateEndpoint: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1).optional(),
				url: z.string().url().optional(),
				isActive: z.boolean().optional(),
				deviceIds: z.array(z.string().min(1)).optional(),
				flowIds: z.array(z.string().min(1)).optional(),
				subscribedEvents: webhookEventInputSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { id, deviceIds, flowIds, subscribedEvents, ...updates } = input;

			const owned = await requireWebhookEndpointControl(
				ctx.db,
				id,
				ctx.session.user.id,
			);

			const nextUpdates: typeof updates & {
				deviceIds?: string[];
				flowIds?: string[];
				subscribedEvents?: string[];
			} = { ...updates };

			if (updates.url) {
				await validateWebhookUrl(updates.url);
			}

			if (deviceIds) {
				const normalized = normalizeStringIds(deviceIds);
				await validateOwnedDevices(
					ctx.db,
					normalized,
					ctx.session.user.id,
					owned.tenantId,
				);
				nextUpdates.deviceIds = normalized;
			}

			if (flowIds) {
				const normalized = normalizeStringIds(flowIds);
				await validateOwnedFlows(
					ctx.db,
					normalized,
					ctx.session.user.id,
					owned.tenantId,
				);
				nextUpdates.flowIds = normalized;
			}

			if (subscribedEvents) {
				nextUpdates.subscribedEvents =
					normalizeSubscribedEvents(subscribedEvents);
			}

			if (Object.keys(nextUpdates).length > 0) {
				const [updated] = await ctx.db
					.update(webhookEndpoint)
					.set({ ...nextUpdates, updatedAt: new Date() })
					.where(eq(webhookEndpoint.id, id))
					.returning(safeEndpointSelect);
				return updated;
			}
			const [unchanged] = await ctx.db
				.select(safeEndpointSelect)
				.from(webhookEndpoint)
				.where(eq(webhookEndpoint.id, id));
			return unchanged;
		}),

	deleteEndpoint: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireWebhookEndpointControl(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);
			await ctx.db
				.delete(webhookEndpoint)
				.where(eq(webhookEndpoint.id, input.id));
			return { success: true };
		}),

	regenerateSecret: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireWebhookEndpointControl(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);

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
			await requireWebhookEndpointControl(
				ctx.db,
				input.endpointId,
				ctx.session.user.id,
			);

			return ctx.db
				.select()
				.from(webhookDelivery)
				.where(eq(webhookDelivery.endpointId, input.endpointId))
				.orderBy(desc(webhookDelivery.createdAt))
				.limit(input.limit);
		}),
});
