import { createDb } from "@whatsapp-flow/db";
import { authProviderSetting } from "@whatsapp-flow/db/schema/settings";
import { asc, eq } from "drizzle-orm";
import { decryptSecret } from "./crypto";

export const SUPPORTED_SOCIAL_PROVIDERS = [
	"google",
	"github",
	"discord",
	"facebook",
	"microsoft",
	"gitlab",
	"slack",
	"linkedin",
	"notion",
] as const;

export const LEGACY_OIDC_PROVIDER_IDS = ["oidc", "oidc-2", "oidc-3"] as const;
export const DEFAULT_OIDC_SCOPES = ["openid", "email", "profile"] as const;

export type SupportedSocialProvider =
	(typeof SUPPORTED_SOCIAL_PROVIDERS)[number];

export const PROVIDER_DISPLAY_NAMES: Record<SupportedSocialProvider, string> = {
	google: "Google",
	github: "GitHub",
	discord: "Discord",
	facebook: "Facebook",
	microsoft: "Microsoft",
	gitlab: "GitLab",
	slack: "Slack",
	linkedin: "LinkedIn",
	notion: "Notion",
};

export const PROVIDER_DEFAULT_SCOPES: Record<
	SupportedSocialProvider,
	string[]
> = {
	google: ["openid", "email", "profile"],
	github: ["user:email"],
	discord: ["identify", "email"],
	facebook: ["email", "public_profile"],
	microsoft: ["openid", "email", "profile"],
	gitlab: ["read_user"],
	slack: ["openid", "email", "profile"],
	linkedin: ["openid", "profile", "email"],
	notion: [],
};

const PROVIDER_CACHE_TTL_MS = 60_000;

const loadedGenericOAuthProviderIds = new Set<string>();

type CachedProvider = {
	expiresAt: number;
	value: {
		enabled: boolean;
		clientId: string;
		clientSecret: string;
		scope?: string[];
		disableSignUp?: boolean;
		disableImplicitSignUp?: boolean;
		overrideUserInfoOnSignIn?: boolean;
	};
};

const providerCache = new Map<SupportedSocialProvider, CachedProvider>();

type GenericOAuthProviderConfig = {
	providerId: string;
	clientId: string;
	clientSecret: string;
	discoveryUrl?: string;
	issuer?: string;
	authorizationUrl?: string;
	tokenUrl?: string;
	userInfoUrl?: string;
	scopes?: string[];
	disableSignUp?: boolean;
	disableImplicitSignUp?: boolean;
	overrideUserInfo?: boolean;
};

function disabledProvider() {
	return {
		enabled: false,
		clientId: "",
		clientSecret: "",
	};
}

export function isSupportedSocialProvider(
	providerId: string,
): providerId is SupportedSocialProvider {
	return SUPPORTED_SOCIAL_PROVIDERS.includes(
		providerId as SupportedSocialProvider,
	);
}

export function isLegacyOidcProviderId(providerId: string) {
	return LEGACY_OIDC_PROVIDER_IDS.includes(
		providerId as (typeof LEGACY_OIDC_PROVIDER_IDS)[number],
	);
}

export function isValidDynamicOidcProviderId(providerId: string) {
	return /^oidc-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(providerId);
}

export function isValidOidcProviderId(providerId: string) {
	return (
		isLegacyOidcProviderId(providerId) ||
		isValidDynamicOidcProviderId(providerId)
	);
}

export function isLoadedGenericOAuthProvider(providerId: string) {
	return loadedGenericOAuthProviderIds.has(providerId);
}

export function clearProviderSettingsCache(
	providerId?: SupportedSocialProvider,
) {
	if (providerId) {
		providerCache.delete(providerId);
		return;
	}
	providerCache.clear();
}

function hasManualOAuthEndpoints(row: typeof authProviderSetting.$inferSelect) {
	return Boolean(
		row.authorizationEndpoint && row.tokenEndpoint && row.userinfoEndpoint,
	);
}

export async function loadGenericOAuthProviderConfigs() {
	const db = createDb();
	const rows = await db
		.select()
		.from(authProviderSetting)
		.where(eq(authProviderSetting.type, "oidc"))
		.orderBy(asc(authProviderSetting.sortOrder));

	const configs = rows.flatMap((row): GenericOAuthProviderConfig[] => {
		if (!isValidOidcProviderId(row.providerId)) return [];
		if (!row.enabled || !row.clientId || !row.clientSecretEncrypted) return [];
		if (!row.discoveryUrl && !hasManualOAuthEndpoints(row)) return [];

		const config: GenericOAuthProviderConfig = {
			providerId: row.providerId,
			clientId: row.clientId,
			clientSecret: decryptSecret(row.clientSecretEncrypted),
			scopes: row.scopes.length > 0 ? row.scopes : [...DEFAULT_OIDC_SCOPES],
			disableSignUp: !row.allowSignUp,
			disableImplicitSignUp: !row.allowSignUp,
			overrideUserInfo: row.overrideUserInfoOnSignIn,
		};

		if (row.discoveryUrl) config.discoveryUrl = row.discoveryUrl;
		if (row.issuerUrl) config.issuer = row.issuerUrl;
		if (row.authorizationEndpoint) {
			config.authorizationUrl = row.authorizationEndpoint;
		}
		if (row.tokenEndpoint) config.tokenUrl = row.tokenEndpoint;
		if (row.userinfoEndpoint) config.userInfoUrl = row.userinfoEndpoint;

		return [config];
	});

	loadedGenericOAuthProviderIds.clear();
	for (const config of configs) {
		loadedGenericOAuthProviderIds.add(config.providerId);
	}

	return configs;
}

export async function loadSocialProviderConfig(
	providerId: SupportedSocialProvider,
) {
	const cached = providerCache.get(providerId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const db = createDb();
	const [row] = await db
		.select()
		.from(authProviderSetting)
		.where(eq(authProviderSetting.providerId, providerId))
		.orderBy(asc(authProviderSetting.sortOrder))
		.limit(1);

	if (!row?.enabled || !row.clientId || !row.clientSecretEncrypted) {
		const value = disabledProvider();
		providerCache.set(providerId, {
			expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS,
			value,
		});
		return value;
	}

	const value = {
		enabled: true,
		clientId: row.clientId,
		clientSecret: decryptSecret(row.clientSecretEncrypted),
		scope:
			row.scopes.length > 0 ? row.scopes : PROVIDER_DEFAULT_SCOPES[providerId],
		disableSignUp: !row.allowSignUp,
		disableImplicitSignUp: !row.allowSignUp,
		overrideUserInfoOnSignIn: row.overrideUserInfoOnSignIn,
	};

	providerCache.set(providerId, {
		expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS,
		value,
	});

	return value;
}
