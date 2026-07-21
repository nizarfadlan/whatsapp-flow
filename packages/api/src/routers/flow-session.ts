import { TRPCError } from "@trpc/server";
import {
	flowExecutionEvent,
	flowExecutionLog,
	flowSession,
} from "@whatsapp-flow/db/schema/device";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
	requireFlowAccess,
	requireFlowOwner,
} from "../authorization/tenant-access";
import {
	emitFlowSessionUpdated,
	recordFlowExecutionEvent,
} from "../engine/flow-executor";
import { protectedProcedure, router } from "../index";

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
	list: protectedProcedure
		.input(
			z.object({
				flowId: z.string().min(1),
				status: z.enum(["active", "history", "all"]).optional().default("all"),
				limit: z.number().min(1).max(100).optional().default(50),
			}),
		)
		.query(async ({ ctx, input }) => {
			const access = await requireFlowAccess(
				ctx.db,
				input.flowId,
				ctx.session.user.id,
				"viewer",
			);

			const conditions = [eq(flowSession.flowId, access.flow.id)];
			if (input.status === "active") {
				conditions.push(inArray(flowSession.status, [...activeStatuses]));
			}
			if (input.status === "history") {
				conditions.push(inArray(flowSession.status, [...historyStatuses]));
			}

			const sessions = await ctx.db
				.select()
				.from(flowSession)
				.where(and(...conditions))
				.orderBy(desc(flowSession.createdAt))
				.limit(input.limit);

			return sessions.map(maskSession);
		}),

	get: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const target = await ctx.db
				.select({ flowId: flowSession.flowId })
				.from(flowSession)
				.where(eq(flowSession.id, input.id))
				.limit(1);
			if (!target[0]) return null;

			const access = await requireFlowAccess(
				ctx.db,
				target[0].flowId,
				ctx.session.user.id,
				"viewer",
			);
			const rows = await ctx.db
				.select({ session: flowSession })
				.from(flowSession)
				.where(
					and(
						eq(flowSession.id, input.id),
						eq(flowSession.flowId, access.flow.id),
					),
				)
				.limit(1);

			const session = rows[0]?.session;
			return session ? maskSession(session) : null;
		}),

	timeline: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const target = await ctx.db
				.select({ flowId: flowSession.flowId })
				.from(flowSession)
				.where(eq(flowSession.id, input.id))
				.limit(1);
			if (!target[0]) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Session not found",
				});
			}

			const access = await requireFlowAccess(
				ctx.db,
				target[0].flowId,
				ctx.session.user.id,
				"viewer",
			);
			const rows = await ctx.db
				.select({ session: flowSession })
				.from(flowSession)
				.where(
					and(
						eq(flowSession.id, input.id),
						eq(flowSession.flowId, access.flow.id),
					),
				)
				.limit(1);

			const session = rows[0]?.session;
			if (!session) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Session not found",
				});
			}

			return ctx.db
				.select()
				.from(flowExecutionEvent)
				.where(
					and(
						eq(flowExecutionEvent.executionLogId, session.executionLogId),
						eq(flowExecutionEvent.flowId, access.flow.id),
					),
				)
				.orderBy(asc(flowExecutionEvent.createdAt));
		}),

	cancel: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const target = await ctx.db
				.select({ flowId: flowSession.flowId })
				.from(flowSession)
				.where(eq(flowSession.id, input.id))
				.limit(1);
			if (!target[0]) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Session not found",
				});
			}

			const authorizedFlow = await requireFlowOwner(
				ctx.db,
				target[0].flowId,
				ctx.session.user.id,
			);
			const rows = await ctx.db
				.select({ session: flowSession })
				.from(flowSession)
				.where(
					and(
						eq(flowSession.id, input.id),
						eq(flowSession.flowId, authorizedFlow.id),
					),
				)
				.limit(1);

			const session = rows[0]?.session;
			if (!session) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Session not found",
				});
			}

			if (session.status !== "waiting" && session.status !== "running") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Session is not active",
				});
			}

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
						eq(flowSession.flowId, authorizedFlow.id),
						inArray(flowSession.status, [...activeStatuses]),
					),
				)
				.returning();

			if (!updated) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Session is no longer active",
				});
			}

			if (updated) {
				await ctx.db
					.update(flowExecutionLog)
					.set({
						status: "failed",
						error: "Session cancelled",
						completedAt,
					})
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
			}

			return updated ? maskSession(updated) : updated;
		}),
});
