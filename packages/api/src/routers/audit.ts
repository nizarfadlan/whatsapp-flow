import { TRPCError } from "@trpc/server";
import { auditExport, auditLog } from "@whatsapp-flow/db/schema/audit";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	ilike,
	lte,
	or,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import {
	auditHashAlgorithm,
	hashAuditEntry,
	hashAuditExportManifest,
	verifyAuditRange,
} from "../audit-hash";
import { permissionProcedure, router } from "../index";

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

const auditRangeInputSchema = listAuditInputSchema
	.omit({ limit: true, offset: true })
	.extend({ limit: z.number().int().min(1).max(1000).default(500) });

type AuditFilterInput = Pick<
	z.infer<typeof listAuditInputSchema>,
	"actorUserId" | "action" | "from" | "query" | "targetType" | "to"
>;

function listWhere(input: AuditFilterInput) {
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

async function selectAuditRange(
	ctx: { db: typeof import("@whatsapp-flow/db").db },
	input: z.infer<typeof auditRangeInputSchema>,
) {
	return ctx.db
		.select()
		.from(auditLog)
		.where(listWhere(input))
		.orderBy(asc(auditLog.sequence))
		.limit(input.limit);
}

export const auditRouter = router({
	list: permissionProcedure("audit.read")
		.input(listAuditInputSchema)
		.query(async ({ ctx, input }) => {
			const where = listWhere(input);
			const [totalRows, rows] = await Promise.all([
				ctx.db.select({ total: count() }).from(auditLog).where(where),
				ctx.db
					.select({
						id: auditLog.id,
						sequence: auditLog.sequence,
						actorUserId: auditLog.actorUserId,
						actorEmail: auditLog.actorEmail,
						action: auditLog.action,
						targetType: auditLog.targetType,
						targetId: auditLog.targetId,
						targetDisplay: auditLog.targetDisplay,
						reason: auditLog.reason,
						requestIp: auditLog.requestIp,
						entryHash: auditLog.entryHash,
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

	get: permissionProcedure("audit.read")
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

	verifyRange: permissionProcedure("audit.verify")
		.input(auditRangeInputSchema)
		.mutation(async ({ ctx, input }) => {
			const rows = await selectAuditRange(ctx, input);
			return verifyAuditRange(rows);
		}),

	backfillHashes: permissionProcedure("audit.verify").mutation(
		async ({ ctx }) => {
			const dbWithTransaction = ctx.db as typeof ctx.db & {
				transaction?: <T>(
					callback: (tx: typeof ctx.db) => Promise<T>,
				) => Promise<T>;
			};
			if (!dbWithTransaction.transaction) return { updated: 0 };

			return dbWithTransaction.transaction(async (tx) => {
				await tx.execute(sql`select pg_advisory_xact_lock(994218610)`);
				const rows = await tx
					.select()
					.from(auditLog)
					.orderBy(asc(auditLog.sequence));
				let previousHash: string | null = null;
				let updated = 0;
				for (const row of rows) {
					const entryHash = hashAuditEntry(
						{
							...row,
							previousHash,
							entryHash: row.entryHash,
							hashAlgorithm: auditHashAlgorithm,
						},
						previousHash,
					);
					if (
						row.previousHash !== previousHash ||
						row.entryHash !== entryHash
					) {
						await tx
							.update(auditLog)
							.set({
								previousHash,
								entryHash,
								hashAlgorithm: auditHashAlgorithm,
							})
							.where(eq(auditLog.id, row.id));
						updated += 1;
					}
					previousHash = entryHash;
				}
				return { updated };
			});
		},
	),

	exportJson: permissionProcedure("audit.export")
		.input(auditRangeInputSchema)
		.mutation(async ({ ctx, input }) => {
			const rows = await selectAuditRange(ctx, input);
			const verification = verifyAuditRange(rows);
			const manifestWithoutHash = {
				filters: input,
				format: "json",
				generatedAt: new Date().toISOString(),
				rowCount: rows.length,
				fromSequence: verification.fromSequence,
				toSequence: verification.toSequence,
				firstEntryHash: verification.firstEntryHash,
				lastEntryHash: verification.lastEntryHash,
				hashAlgorithm: auditHashAlgorithm,
				verificationValid: verification.valid,
			};
			const manifestHash = hashAuditExportManifest(manifestWithoutHash);
			const manifest = { ...manifestWithoutHash, manifestHash };
			await ctx.db.insert(auditExport).values({
				id: crypto.randomUUID(),
				actorUserId: ctx.currentUser.id,
				actorEmail: ctx.currentUser.email,
				filters: input,
				format: "json",
				status: "completed",
				rowCount: rows.length,
				fromSequence: verification.fromSequence,
				toSequence: verification.toSequence,
				manifestHash,
				completedAt: new Date(),
			});
			return { manifest, entries: rows };
		}),

	listExports: permissionProcedure("audit.export").query(async ({ ctx }) => {
		return ctx.db
			.select()
			.from(auditExport)
			.orderBy(desc(auditExport.createdAt))
			.limit(50);
	}),
});
