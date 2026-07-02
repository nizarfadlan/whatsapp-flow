import { contact } from "@whatsapp-flow/db/schema/contact";
import {
	device,
	flow,
	flowExecutionLog,
	flowSession,
} from "@whatsapp-flow/db/schema/device";
import { inboxThread } from "@whatsapp-flow/db/schema/inbox";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

const activeSessionStatuses = ["waiting", "running"] as const;

function buildLogSelect() {
	return {
		id: flowExecutionLog.id,
		flowId: flowExecutionLog.flowId,
		flowName: flow.name,
		deviceId: flowExecutionLog.deviceId,
		deviceName: device.name,
		contactNumber: flowExecutionLog.contactNumber,
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
			const conditions = [eq(flow.userId, ctx.session.user.id)];
			if (input.flowId)
				conditions.push(eq(flowExecutionLog.flowId, input.flowId));
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
						eq(contact.phoneNumber, flowExecutionLog.contactNumber),
					),
				)
				.leftJoin(
					inboxThread,
					and(
						eq(inboxThread.deviceId, flowExecutionLog.deviceId),
						eq(inboxThread.contactNumber, flowExecutionLog.contactNumber),
					),
				)
				.leftJoin(
					flowSession,
					and(
						eq(flowSession.executionLogId, flowExecutionLog.id),
						inArray(flowSession.status, [...activeSessionStatuses]),
					),
				)
				.where(and(...conditions))
				.orderBy(desc(flowExecutionLog.startedAt))
				.limit(input.limit);
		}),

	getById: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
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
						eq(contact.phoneNumber, flowExecutionLog.contactNumber),
					),
				)
				.leftJoin(
					inboxThread,
					and(
						eq(inboxThread.deviceId, flowExecutionLog.deviceId),
						eq(inboxThread.contactNumber, flowExecutionLog.contactNumber),
					),
				)
				.leftJoin(
					flowSession,
					and(
						eq(flowSession.executionLogId, flowExecutionLog.id),
						inArray(flowSession.status, [...activeSessionStatuses]),
					),
				)
				.where(
					and(
						eq(flowExecutionLog.id, input.id),
						eq(flow.userId, ctx.session.user.id),
					),
				)
				.limit(1);

			return rows[0] ?? null;
		}),
});
