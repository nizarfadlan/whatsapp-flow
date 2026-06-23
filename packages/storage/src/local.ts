import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env } from "@whatsapp-flow/env/server";
import type { PresignedUpload, StorageDriver, StoredObject } from "./types";

function localDir() {
	return env.LOCAL_UPLOAD_DIR ?? "uploads";
}

function publicBaseUrl() {
	return (env.PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
}

function normalizeKey(key: string) {
	return key.replace(/^\/+/, "").replace(/\.\./g, "");
}

export class LocalStorageDriver implements StorageDriver {
	driver = "local" as const;

	async put(
		key: string,
		data: Uint8Array,
		_contentType: string,
	): Promise<StoredObject> {
		const safeKey = normalizeKey(key);
		const target = join(localDir(), safeKey);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, data);
		return { key: safeKey, url: this.resolveUrl(safeKey) };
	}

	async presignPut(
		key: string,
		_contentType: string,
		_expiresInSeconds?: number,
	): Promise<PresignedUpload> {
		const safeKey = normalizeKey(key);
		return {
			key: safeKey,
			uploadUrl: `${publicBaseUrl()}/api/uploads/local/${safeKey}`,
			publicUrl: this.resolveUrl(safeKey),
		};
	}

	resolveUrl(key: string) {
		return `${publicBaseUrl()}/uploads/${normalizeKey(key)}`;
	}
}
