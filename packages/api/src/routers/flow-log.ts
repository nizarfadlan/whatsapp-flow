import { flow, flowExecutionLog } from "@whatsapp-flow/db/schema/device";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

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

			const rows = await ctx.db
				.select({ log: flowExecutionLog })
				.from(flowExecutionLog)
				.innerJoin(flow, eq(flowExecutionLog.flowId, flow.id))
				.where(and(...conditions))
				.orderBy(desc(flowExecutionLog.startedAt))
				.limit(input.limit);

			return rows.map((row) => row.log);
		}),

	getById: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const rows = await ctx.db
				.select({ log: flowExecutionLog })
				.from(flowExecutionLog)
				.innerJoin(flow, eq(flowExecutionLog.flowId, flow.id))
				.where(
					and(
						eq(flowExecutionLog.id, input.id),
						eq(flow.userId, ctx.session.user.id),
					),
				)
				.limit(1);

			return rows[0]?.log ?? null;
		}),
});
