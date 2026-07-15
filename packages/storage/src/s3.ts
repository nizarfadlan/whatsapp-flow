import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@whatsapp-flow/env/server";
import { normalizeStorageKey } from "./key";
import type {
	PresignedReadableStorage,
	PresignedUpload,
	PresignGetOptions,
	PresignPutOptions,
	StorageDriver,
	StoredObject,
} from "./types";

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

const SAFE_RENDERABLE_CONTENT_TYPES = new Set([
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
	"video/3gpp",
	"video/mp4",
	"audio/mpeg",
	"audio/mp4",
	"audio/ogg",
	"audio/webm",
]);

function safeResponseContentType(contentType: string) {
	const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase();
	return normalized && SAFE_RENDERABLE_CONTENT_TYPES.has(normalized)
		? normalized
		: "application/octet-stream";
}

function safeDownloadName(fileName: string) {
	const normalized = fileName.replace(/[\\/\r\n\0"]/g, "_").trim();
	return normalized.slice(0, 255) || "media";
}

export class S3StorageDriver
	implements StorageDriver, PresignedReadableStorage
{
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
		const safeKey = normalizeStorageKey(key);
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
		options?: PresignPutOptions,
	): Promise<PresignedUpload> {
		const safeKey = normalizeStorageKey(key);
		if (
			!options?.maxBytes ||
			!Number.isSafeInteger(options.maxBytes) ||
			options.maxBytes < 1
		) {
			throw new Error("S3 presigned uploads require a positive maximum size");
		}
		const { url, fields } = await createPresignedPost(this.client, {
			Bucket: this.bucket,
			Key: safeKey,
			Fields: { "Content-Type": contentType },
			Conditions: [
				{ bucket: this.bucket },
				{ key: safeKey },
				{ "Content-Type": contentType },
				["content-length-range", 1, options.maxBytes],
			],
			Expires: expiresInSeconds,
		});
		return {
			key: safeKey,
			uploadUrl: url,
			uploadMethod: "POST",
			fields,
			publicUrl: this.resolveUrl(safeKey),
		};
	}

	async presignGet(
		key: string,
		expiresInSeconds = 60,
		options?: PresignGetOptions,
	): Promise<string> {
		const command = new GetObjectCommand({
			Bucket: this.bucket,
			Key: normalizeStorageKey(key),
			ResponseContentDisposition: `attachment; filename="${safeDownloadName(options?.fileName ?? "media")}"`,
			ResponseContentType: safeResponseContentType(
				options?.contentType ?? "application/octet-stream",
			),
		});
		return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
	}

	resolveUrl(key: string) {
		return publicUrl(normalizeStorageKey(key));
	}
}
