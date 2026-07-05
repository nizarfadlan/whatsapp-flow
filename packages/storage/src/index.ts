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

export function storageDriverKind() {
	if (env.STORAGE_DRIVER) return env.STORAGE_DRIVER;
	if (env.NODE_ENV === "production") {
		throw new Error(
			"STORAGE_DRIVER must be explicitly set to 'local' or 's3' in production",
		);
	}
	return hasS3Config() ? "s3" : "local";
}

export function isLocalStorageDriver() {
	return storageDriverKind() === "local";
}

export function createStorageDriver() {
	const kind = storageDriverKind();
	if (kind === "s3") {
		if (!hasS3Config()) {
			throw new Error(
				"STORAGE_DRIVER=s3 requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY",
			);
		}
		return new S3StorageDriver();
	}
	return new LocalStorageDriver();
}

export const storage = createStorageDriver();
