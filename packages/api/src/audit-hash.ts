import { createHash } from "node:crypto";

export const auditHashAlgorithm = "sha256-v1";

type AuditHashRow = {
	id: string;
	sequence: number;
	actorUserId: string | null;
	actorEmail: string | null;
	action: string;
	targetType: string;
	targetId: string | null;
	targetDisplay: string | null;
	before: unknown;
	after: unknown;
	reason: string | null;
	requestIp: string | null;
	requestUserAgent: string | null;
	metadata: unknown;
	previousHash: string | null;
	entryHash: string | null;
	hashAlgorithm: string;
	createdAt: Date | string;
};

export function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

export function hashAuditEntry(row: AuditHashRow, previousHash: string | null) {
	return sha256(
		canonicalJson({
			algorithm: auditHashAlgorithm,
			previousHash,
			entry: {
				id: row.id,
				sequence: row.sequence,
				actorUserId: row.actorUserId,
				actorEmail: row.actorEmail,
				action: row.action,
				targetType: row.targetType,
				targetId: row.targetId,
				targetDisplay: row.targetDisplay,
				before: row.before,
				after: row.after,
				reason: row.reason,
				requestIp: row.requestIp,
				requestUserAgent: row.requestUserAgent,
				metadata: row.metadata,
				createdAt:
					row.createdAt instanceof Date
						? row.createdAt.toISOString()
						: row.createdAt,
			},
		}),
	);
}

export function verifyAuditRange(rows: AuditHashRow[]) {
	const failures: Array<{ id: string; sequence: number; reason: string }> = [];
	let previousHash: string | null = rows[0]?.previousHash ?? null;

	for (const row of rows) {
		if (row.hashAlgorithm !== auditHashAlgorithm) {
			failures.push({
				id: row.id,
				sequence: row.sequence,
				reason: "Unsupported hash algorithm",
			});
			previousHash = row.entryHash;
			continue;
		}
		if (row.previousHash !== previousHash) {
			failures.push({
				id: row.id,
				sequence: row.sequence,
				reason: "Previous hash mismatch",
			});
		}
		const expected = hashAuditEntry(row, previousHash);
		if (row.entryHash !== expected) {
			failures.push({
				id: row.id,
				sequence: row.sequence,
				reason: "Entry hash mismatch",
			});
		}
		previousHash = row.entryHash;
	}

	return {
		valid: failures.length === 0,
		failures,
		rowCount: rows.length,
		fromSequence: rows[0]?.sequence ?? null,
		toSequence: rows.at(-1)?.sequence ?? null,
		firstEntryHash: rows[0]?.entryHash ?? null,
		lastEntryHash: rows.at(-1)?.entryHash ?? null,
	};
}

export function hashAuditExportManifest(manifest: unknown) {
	return sha256(canonicalJson(manifest));
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value instanceof Date) return value.toISOString();
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonicalize(item)]),
	);
}

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
