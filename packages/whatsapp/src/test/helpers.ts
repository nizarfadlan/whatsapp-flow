import { expect } from "bun:test";
import { createHmac } from "node:crypto";

export function signedMetaWebhookBody(body: string, appSecret = "secret") {
	return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

export function expectErrorMessage(error: unknown, message: string) {
	expect(error).toBeInstanceOf(Error);
	expect((error as Error).message).toContain(message);
}
