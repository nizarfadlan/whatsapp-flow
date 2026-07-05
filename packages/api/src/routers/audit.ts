import { TRPCError } from "@trpc/server";
import { auditLog } from "@whatsapp-flow/db/schema/audit";
import { and, count, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "../index";

const listAuditInputSchema = z.object({
	query: z.string().trim().max(160).optional(),
	actorUserId: z.string().trim().min(1).optional(),
	targetType: z.string().trim().max(80).optional(),
	action: z.string().trim().max(120).optional(),
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional(),
	limit: z.number().int().min(1).max(100).default(50),
	offset: z.number().int().min(0).default(0),
});

function listWhere(input: z.infer<typeof listAuditInputSchema>) {
	const conditions = [];
	if (input.actorUserId) {
		conditions.push(eq(auditLog.actorUserId, input.actorUserId));
	}
	if (input.targetType) {
		conditions.push(eq(auditLog.targetType, input.targetType));
	}
	if (input.action) {
		conditions.push(eq(auditLog.action, input.action));
	}
	if (input.from) {
		conditions.push(gte(auditLog.createdAt, input.from));
	}
	if (input.to) {
		conditions.push(lte(auditLog.createdAt, input.to));
	}
	if (input.query) {
		const pattern = `%${input.query}%`;
		conditions.push(
			or(
				ilike(auditLog.actorEmail, pattern),
				ilike(auditLog.action, pattern),
				ilike(auditLog.targetType, pattern),
				ilike(auditLog.targetId, pattern),
				ilike(auditLog.targetDisplay, pattern),
			),
		);
	}
	return conditions.length > 0 ? and(...conditions) : undefined;
}

export const auditRouter = router({
	list: adminProcedure
		.input(listAuditInputSchema)
		.query(async ({ ctx, input }) => {
			const where = listWhere(input);
			const [totalRows, rows] = await Promise.all([
				ctx.db.select({ total: count() }).from(auditLog).where(where),
				ctx.db
					.select({
						id: auditLog.id,
						actorUserId: auditLog.actorUserId,
						actorEmail: auditLog.actorEmail,
						action: auditLog.action,
						targetType: auditLog.targetType,
						targetId: auditLog.targetId,
						targetDisplay: auditLog.targetDisplay,
						reason: auditLog.reason,
						requestIp: auditLog.requestIp,
						createdAt: auditLog.createdAt,
					})
					.from(auditLog)
					.where(where)
					.orderBy(desc(auditLog.createdAt))
					.limit(input.limit)
					.offset(input.offset),
			]);

			return {
				logs: rows,
				total: Number(totalRows[0]?.total ?? 0),
			};
		}),

	get: adminProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.select()
				.from(auditLog)
				.where(eq(auditLog.id, input.id))
				.limit(1);

			if (!row) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Audit log not found",
				});
			}

			return row;
		}),
});
