import { createDb } from "@whatsapp-flow/db";
import * as schema from "@whatsapp-flow/db/schema/auth";
import { env } from "@whatsapp-flow/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import {
	loadGenericOAuthProviderConfigs,
	loadSocialProviderConfig,
} from "./provider-settings";

export async function createAuth() {
	const db = createDb();
	const genericOAuthConfigs = await loadGenericOAuthProviderConfigs();
	const useSecureCookies =
		env.BETTER_AUTH_USE_SECURE_COOKIES ?? env.NODE_ENV === "production";

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",

			schema: schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN],
		emailAndPassword: {
			enabled: true,
		},
		socialProviders: {
			google: () => loadSocialProviderConfig("google"),
			github: () => loadSocialProviderConfig("github"),
			discord: () => loadSocialProviderConfig("discord"),
			facebook: () => loadSocialProviderConfig("facebook"),
			microsoft: () => loadSocialProviderConfig("microsoft"),
			gitlab: () => loadSocialProviderConfig("gitlab"),
			slack: () => loadSocialProviderConfig("slack"),
			linkedin: () => loadSocialProviderConfig("linkedin"),
			notion: () => loadSocialProviderConfig("notion"),
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		advanced: {
			useSecureCookies,
			defaultCookieAttributes: {
				sameSite: useSecureCookies ? "none" : "lax",
				secure: useSecureCookies,
				httpOnly: true,
			},
		},
		plugins: [
			genericOAuth({
				config: genericOAuthConfigs,
			}),
		],
	});
}

export const auth = await createAuth();
