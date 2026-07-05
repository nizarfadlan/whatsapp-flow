import { describe, expect, test } from "bun:test";
import { redactAuditValue } from "./audit-log";

describe("redactAuditValue", () => {
	test("redacts nested sensitive keys", () => {
		const result = redactAuditValue({
			name: "Webhook",
			accessToken: "token-value",
			nested: {
				clientSecret: "secret-value",
				items: [{ apiKey: "key-value" }, { safe: "visible" }],
			},
		});

		expect(result).toEqual({
			name: "Webhook",
			accessToken: "[REDACTED]",
			nested: {
				clientSecret: "[REDACTED]",
				items: [{ apiKey: "[REDACTED]" }, { safe: "visible" }],
			},
		});
	});

	test("preserves safe metadata and serializes dates", () => {
		const result = redactAuditValue({
			action: "device.connected",
			count: 2,
			at: new Date("2026-01-01T00:00:00.000Z"),
		});

		expect(result).toEqual({
			action: "device.connected",
			count: 2,
			at: "2026-01-01T00:00:00.000Z",
		});
	});
});
