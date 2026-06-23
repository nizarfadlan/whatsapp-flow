import { TRPCError } from "@trpc/server";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { validateCronExpression } from "../engine/cron";
import { protectedProcedure, router } from "../index";

const jsonSchema = z.unknown();

type FlowNode = {
	id: string;
	type?: string;
	data?: Record<string, unknown>;
};

type FlowEdge = {
	source: string;
	target: string;
	sourceHandle?: string | null;
};

function getTriggerPayload(nodes: FlowNode[]) {
	const trigger = nodes.find((node) => node.type === "trigger");
	const data = (trigger?.data ?? {}) as Record<string, unknown>;
	const kind = data.triggerKind;

	switch (kind) {
		case "keyword":
			return {
				triggerType: "keyword" as const,
				triggerConfig: { keyword: String(data.keyword ?? "") },
			};
		case "any_message":
			return { triggerType: "any_message" as const, triggerConfig: null };
		case "webhook":
			return {
				triggerType: "webhook" as const,
				triggerConfig: { webhookToken: String(data.webhookToken ?? "") },
			};
		case "schedule":
			return {
				triggerType: "schedule" as const,
				triggerConfig: {
					cronExpression: String(data.cronExpression ?? ""),
					contactNumber: String(data.contactNumber ?? ""),
				},
			};
		default:
			return null;
	}
}

function nonEmpty(value: unknown) {
	return typeof value === "string" && value.trim().length > 0;
}

function normalizeNumber(value: unknown) {
	return typeof value === "string" ? value.replace(/[^\d]/g, "") : "";
}

function validateFlowGraph(nodes: FlowNode[], edges: FlowEdge[]) {
	if (nodes.length === 0) return "Flow has no nodes";

	const triggers = nodes.filter((node) => node.type === "trigger");
	if (triggers.length === 0) return "Flow needs exactly one trigger node";
	if (triggers.length > 1) return "Flow can only have one trigger node";

	const trigger = triggers[0];
	if (!trigger) return "Flow needs exactly one trigger node";
	if (!edges.some((edge) => edge.source === trigger.id)) {
		return "Trigger node must connect to another node";
	}

	const triggerData = trigger.data ?? {};
	const triggerKind = triggerData.triggerKind;
	if (triggerKind === "keyword" && !nonEmpty(triggerData.keyword)) {
		return "Keyword trigger needs a keyword";
	}
	if (triggerKind === "webhook" && !nonEmpty(triggerData.webhookToken)) {
		return "Webhook trigger needs a secret token";
	}
	if (triggerKind === "schedule") {
		if (!nonEmpty(triggerData.cronExpression)) {
			return "Schedule trigger needs a cron expression";
		}
		const cronValidation = validateCronExpression(
			String(triggerData.cronExpression),
		);
		if (!cronValidation.ok) {
			return cronValidation.message;
		}
		if (!normalizeNumber(triggerData.contactNumber)) {
			return "Schedule trigger needs a recipient number";
		}
	}

	for (const node of nodes) {
		const data = node.data ?? {};
		switch (node.type) {
			case "send-text":
				if (!nonEmpty(data.text)) return "Send Text node needs message text";
				break;
			case "send-image":
			case "send-video":
			case "send-audio":
			case "send-document":
				if (!nonEmpty(data.mediaUrl)) {
					return `${node.type} node needs media URL`;
				}
				break;
			case "condition":
				if (!nonEmpty(data.field) || !nonEmpty(data.value)) {
					return "Condition node needs field and value";
				}
				if (
					!edges.some(
						(edge) => edge.source === node.id && edge.sourceHandle === "true",
					)
				) {
					return "Condition node needs a true branch";
				}
				if (
					!edges.some(
						(edge) => edge.source === node.id && edge.sourceHandle === "false",
					)
				) {
					return "Condition node needs a false branch";
				}
				break;
			case "wait-for-reply": {
				if (!nonEmpty(data.variableName)) {
					return "Wait for Reply node needs a variable name";
				}
				const timeoutMinutes = Number(data.timeoutMinutes ?? 1440);
				if (
					!Number.isInteger(timeoutMinutes) ||
					timeoutMinutes < 1 ||
					timeoutMinutes > 10_080
				) {
					return "Wait for Reply timeout must be between 1 and 10080 minutes";
				}
				break;
			}
			case "webhook-call":
				if (!nonEmpty(data.webhookUrl)) return "Webhook Call node needs a URL";
				break;
			case "forward":
				if (!nonEmpty(data.targetNumber)) {
					return "Forward node needs a target number";
				}
				break;
		}
	}

	return null;
}

async function requireFlowOwnership(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	flowId: string,
	userId: string,
) {
	const rows = await db
		.select()
		.from(flow)
		.where(and(eq(flow.id, flowId), eq(flow.userId, userId)))
		.limit(1);

	const found = rows[0];
	if (!found) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
	}

	return found;
}

async function requireDeviceOwnership(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	deviceId: string,
	userId: string,
) {
	const rows = await db
		.select({ id: device.id, status: device.status })
		.from(device)
		.where(and(eq(device.id, deviceId), eq(device.userId, userId)))
		.limit(1);

	const found = rows[0];
	if (!found) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
	}

	return found;
}

