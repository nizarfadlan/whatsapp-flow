import type { createDb } from "@whatsapp-flow/db";
import { auditLog } from "@whatsapp-flow/db/schema/audit";
import { desc, eq, sql } from "drizzle-orm";
import { auditHashAlgorithm, hashAuditEntry } from "./audit-hash";
import type { Context } from "./context";
import { redactSensitiveValue } from "./security/redaction";

type AuditContext = Pick<
	Context,
	"db" | "session" | "requestIp" | "requestUserAgent"
> & {
	currentUser?: { id: string; email: string };
};

type AuditDatabase = Pick<
	ReturnType<typeof createDb>,
	"execute" | "insert" | "select" | "update"
>;

type AuditLogInput = {
	action: string;
	targetType: string;
	targetId?: string | null;
	targetDisplay?: string | null;
	before?: unknown;
	after?: unknown;
	reason?: string | null;
	metadata?: unknown;
};

export const redactAuditValue = redactSensitiveValue;

export async function writeAuditLog(
	ctx: AuditContext,
	input: AuditLogInput,
	db: AuditDatabase = ctx.db,
) {
	const values = {
		id: crypto.randomUUID(),
		actorUserId: ctx.currentUser?.id ?? ctx.session?.user.id ?? null,
		actorEmail: ctx.currentUser?.email ?? ctx.session?.user.email ?? null,
		action: input.action,
		targetType: input.targetType,
		targetId: input.targetId ?? null,
		targetDisplay: input.targetDisplay ?? null,
		before: input.before == null ? null : redactAuditValue(input.before),
		after: input.after == null ? null : redactAuditValue(input.after),
		reason: input.reason ?? null,
		requestIp: ctx.requestIp ?? null,
		requestUserAgent: ctx.requestUserAgent ?? null,
		metadata: input.metadata == null ? null : redactAuditValue(input.metadata),
	};

	const dbWithTransaction = db as typeof db & {
		transaction?: <T>(callback: (tx: typeof db) => Promise<T>) => Promise<T>;
	};

	if (!dbWithTransaction.transaction) {
		await db.insert(auditLog).values(values);
		return;
	}

	await dbWithTransaction.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(994218610)`);
		const [previous] = await tx
			.select({ entryHash: auditLog.entryHash })
			.from(auditLog)
			.orderBy(desc(auditLog.sequence))
			.limit(1);
		const [created] = await tx.insert(auditLog).values(values).returning();
		if (!created) return;
		const previousHash = previous?.entryHash ?? null;
		const entryHash = hashAuditEntry(
			{
				...created,
				previousHash,
				entryHash: null,
				hashAlgorithm: auditHashAlgorithm,
			},
			previousHash,
		);
		await tx
			.update(auditLog)
			.set({ previousHash, entryHash, hashAlgorithm: auditHashAlgorithm })
			.where(eq(auditLog.id, created.id));
	});
}
