import { describe, expect, test } from "bun:test";
import { signedMetaWebhookBody } from "../../test/helpers";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token";
process.env.NODE_ENV = "test";

const {
	extractMetaMessageReply,
	extractMetaMessageText,
	verifyMetaWebhookChallenge,
	verifyMetaWebhookSignature,
} = await import("./webhook");

describe("Meta webhook verification", () => {
	test("returns the challenge for valid subscription verification", () => {
		expect(
			verifyMetaWebhookChallenge(
				{
					mode: "subscribe",
					verifyToken: "verify-token",
					challenge: "challenge-value",
				},
				"verify-token",
			),
		).toBe("challenge-value");
	});

	test("rejects invalid challenge tokens", () => {
		expect(
			verifyMetaWebhookChallenge(
				{
					mode: "subscribe",
					verifyToken: "wrong",
					challenge: "challenge-value",
				},
				"verify-token",
			),
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

describe("Meta reply normalization", () => {
	test("normalizes interactive button and list replies", () => {
		expect(
			extractMetaMessageReply({
				interactive: { button_reply: { id: "button-id", title: "Continue" } },
			}),
		).toEqual({
			kind: "button",
			selectedId: "button-id",
			selectedText: "Continue",
		});
		expect(
			extractMetaMessageReply({
				interactive: { list_reply: { id: "row-id", title: "Premium" } },
			}),
		).toEqual({
			kind: "list",
			selectedId: "row-id",
			selectedText: "Premium",
		});
	});

	test("normalizes legacy button payloads while preserving button text", () => {
		const message = { button: { payload: "legacy-id", text: "Legacy choice" } };
		expect(extractMetaMessageText(message)).toBe("Legacy choice");
		expect(extractMetaMessageReply(message)).toEqual({
			kind: "button",
			selectedId: "legacy-id",
			selectedText: "Legacy choice",
		});
	});
});
