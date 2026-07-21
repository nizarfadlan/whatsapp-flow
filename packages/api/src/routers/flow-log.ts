import { contact } from "@whatsapp-flow/db/schema/contact";
import {
	device,
	flow,
	flowExecutionEvent,
	flowExecutionLog,
	flowSession,
} from "@whatsapp-flow/db/schema/device";
import { inboxThread } from "@whatsapp-flow/db/schema/inbox";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireFlowAccess } from "../authorization/tenant-access";
import { protectedProcedure, router } from "../index";

function buildLogSelect() {
	return {
		id: flowExecutionLog.id,
		flowId: flowExecutionLog.flowId,
		flowName: flow.name,
		deviceId: flowExecutionLog.deviceId,
		deviceName: device.name,
		contactNumber: flowExecutionLog.contactNumber,
		contactKey: flowExecutionLog.contactKey,
		triggerSource: flowExecutionLog.triggerSource,
		status: flowExecutionLog.status,
		error: flowExecutionLog.error,
		nodeResults: flowExecutionLog.nodeResults,
		startedAt: flowExecutionLog.startedAt,
		completedAt: flowExecutionLog.completedAt,
		contactId: contact.id,
		contactName: contact.name,
		contactPushName: contact.pushName,
		inboxThreadId: inboxThread.id,
		sessionId: flowSession.id,
		sessionStatus: flowSession.status,
		waitingNodeId: flowSession.waitingNodeId,
		sessionExpiresAt: flowSession.expiresAt,
	};
}

export const flowLogRouter = router({
	list: protectedProcedure
		.input(
			z.object({
				flowId: z.string().optional(),
				deviceId: z.string().optional(),
				limit: z.number().min(1).max(100).optional().default(20),
			}),
		)
		.query(async ({ ctx, input }) => {
			const accessibleFlow = input.flowId
				? await requireFlowAccess(
						ctx.db,
						input.flowId,
						ctx.session.user.id,
						"viewer",
					)
				: null;
			const conditions = accessibleFlow
				? [eq(flowExecutionLog.flowId, accessibleFlow.flow.id)]
				: [eq(flow.userId, ctx.session.user.id)];
			if (input.deviceId)
				conditions.push(eq(flowExecutionLog.deviceId, input.deviceId));

			return ctx.db
				.select(buildLogSelect())
				.from(flowExecutionLog)
				.innerJoin(flow, eq(flowExecutionLog.flowId, flow.id))
				.innerJoin(device, eq(flowExecutionLog.deviceId, device.id))
				.leftJoin(
					contact,
					and(
						eq(contact.deviceId, flowExecutionLog.deviceId),
						eq(contact.identityKey, flowExecutionLog.contactKey),
					),
				)
				.leftJoin(
					inboxThread,
					and(
						eq(inboxThread.deviceId, flowExecutionLog.deviceId),
						eq(inboxThread.contactId, contact.id),
						eq(inboxThread.threadKey, flowExecutionLog.contactKey),
					),
				)
				.leftJoin(
					flowSession,
					eq(flowSession.executionLogId, flowExecutionLog.id),
				)
				.where(and(...conditions))
				.orderBy(desc(flowExecutionLog.startedAt))
				.limit(input.limit);
		}),

	getById: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const target = await ctx.db
				.select({ flowId: flowExecutionLog.flowId })
				.from(flowExecutionLog)
				.where(eq(flowExecutionLog.id, input.id))
				.limit(1);
			if (!target[0]) return null;

			const access = await requireFlowAccess(
				ctx.db,
				target[0].flowId,
				ctx.session.user.id,
				"viewer",
			);
			const rows = await ctx.db
				.select({
					...buildLogSelect(),
					flowNodes: flow.nodes,
				})
				.from(flowExecutionLog)
				.innerJoin(flow, eq(flowExecutionLog.flowId, flow.id))
				.innerJoin(device, eq(flowExecutionLog.deviceId, device.id))
				.leftJoin(
					contact,
					and(
						eq(contact.deviceId, flowExecutionLog.deviceId),
						eq(contact.identityKey, flowExecutionLog.contactKey),
					),
				)
				.leftJoin(
					inboxThread,
					and(
						eq(inboxThread.deviceId, flowExecutionLog.deviceId),
						eq(inboxThread.contactId, contact.id),
						eq(inboxThread.threadKey, flowExecutionLog.contactKey),
					),
				)
				.leftJoin(
					flowSession,
					eq(flowSession.executionLogId, flowExecutionLog.id),
				)
				.where(
					and(
						eq(flowExecutionLog.id, input.id),
						eq(flowExecutionLog.flowId, access.flow.id),
					),
				)
				.limit(1);

			return rows[0] ?? null;
		}),

	timeline: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const target = await ctx.db
				.select({ flowId: flowExecutionLog.flowId })
				.from(flowExecutionLog)
				.where(eq(flowExecutionLog.id, input.id))
				.limit(1);
			if (!target[0]) return [];

			const access = await requireFlowAccess(
				ctx.db,
				target[0].flowId,
				ctx.session.user.id,
				"viewer",
			);
			const authorizedLog = await ctx.db
				.select({ id: flowExecutionLog.id })
				.from(flowExecutionLog)
				.where(
					and(
						eq(flowExecutionLog.id, input.id),
						eq(flowExecutionLog.flowId, access.flow.id),
					),
				)
				.limit(1);
			if (!authorizedLog[0]) return [];

			return ctx.db
				.select()
				.from(flowExecutionEvent)
				.where(
					and(
						eq(flowExecutionEvent.executionLogId, authorizedLog[0].id),
						eq(flowExecutionEvent.flowId, access.flow.id),
					),
				)
				.orderBy(asc(flowExecutionEvent.createdAt));
		}),
});
