import { TRPCError } from "@trpc/server";
import { flow, flowSession } from "@whatsapp-flow/db/schema/device";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

export const flowSessionRouter = router({
	list: protectedProcedure
		.input(z.object({ flowId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const owned = await ctx.db
				.select({ id: flow.id })
				.from(flow)
				.where(
					and(eq(flow.id, input.flowId), eq(flow.userId, ctx.session.user.id)),
				)
				.limit(1);

			if (!owned[0]) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
			}

			return ctx.db
				.select()
				.from(flowSession)
				.where(
					and(
						eq(flowSession.flowId, input.flowId),
						inArray(flowSession.status, ["waiting", "running"]),
					),
				)
				.orderBy(desc(flowSession.createdAt));
		}),

	get: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const rows = await ctx.db
				.select({ session: flowSession })
				.from(flowSession)
				.innerJoin(flow, eq(flowSession.flowId, flow.id))
				.where(
					and(
						eq(flowSession.id, input.id),
						eq(flow.userId, ctx.session.user.id),
					),
				)
				.limit(1);

			return rows[0]?.session ?? null;
		}),

	cancel: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const rows = await ctx.db
				.select({ session: flowSession })
				.from(flowSession)
				.innerJoin(flow, eq(flowSession.flowId, flow.id))
				.where(
					and(
						eq(flowSession.id, input.id),
						eq(flow.userId, ctx.session.user.id),
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

			const [updated] = await ctx.db
				.update(flowSession)
				.set({ status: "expired", completedAt: new Date() })
				.where(eq(flowSession.id, input.id))
				.returning();

			return updated;
		}),
});
