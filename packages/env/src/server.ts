import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
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
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
