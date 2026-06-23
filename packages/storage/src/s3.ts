import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@whatsapp-flow/env/server";
import type { PresignedUpload, StorageDriver, StoredObject } from "./types";

function requireS3Env() {
	if (
		!env.S3_BUCKET ||
		!env.S3_ACCESS_KEY_ID ||
		!env.S3_SECRET_ACCESS_KEY ||
		!env.S3_REGION
	) {
		throw new Error("S3 storage is not configured");
	}
	return {
		bucket: env.S3_BUCKET,
		region: env.S3_REGION,
		endpoint: env.S3_ENDPOINT,
		accessKeyId: env.S3_ACCESS_KEY_ID,
		secretAccessKey: env.S3_SECRET_ACCESS_KEY,
	};
}

function publicUrl(key: string) {
	const base = env.S3_PUBLIC_URL?.replace(/\/$/, "");
	if (base) return `${base}/${key}`;
	const { bucket, region } = requireS3Env();
	return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function normalizeKey(key: string) {
	return key.replace(/^\/+/, "").replace(/\.\./g, "");
}

export class S3StorageDriver implements StorageDriver {
	driver = "s3" as const;
	private client: S3Client;
	private bucket: string;

	constructor() {
		const config = requireS3Env();
		this.bucket = config.bucket;
		this.client = new S3Client({
			region: config.region,
			endpoint: config.endpoint,
			forcePathStyle: Boolean(config.endpoint),
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
		});
	}

	async put(
		key: string,
		data: Uint8Array,
		contentType: string,
	): Promise<StoredObject> {
		const safeKey = normalizeKey(key);
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: safeKey,
				Body: data,
				ContentType: contentType,
			}),
		);
		return { key: safeKey, url: this.resolveUrl(safeKey) };
	}

	async presignPut(
		key: string,
		contentType: string,
		expiresInSeconds = 300,
	): Promise<PresignedUpload> {
		const safeKey = normalizeKey(key);
		const command = new PutObjectCommand({
			Bucket: this.bucket,
			Key: safeKey,
			ContentType: contentType,
		});
		return {
			key: safeKey,
			uploadUrl: await getSignedUrl(this.client, command, {
				expiresIn: expiresInSeconds,
			}),
			publicUrl: this.resolveUrl(safeKey),
		};
	}

	resolveUrl(key: string) {
		return publicUrl(normalizeKey(key));
	}
}
