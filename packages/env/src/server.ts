import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		BETTER_AUTH_USE_SECURE_COOKIES: z.preprocess((value) => {
			if (value === undefined || value === null || value === "") {
				return undefined;
			}
			if (value === "false" || value === false) return false;
			return true;
		}, z.boolean().optional()),
		SETTINGS_ENCRYPTION_KEY: z.string().optional(),
		ADMIN_EMAILS: z.string().optional(),
		PUBLIC_BASE_URL: z.url().optional(),
		STORAGE_DRIVER: z.enum(["local", "s3"]).optional(),
		LOCAL_UPLOAD_DIR: z.string().optional(),
		S3_ENDPOINT: z.url().optional(),
		S3_REGION: z.string().optional(),
		S3_BUCKET: z.string().optional(),
		S3_ACCESS_KEY_ID: z.string().optional(),
		S3_SECRET_ACCESS_KEY: z.string().optional(),
		S3_PUBLIC_URL: z.url().optional(),
		INBOUND_MEDIA_AUTO_DOWNLOAD: z
			.preprocess((value) => {
				if (value === undefined || value === null || value === "")
					return undefined;
				if (value === "false" || value === false) return false;
				return true;
			}, z.boolean())
			.default(true),
		INBOUND_MEDIA_MAX_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.max(512 * 1024 * 1024)
			.default(64 * 1024 * 1024),
		INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(1_000)
			.max(5 * 60 * 1_000)
			.default(30_000),
		INBOUND_MEDIA_DOWNLOAD_CONCURRENCY: z.coerce
			.number()
			.int()
			.min(1)
			.max(50)
			.default(3),
		META_GRAPH_API_VERSION: z.string().default("v23.0"),
		META_APP_SECRET: z.string().optional(),
		META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
		META_APP_ID: z.string().optional(),
		META_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
		JOB_WORKER_ENABLED: z
			.preprocess((value) => {
				if (value === undefined || value === null || value === "")
					return undefined;
				if (value === "false" || value === false) return false;
				return true;
			}, z.boolean())
			.default(true),
		JOB_WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
		JOB_LEASE_SECONDS: z.coerce.number().int().min(1).default(60),
		METRICS_TOKEN: z.string().optional(),
		SMTP_HOST: z.string().optional(),
		SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
		SMTP_SECURE: z
			.preprocess((value) => {
				if (value === undefined || value === null || value === "") {
					return undefined;
				}
				if (value === "true" || value === true) return true;
				return false;
			}, z.boolean())
			.default(false),
		SMTP_USER: z.string().optional(),
		SMTP_PASSWORD: z.string().optional(),
		SMTP_FROM: z.string().optional(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
