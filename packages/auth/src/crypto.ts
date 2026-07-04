import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@whatsapp-flow/env/server";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function getEncryptionKey() {
	const rawKey = env.SETTINGS_ENCRYPTION_KEY;
	if (!rawKey) {
		throw new Error(
			"SETTINGS_ENCRYPTION_KEY is required to store auth provider secrets",
		);
	}

	const key = Buffer.from(rawKey, "base64");
	if (key.length !== 32) {
		throw new Error(
			"SETTINGS_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
		);
	}

	return key;
}

export function encryptSecret(secret: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(secret, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();

	return [
		VERSION,
		iv.toString("base64"),
		tag.toString("base64"),
		ciphertext.toString("base64"),
	].join(":");
}

export function decryptSecret(envelope: string) {
	const [version, ivRaw, tagRaw, ciphertextRaw] = envelope.split(":");
	if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw) {
		throw new Error("Invalid encrypted secret format");
	}

	const decipher = createDecipheriv(
		ALGORITHM,
		getEncryptionKey(),
		Buffer.from(ivRaw, "base64"),
	);
	decipher.setAuthTag(Buffer.from(tagRaw, "base64"));

	return Buffer.concat([
		decipher.update(Buffer.from(ciphertextRaw, "base64")),
		decipher.final(),
	]).toString("utf8");
}
