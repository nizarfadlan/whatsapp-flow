import { flowExecutionLog } from "@whatsapp-flow/db/schema/device";
import { desc, eq } from "drizzle-orm";
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
			const conditions = [];
			if (input.flowId)
				conditions.push(eq(flowExecutionLog.flowId, input.flowId));
			if (input.deviceId)
				conditions.push(eq(flowExecutionLog.deviceId, input.deviceId));

			const query = ctx.db
				.select()
				.from(flowExecutionLog)
				.where(conditions.length > 0 ? conditions[0] : undefined)
				.orderBy(desc(flowExecutionLog.startedAt))
				.limit(input.limit);

			return query;
		}),

	getById: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const rows = await ctx.db
				.select()
				.from(flowExecutionLog)
				.where(eq(flowExecutionLog.id, input.id))
				.limit(1);

			return rows[0] ?? null;
		}),
});
