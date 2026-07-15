import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeStorageKey } from "./key";

export type LocalUploadGrantPayload = {
	key: string;
	userId: string;
	mimeType: string;
	maxBytes: number;
	expiresAt: number;
};

function encode(value: Uint8Array | string) {
	return Buffer.from(value).toString("base64url");
}

function sign(encodedPayload: string, secret: string) {
	return encode(createHmac("sha256", secret).update(encodedPayload).digest());
}

function isValidPayload(value: unknown): value is LocalUploadGrantPayload {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const payload = value as Record<string, unknown>;
	return (
		typeof payload.key === "string" &&
		typeof payload.userId === "string" &&
		typeof payload.mimeType === "string" &&
		typeof payload.maxBytes === "number" &&
		Number.isSafeInteger(payload.maxBytes) &&
		payload.maxBytes > 0 &&
		typeof payload.expiresAt === "number" &&
		Number.isSafeInteger(payload.expiresAt)
	);
}

export function createLocalUploadGrant(
	payload: LocalUploadGrantPayload,
	secret: string,
): string {
	normalizeStorageKey(payload.key);
	if (!payload.userId || !payload.mimeType || payload.maxBytes <= 0) {
		throw new Error("Invalid local upload grant payload");
	}
	const encodedPayload = encode(JSON.stringify(payload));
	return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyLocalUploadGrant(
	grant: string,
	secret: string,
	expected: Pick<LocalUploadGrantPayload, "key" | "userId" | "mimeType">,
	now = Date.now(),
): LocalUploadGrantPayload | null {
	const [encodedPayload, signature, ...extra] = grant.split(".");
	if (!encodedPayload || !signature || extra.length > 0) return null;
	const expectedSignature = sign(encodedPayload, secret);
	const received = Buffer.from(signature);
	const expectedBytes = Buffer.from(expectedSignature);
	if (
		received.length !== expectedBytes.length ||
		!timingSafeEqual(received, expectedBytes)
	) {
		return null;
	}

	try {
		const payload: unknown = JSON.parse(
			Buffer.from(encodedPayload, "base64url").toString("utf8"),
		);
		if (!isValidPayload(payload) || payload.expiresAt <= now) return null;
		if (
			payload.key !== expected.key ||
			payload.userId !== expected.userId ||
			payload.mimeType !== expected.mimeType
		) {
			return null;
		}
		normalizeStorageKey(payload.key);
		return payload;
	} catch {
		return null;
	}
}
