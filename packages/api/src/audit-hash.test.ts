import { describe, expect, test } from "bun:test";
import { hashAuditEntry, verifyAuditRange } from "./audit-hash";

function auditRow(
	overrides: Partial<Parameters<typeof hashAuditEntry>[0]> = {},
) {
	return {
		id: "audit-1",
		sequence: 1,
		actorUserId: "user-1",
		actorEmail: "admin@example.com",
		action: "user.updated",
		targetType: "user",
		targetId: "target-1",
		targetDisplay: "target@example.com",
		before: { role: "member" },
		after: { role: "admin" },
		reason: null,
		requestIp: "127.0.0.1",
		requestUserAgent: "bun-test",
		metadata: { safe: true },
		previousHash: null,
		entryHash: null,
		hashAlgorithm: "sha256-v1",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	};
}

describe("audit hash chain", () => {
	test("verifies a valid chained range", () => {
		const first = auditRow();
		const firstHash = hashAuditEntry(first, null);
		const second = auditRow({
			id: "audit-2",
			sequence: 2,
			previousHash: firstHash,
			createdAt: new Date("2026-01-01T00:01:00.000Z"),
		});
		const secondHash = hashAuditEntry(second, firstHash);

		const result = verifyAuditRange([
			{ ...first, entryHash: firstHash },
			{ ...second, entryHash: secondHash },
		]);

		expect(result.valid).toBe(true);
		expect(result.rowCount).toBe(2);
		expect(result.fromSequence).toBe(1);
		expect(result.toSequence).toBe(2);
	});

	test("detects tampered audited fields", () => {
		const first = auditRow();
		const firstHash = hashAuditEntry(first, null);
		const second = auditRow({
			id: "audit-2",
			sequence: 2,
			previousHash: firstHash,
			createdAt: new Date("2026-01-01T00:01:00.000Z"),
		});
		const secondHash = hashAuditEntry(second, firstHash);

		const result = verifyAuditRange([
			{ ...first, entryHash: firstHash },
			{ ...second, action: "user.deleted", entryHash: secondHash },
		]);

		expect(result.valid).toBe(false);
		expect(result.failures).toContainEqual({
			id: "audit-2",
			sequence: 2,
			reason: "Entry hash mismatch",
		});
	});
});
