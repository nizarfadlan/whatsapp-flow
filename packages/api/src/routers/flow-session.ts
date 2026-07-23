import { TRPCError } from "@trpc/server";
import {
	flow,
	flowExecutionEvent,
	flowExecutionLog,
	flowSession,
} from "@whatsapp-flow/db/schema/device";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
	emitFlowSessionUpdated,
	recordFlowExecutionEvent,
} from "../engine/flow-executor";
import { organizationPermissionProcedure, router } from "../index";

const activeStatuses = ["waiting", "running"] as const;
const historyStatuses = ["completed", "expired", "failed"] as const;

function maskSessionVariables(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			String(item ?? "").trim() ? "••••" : "",
		]),
	);
}

function maskSession<T extends { variables: unknown }>(session: T) {
	return { ...session, variables: maskSessionVariables(session.variables) };
}

export const flowSessionRouter = router({
	list: organizationPermissionProcedure("organization.flows.read")
		.input(
			z.object({
				flowId: z.string().min(1),
				status: z.enum(["active", "history", "all"]).optional().default("all"),
				limit: z.number().min(1).max(100).optional().default(50),
			}),
		)
		.query(async ({ ctx, input }) => {
			const conditions = [
				eq(flowSession.flowId, input.flowId),
				eq(flow.tenantId, ctx.organization.id),
			];
			if (input.status === "active")
				conditions.push(inArray(flowSession.status, [...activeStatuses]));
			if (input.status === "history")
				conditions.push(inArray(flowSession.status, [...historyStatuses]));

			const sessions = await ctx.db
				.select({ session: flowSession })
				.from(flowSession)
				.innerJoin(flow, eq(flowSession.flowId, flow.id))
				.where(and(...conditions))
				.orderBy(desc(flowSession.createdAt))
				.limit(input.limit);

			return sessions.map(({ session }) => maskSession(session));
		}),

	get: organizationPermissionProcedure("organization.flows.read")
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.select({ session: flowSession })
				.from(flowSession)
				.innerJoin(flow, eq(flowSession.flowId, flow.id))
				.where(
					and(
						eq(flowSession.id, input.id),
						eq(flow.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			return row ? maskSession(row.session) : null;
		}),

	timeline: organizationPermissionProcedure("organization.flows.read")
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const [session] = await ctx.db
				.select({
					executionLogId: flowSession.executionLogId,
					flowId: flowSession.flowId,
				})
				.from(flowSession)
				.innerJoin(flow, eq(flowSession.flowId, flow.id))
				.where(
					and(
						eq(flowSession.id, input.id),
						eq(flow.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			if (!session)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Session not found",
				});

			return ctx.db
				.select()
				.from(flowExecutionEvent)
				.where(
					and(
						eq(flowExecutionEvent.executionLogId, session.executionLogId),
						eq(flowExecutionEvent.flowId, session.flowId),
					),
				)
				.orderBy(asc(flowExecutionEvent.createdAt));
		}),

	cancel: organizationPermissionProcedure("organization.flows.manage")
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const [session] = await ctx.db
				.select({ session: flowSession })
				.from(flowSession)
				.innerJoin(flow, eq(flowSession.flowId, flow.id))
				.where(
					and(
						eq(flowSession.id, input.id),
						eq(flow.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			if (!session)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Session not found",
				});
			if (
				session.session.status !== "waiting" &&
				session.session.status !== "running"
			)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Session is not active",
				});

			const completedAt = new Date();
			const [updated] = await ctx.db
				.update(flowSession)
				.set({
					status: "expired",
					claimJobId: null,
					claimedAt: null,
					failureCode: "cancelled",
					completedAt,
				})
				.where(
					and(
						eq(flowSession.id, input.id),
						eq(flowSession.flowId, session.session.flowId),
						inArray(flowSession.status, [...activeStatuses]),
					),
				)
				.returning();
			if (!updated)
				throw new TRPCError({
					code: "CONFLICT",
					message: "Session is no longer active",
				});

			await ctx.db
				.update(flowExecutionLog)
				.set({ status: "failed", error: "Session cancelled", completedAt })
				.where(eq(flowExecutionLog.id, updated.executionLogId));
			await recordFlowExecutionEvent({
				executionLogId: updated.executionLogId,
				flowId: updated.flowId,
				deviceId: updated.deviceId,
				contactNumber: updated.contactNumber,
				contactKey: updated.contactKey,
				sessionId: updated.id,
				type: "session.cancelled",
				nodeId: updated.waitingNodeId,
				message: "Session cancelled",
			});
			emitFlowSessionUpdated(updated);
			connectionManager.emit("flow:log:updated", {
				logId: updated.executionLogId,
				flowId: updated.flowId,
				deviceId: updated.deviceId,
			});

			return maskSession(updated);
		}),
});