export const flowRouter = router({
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select({
				id: flow.id,
				name: flow.name,
				description: flow.description,
				status: flow.status,
				triggerType: flow.triggerType,
				deviceId: flow.deviceId,
				createdAt: flow.createdAt,
				updatedAt: flow.updatedAt,
			})
			.from(flow)
			.where(eq(flow.userId, ctx.session.user.id))
			.orderBy(desc(flow.updatedAt));
	}),

	getById: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			return requireFlowOwnership(ctx.db, input.id, ctx.session.user.id);
		}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				description: z.string().optional(),
				triggerType: z
					.enum(["keyword", "any_message", "webhook", "schedule"])
					.optional(),
				triggerConfig: jsonSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const id = crypto.randomUUID();
			const rows = await ctx.db
				.insert(flow)
				.values({
					id,
					userId: ctx.session.user.id,
					name: input.name,
					description: input.description ?? null,
					triggerType: (input.triggerType ?? "keyword") as
						| "keyword"
						| "any_message"
						| "webhook"
						| "schedule",
					triggerConfig: input.triggerConfig ?? null,
				})
				.returning({
					id: flow.id,
					name: flow.name,
					status: flow.status,
				});

			return rows[0];
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1).optional(),
				description: z.string().nullable().optional(),
				nodes: jsonSchema.optional(),
				edges: jsonSchema.optional(),
				triggerType: z
					.enum(["keyword", "any_message", "webhook", "schedule"])
					.optional(),
				triggerConfig: jsonSchema.optional(),
				deviceId: z.string().min(1).nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const found = await requireFlowOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);
			if (input.deviceId) {
				await requireDeviceOwnership(
					ctx.db,
					input.deviceId,
					ctx.session.user.id,
				);
			}
			const { id, ...updates } = input;
			delete updates.triggerType;
			delete updates.triggerConfig;

			if (Array.isArray(input.nodes)) {
				const triggerPayload = getTriggerPayload(input.nodes as FlowNode[]);
				if (triggerPayload) {
					updates.triggerType = triggerPayload.triggerType;
					updates.triggerConfig = triggerPayload.triggerConfig;
				}
			}

			if (Object.keys(updates).length === 0) return found;

			const rows = await ctx.db
				.update(flow)
				.set(updates)
				.where(eq(flow.id, id))
				.returning();

			return rows[0];
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireFlowOwnership(ctx.db, input.id, ctx.session.user.id);
			await ctx.db.delete(flow).where(eq(flow.id, input.id));
			return { success: true };
		}),

	toggleStatus: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				status: z.enum(["draft", "active", "paused"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const found = await requireFlowOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);

			if (input.status === "active") {
				const nodes = Array.isArray(found.nodes)
					? (found.nodes as FlowNode[])
					: [];
				const edges = Array.isArray(found.edges)
					? (found.edges as FlowEdge[])
					: [];
				const validationError = validateFlowGraph(nodes, edges);
				if (validationError) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: validationError,
					});
				}

				if (!found.deviceId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Deploy flow to a device before activating",
					});
				}

				const targetDevice = await requireDeviceOwnership(
					ctx.db,
					found.deviceId,
					ctx.session.user.id,
				);
				const liveStatus =
					connectionManager.getConnection(found.deviceId)?.status ??
					targetDevice.status;
				if (liveStatus !== "connected") {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Device must be connected before activation",
					});
				}
			}

			await ctx.db
				.update(flow)
				.set({ status: input.status })
				.where(eq(flow.id, input.id));

			return { success: true };
		}),

	deploy: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				deviceId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const found = await requireFlowOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);

			const nodes = Array.isArray(found.nodes)
				? (found.nodes as FlowNode[])
				: [];
			const edges = Array.isArray(found.edges)
				? (found.edges as FlowEdge[])
				: [];
			const validationError = validateFlowGraph(nodes, edges);
			if (validationError) {
				throw new TRPCError({ code: "BAD_REQUEST", message: validationError });
			}

			const targetDevice = await requireDeviceOwnership(
				ctx.db,
				input.deviceId,
				ctx.session.user.id,
			);

			const liveStatus =
				connectionManager.getConnection(input.deviceId)?.status ??
				targetDevice.status;
			if (liveStatus !== "connected") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Device must be connected before deploy",
				});
			}

			const triggerPayload = getTriggerPayload(nodes);
			if (!triggerPayload) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Flow needs a trigger node",
				});
			}

			await ctx.db
				.update(flow)
				.set({
					deviceId: input.deviceId,
					status: "active",
					triggerType: triggerPayload.triggerType,
					triggerConfig: triggerPayload.triggerConfig,
				})
				.where(eq(flow.id, input.id));

			return { success: true };
		}),

	duplicate: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const original = await requireFlowOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);

			const newId = crypto.randomUUID();
			const rows = await ctx.db
				.insert(flow)
				.values({
					id: newId,
					userId: ctx.session.user.id,
					name: `${original.name} (Copy)`,
					description: original.description,
					nodes: original.nodes,
					edges: original.edges,
					triggerType: original.triggerType,
					triggerConfig: original.triggerConfig,
					status: "draft",
				})
				.returning({
					id: flow.id,
					name: flow.name,
				});

			return rows[0];
		}),
});
