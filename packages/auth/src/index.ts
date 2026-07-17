import { createHash } from "node:crypto";
import { createDb } from "@whatsapp-flow/db";
import * as schema from "@whatsapp-flow/db/schema/auth";
import { userInvitation } from "@whatsapp-flow/db/schema/rbac";
import { appSettings } from "@whatsapp-flow/db/schema/settings";
import { env } from "@whatsapp-flow/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins";
import { and, eq, gt, sql } from "drizzle-orm";
import {
	loadGenericOAuthProviderConfigs,
	loadSocialProviderConfig,
} from "./provider-settings";

const APP_SETTINGS_ID = "global";
const signupDisabledMessage = "New account registration is currently disabled";

function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

function hashInviteToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

function signupDisabledError() {
	return new APIError("BAD_REQUEST", { message: signupDisabledMessage });
}

async function isGlobalSignupEnabled(db: ReturnType<typeof createDb>) {
	const [settings] = await db
		.select({ globalSignupEnabled: appSettings.globalSignupEnabled })
		.from(appSettings)
		.where(eq(appSettings.id, APP_SETTINGS_ID))
		.limit(1);

	return settings?.globalSignupEnabled ?? true;
}

async function hasActiveInviteForEmail(
	db: ReturnType<typeof createDb>,
	email: string,
) {
	const [invite] = await db
		.select({ id: userInvitation.id })
		.from(userInvitation)
		.where(
			and(
				eq(userInvitation.status, "pending"),
				gt(userInvitation.expiresAt, new Date()),
				sql`lower(${userInvitation.email}) = ${normalizeEmail(email)}`,
			),
		)
		.limit(1);

	return Boolean(invite);
}

async function hasValidInviteTokenForEmail(
	db: ReturnType<typeof createDb>,
	token: string,
	email: string,
) {
	const [invite] = await db
		.select({ email: userInvitation.email })
		.from(userInvitation)
		.where(
			and(
				eq(userInvitation.tokenHash, hashInviteToken(token)),
				eq(userInvitation.status, "pending"),
				gt(userInvitation.expiresAt, new Date()),
			),
		)
		.limit(1);

	return Boolean(
		invite && normalizeEmail(invite.email) === normalizeEmail(email),
	);
}

export async function createAuth() {
	const db = createDb();
	const genericOAuthConfigs = await loadGenericOAuthProviderConfigs();
	const useSecureCookies =
		env.AUTH_USE_SECURE_COOKIES ?? env.NODE_ENV === "production";

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",

			schema: schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN],
		emailAndPassword: {
			enabled: true,
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== "/sign-up/email") return;

				const email = ctx.body?.email;
				if (typeof email !== "string") return;

				const db = createDb();
				if (await isGlobalSignupEnabled(db)) return;

				const inviteToken = ctx.body?.inviteToken;
				if (
					typeof inviteToken !== "string" ||
					!(await hasValidInviteTokenForEmail(db, inviteToken, email))
				) {
					throw signupDisabledError();
				}
			}),
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						const db = createDb();
						if (await isGlobalSignupEnabled(db)) return;
						if (await hasActiveInviteForEmail(db, user.email)) return;

						throw signupDisabledError();
					},
				},
			},
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
		secret: env.AUTH_SECRET,
		baseURL: env.AUTH_URL,
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
