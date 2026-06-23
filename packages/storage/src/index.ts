import { env } from "@whatsapp-flow/env/server";
import { LocalStorageDriver } from "./local";
import { S3StorageDriver } from "./s3";

export type { PresignedUpload, StorageDriver, StoredObject } from "./types";

function hasS3Config() {
	return Boolean(
		env.S3_BUCKET &&
			env.S3_REGION &&
			env.S3_ACCESS_KEY_ID &&
			env.S3_SECRET_ACCESS_KEY,
	);
}

export function createStorageDriver() {
	if (env.STORAGE_DRIVER === "s3") return new S3StorageDriver();
	if (env.STORAGE_DRIVER === "local") return new LocalStorageDriver();
	return hasS3Config() ? new S3StorageDriver() : new LocalStorageDriver();
}

export const storage = createStorageDriver();
