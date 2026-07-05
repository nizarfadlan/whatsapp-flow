import { describe, expect, test } from "bun:test";
import { signedMetaWebhookBody } from "../../test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token";
process.env.NODE_ENV = "test";

const { verifyMetaWebhookChallenge, verifyMetaWebhookSignature } = await import(
	"./webhook"
);

describe("Meta webhook verification", () => {
	test("returns the challenge for valid subscription verification", () => {
		expect(
			verifyMetaWebhookChallenge({
				mode: "subscribe",
				verifyToken: "verify-token",
				challenge: "challenge-value",
			}),
		).toBe("challenge-value");
	});

	test("rejects invalid challenge tokens", () => {
		expect(
			verifyMetaWebhookChallenge({
				mode: "subscribe",
				verifyToken: "wrong",
				challenge: "challenge-value",
			}),
		).toBeNull();
	});

	test("verifies X-Hub-Signature-256 payload signatures", () => {
		const body = JSON.stringify({ entry: [] });
		expect(
			verifyMetaWebhookSignature(body, signedMetaWebhookBody(body), "secret"),
		).toBe(true);
		expect(verifyMetaWebhookSignature(body, "sha256=bad", "secret")).toBe(
			false,
		);
		expect(verifyMetaWebhookSignature(body, null, "secret")).toBe(false);
	});
});
