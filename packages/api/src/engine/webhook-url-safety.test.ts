import { describe, expect, test } from "bun:test";
import { assertSafeOutboundWebhookUrl } from "./webhook-url-safety";

describe("assertSafeOutboundWebhookUrl", () => {
	test("blocks unsafe protocols", async () => {
		await expect(
			assertSafeOutboundWebhookUrl("http://example.com/hook"),
		).rejects.toThrow("Webhook URL must use HTTPS");
	});

	test("blocks localhost", async () => {
		await expect(
			assertSafeOutboundWebhookUrl("https://localhost/hook"),
		).rejects.toThrow("Webhook URL cannot target localhost");
	});

	test("blocks private network IPs", async () => {
		await expect(
			assertSafeOutboundWebhookUrl("https://192.168.1.10/hook"),
		).rejects.toThrow("Webhook URL cannot target private networks");
	});

	test("allows public HTTPS IP URLs", async () => {
		await expect(
			assertSafeOutboundWebhookUrl("https://93.184.216.34/hook"),
		).resolves.toBeUndefined();
	});
});
