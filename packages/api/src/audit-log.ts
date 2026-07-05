import { auditLog } from "@whatsapp-flow/db/schema/audit";
import type { Context } from "./context";

const sensitiveKeyPattern =
	/(password|secret|token|accessToken|refreshToken|idToken|clientSecret|clientSecretEncrypted|appSecret|encryptedValue|sessionData|creds|keys|authorization|cookie|apiKey|privateKey)/i;

type AuditContext = Pick<
	Context,
	"db" | "session" | "requestIp" | "requestUserAgent"
> & {
	currentUser?: { id: string; email: string };
};

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

export function redactAuditValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactAuditValue);
	if (!value || typeof value !== "object") return value;
	if (value instanceof Date) return value.toISOString();

	const output: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		output[key] = sensitiveKeyPattern.test(key)
			? "[REDACTED]"
			: redactAuditValue(item);
	}
	return output;
}

export async function writeAuditLog(ctx: AuditContext, input: AuditLogInput) {
	await ctx.db.insert(auditLog).values({
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
	});
}
