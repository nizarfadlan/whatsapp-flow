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
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
