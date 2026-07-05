import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	clientPrefix: "VITE_",
	client: {
		VITE_SERVER_URL: z.url(),
		VITE_META_APP_ID: z.string().optional(),
		VITE_META_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
	},
	runtimeEnv: (
		import.meta as ImportMeta & { env: Record<string, string | undefined> }
	).env,
	emptyStringAsUndefined: true,
});
