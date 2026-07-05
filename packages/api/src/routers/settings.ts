import { TRPCError } from "@trpc/server";
import { encryptSecret } from "@whatsapp-flow/auth/crypto";
import {
	clearProviderSettingsCache,
	DEFAULT_OIDC_SCOPES,
	isLoadedGenericOAuthProvider,
	isSupportedSocialProvider,
	isValidOidcProviderId,
	PROVIDER_DEFAULT_SCOPES,
	PROVIDER_DISPLAY_NAMES,
	type SupportedSocialProvider,
} from "@whatsapp-flow/auth/provider-settings";
import type { createDb } from "@whatsapp-flow/db";
import { account } from "@whatsapp-flow/db/schema/auth";
import {
	appSettings,
	authProviderSetting,
} from "@whatsapp-flow/db/schema/settings";
import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../index";

const APP_SETTINGS_ID = "global";
const DEFAULT_BRANDING = {
	appName: "WhatsApp Flow",
	appTagline: "Automation builder",
	logoUrl: null,
	faviconUrl: null,
	primaryColor: null,
	supportEmail: null,
};
const OIDC_DISPLAY_NAME = "OIDC Connection";
const THE_SVG_CDN =
	"https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons";
const THE_SVG_DEFAULTS: Partial<
	Record<SupportedSocialProvider, { slug: string; variant: string }>
> = {
	google: { slug: "google", variant: "color.svg" },
	github: { slug: "github", variant: "dark.svg" },
	discord: { slug: "discord", variant: "default.svg" },
	facebook: { slug: "facebook", variant: "default.svg" },
	microsoft: { slug: "microsoft", variant: "color.svg" },
	gitlab: { slug: "gitlab", variant: "default.svg" },
	slack: { slug: "slack", variant: "default.svg" },
	linkedin: { slug: "linkedin", variant: "default.svg" },
	notion: { slug: "notion", variant: "default.svg" },
};

const providerIdSchema = z
	.string()
	.trim()
	.min(1)
	.max(80)
	.regex(/^[a-z0-9][a-z0-9-]*$/, "Invalid provider ID");
const providerTypeSchema = z.enum(["social", "oidc"]);
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const relativeOrHttpsUrlSchema = z.union([
	z.url().refine((value) => value.startsWith("https://"), {
		message: "URL must use HTTPS",
	}),
	z.string().regex(/^\/(?!\/).+/, "URL must be relative or HTTPS"),
]);

function emptyToNull(value: string | null | undefined) {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

const optionalUrlSchema = z
	.string()
	.nullable()
	.optional()
	.transform(emptyToNull)
	.pipe(relativeOrHttpsUrlSchema.nullable());

const optionalHexColorSchema = z
	.string()
	.nullable()
	.optional()
	.transform(emptyToNull)
	.pipe(hexColorSchema.nullable());

const optionalEmailSchema = z
	.string()
	.nullable()
	.optional()
	.transform(emptyToNull)
	.pipe(z.email().nullable());

const optionalHttpsUrlSchema = z
	.string()
	.nullable()
	.optional()
	.transform(emptyToNull)
	.pipe(
		z
			.url()
			.refine((value) => value.startsWith("https://"), {
				message: "URL must use HTTPS",
			})
			.nullable(),
	);

const optionalClientIdSchema = z
	.string()
	.nullable()
	.optional()
	.transform(emptyToNull)
	.pipe(z.string().max(512).nullable());

const optionalClientSecretSchema = z
	.string()
	.max(4096)
	.optional()
	.transform((value) => emptyToNull(value) ?? undefined);

const brandingInputSchema = z.object({
	appName: z.string().trim().min(1).max(80),
	appTagline: z.string().trim().max(140),
	logoUrl: optionalUrlSchema,
	faviconUrl: optionalUrlSchema,
	primaryColor: optionalHexColorSchema,
	supportEmail: optionalEmailSchema,
});

const createOidcProviderInputSchema = z.object({
	displayName: z.string().trim().min(1).max(80),
	sortOrder: z.number().int().min(0).max(999).optional(),
});

const providerInputSchema = z
	.object({
		providerId: providerIdSchema,
		type: providerTypeSchema.default("social"),
		displayName: z.string().trim().min(1).max(80).optional(),
		enabled: z.boolean().optional(),
		clientId: optionalClientIdSchema,
		clientSecret: optionalClientSecretSchema,
		discoveryUrl: optionalHttpsUrlSchema,
		issuerUrl: optionalHttpsUrlSchema,
		authorizationEndpoint: optionalHttpsUrlSchema,
		tokenEndpoint: optionalHttpsUrlSchema,
		userinfoEndpoint: optionalHttpsUrlSchema,
		jwksEndpoint: optionalHttpsUrlSchema,
		iconUrl: optionalUrlSchema,
		scopes: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
		allowSignUp: z.boolean().optional(),
		overrideUserInfoOnSignIn: z.boolean().optional(),
		sortOrder: z.number().int().min(0).max(999).optional(),
	})
	.superRefine((input, ctx) => {
		const isSocialProvider = isSupportedSocialProvider(input.providerId);
		if (input.type === "social" && !isSocialProvider) {
			ctx.addIssue({
				code: "custom",
				path: ["providerId"],
				message: "OAuth providers must use a supported built-in provider",
			});
		}
		if (input.type === "social" && !input.clientId) {
			ctx.addIssue({
				code: "custom",
				path: ["clientId"],
				message: "Client ID is required for OAuth providers",
			});
		}
		if (input.type === "oidc" && !isValidOidcProviderId(input.providerId)) {
			ctx.addIssue({
				code: "custom",
				path: ["providerId"],
				message: "OIDC provider ID is invalid",
			});
		}
		const hasManualEndpoints = Boolean(
			input.authorizationEndpoint &&
				input.tokenEndpoint &&
				input.userinfoEndpoint,
		);
		if (
			input.type === "oidc" &&
			input.enabled &&
			!input.discoveryUrl &&
			!hasManualEndpoints
		) {
			ctx.addIssue({
				code: "custom",
				path: ["discoveryUrl"],
				message:
					"OIDC providers require a discovery URL or authorization/token/userinfo endpoints before enabling",
			});
		}
	});

function providerCustomIconUrl(metadata: Record<string, unknown> | null) {
	const iconUrl = metadata?.iconUrl;
	return typeof iconUrl === "string" && iconUrl.trim().length > 0
		? iconUrl
		: null;
}

function defaultProviderIconUrl(providerId: string) {
	if (!isSupportedSocialProvider(providerId)) return null;
	const icon = THE_SVG_DEFAULTS[providerId];
	return icon ? `${THE_SVG_CDN}/${icon.slug}/${icon.variant}` : null;
}

function providerIconUrl(row: typeof authProviderSetting.$inferSelect) {
	return (
		providerCustomIconUrl(row.metadata) ??
		defaultProviderIconUrl(row.providerId)
	);
}

function providerMetadataWithIconUrl(
	metadata: Record<string, unknown> | null,
	iconUrl: string | null | undefined,
) {
	if (iconUrl === undefined) return metadata;

	const next = { ...(metadata ?? {}) };
	if (iconUrl) {
		next.iconUrl = iconUrl;
	} else {
		delete next.iconUrl;
	}

	return Object.keys(next).length > 0 ? next : null;
}

function safeProvider(row: typeof authProviderSetting.$inferSelect) {
	const customIconUrl = providerCustomIconUrl(row.metadata);

	return {
		id: row.id,
		providerId: row.providerId,
		type: row.type,
		displayName: row.displayName,
		iconUrl: providerIconUrl(row),
		customIconUrl,
		enabled: row.enabled,
		clientId: row.clientId ?? "",
		hasClientSecret: Boolean(row.clientSecretEncrypted),
		clientSecretUpdatedAt: row.clientSecretUpdatedAt,
		discoveryUrl: row.discoveryUrl,
		issuerUrl: row.issuerUrl,
		authorizationEndpoint: row.authorizationEndpoint,
		tokenEndpoint: row.tokenEndpoint,
		userinfoEndpoint: row.userinfoEndpoint,
		jwksEndpoint: row.jwksEndpoint,
		scopes: row.scopes,
		allowSignUp: row.allowSignUp,
		overrideUserInfoOnSignIn: row.overrideUserInfoOnSignIn,
		sortOrder: row.sortOrder,
		callbackUrl: callbackUrl(row.type, row.providerId),
		requiresRestart: row.type === "oidc",
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function callbackUrl(type: string, providerId: string) {
	return type === "oidc"
		? `/api/auth/oauth2/callback/${providerId}`
		: `/api/auth/callback/${providerId}`;
}

function clearProviderCache(providerId: string) {
	if (isSupportedSocialProvider(providerId)) {
		clearProviderSettingsCache(providerId);
	}
}

function slugifyOidcProviderId(displayName: string) {
	const slug = displayName
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
	const base = slug || "connection";
	return `oidc-${base}`.slice(0, 68).replace(/-+$/g, "");
}

async function createUniqueOidcProviderId(
	db: ReturnType<typeof createDb>,
	displayName: string,
) {
	const base = slugifyOidcProviderId(displayName);
	let providerId = base;

	for (let attempt = 0; attempt < 6; attempt += 1) {
		const [existing] = await db
			.select({ id: authProviderSetting.id })
			.from(authProviderSetting)
			.where(eq(authProviderSetting.providerId, providerId))
			.limit(1);

		if (!existing) return providerId;

		const suffix = crypto.randomUUID().slice(0, 8);
		providerId = `${base.slice(0, 59)}-${suffix}`.replace(
			/-+(-[a-f0-9]{8})$/,
			"$1",
		);
	}

	throw new TRPCError({
		code: "CONFLICT",
		message: "Could not generate a unique OIDC provider ID",
	});
}

async function getBranding(db: ReturnType<typeof createDb>) {
	const [row] = await db
		.select()
		.from(appSettings)
		.where(eq(appSettings.id, APP_SETTINGS_ID))
		.limit(1);

	if (!row) return DEFAULT_BRANDING;

	return {
		appName: row.appName,
		appTagline: row.appTagline,
		logoUrl: row.logoUrl,
		faviconUrl: row.faviconUrl,
		primaryColor: row.primaryColor,
		supportEmail: row.supportEmail,
	};
}

export const settingsRouter = router({
	public: publicProcedure.query(async ({ ctx }) => {
		const [branding, providerRows] = await Promise.all([
			getBranding(ctx.db),
			ctx.db
				.select({
					providerId: authProviderSetting.providerId,
					type: authProviderSetting.type,
					displayName: authProviderSetting.displayName,
					metadata: authProviderSetting.metadata,
				})
				.from(authProviderSetting)
				.where(eq(authProviderSetting.enabled, true))
				.orderBy(asc(authProviderSetting.sortOrder)),
		]);

		const providers = providerRows
			.filter((provider) => {
				if (provider.type === "social") {
					return isSupportedSocialProvider(provider.providerId);
				}
				if (provider.type === "oidc") {
					return isLoadedGenericOAuthProvider(provider.providerId);
				}
				return false;
			})
			.map((provider) => ({
				providerId: provider.providerId,
				type: provider.type,
				displayName: provider.displayName,
				iconUrl:
					providerCustomIconUrl(provider.metadata) ??
					defaultProviderIconUrl(provider.providerId),
			}));

		return {
			branding,
			auth: {
				emailPasswordEnabled: true,
				providers,
			},
		};
	}),

	getBranding: adminProcedure.query(async ({ ctx }) => getBranding(ctx.db)),

	updateBranding: adminProcedure
		.input(brandingInputSchema)
		.mutation(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.insert(appSettings)
				.values({
					id: APP_SETTINGS_ID,
					...input,
				})
				.onConflictDoUpdate({
					target: appSettings.id,
					set: {
						...input,
						updatedAt: new Date(),
					},
				})
				.returning();

			return row;
		}),

	listAuthProviders: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.select()
			.from(authProviderSetting)
			.orderBy(asc(authProviderSetting.sortOrder));

		return rows.map(safeProvider);
	}),

	getAuthProvider: adminProcedure
		.input(z.object({ providerId: providerIdSchema }))
		.query(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.select()
				.from(authProviderSetting)
				.where(eq(authProviderSetting.providerId, input.providerId))
				.limit(1);

			return row ? safeProvider(row) : null;
		}),

	createOidcProvider: adminProcedure
		.input(createOidcProviderInputSchema)
		.mutation(async ({ ctx, input }) => {
			const providerId = await createUniqueOidcProviderId(
				ctx.db,
				input.displayName,
			);
			const [row] = await ctx.db
				.insert(authProviderSetting)
				.values({
					id: crypto.randomUUID(),
					providerId,
					type: "oidc",
					displayName: input.displayName,
					enabled: false,
					clientId: null,
					scopes: [...DEFAULT_OIDC_SCOPES],
					allowSignUp: true,
					overrideUserInfoOnSignIn: false,
					sortOrder: input.sortOrder ?? 0,
				})
				.returning();

			if (!row) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "OIDC connection was not created",
				});
			}

			return safeProvider(row);
		}),

	upsertAuthProvider: adminProcedure
		.input(providerInputSchema)
		.mutation(async ({ ctx, input }) => {
			const [existing] = await ctx.db
				.select()
				.from(authProviderSetting)
				.where(eq(authProviderSetting.providerId, input.providerId))
				.limit(1);

			if (input.type === "oidc" && !existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Create the OIDC connection before updating it",
				});
			}

			if (
				input.enabled &&
				(!input.clientId ||
					(!input.clientSecret && !existing?.clientSecretEncrypted))
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Client ID and client secret are required before enabling",
				});
			}

			const encryptedSecret = input.clientSecret
				? encryptSecret(input.clientSecret)
				: undefined;
			const displayName =
				input.displayName ??
				(input.type === "social"
					? PROVIDER_DISPLAY_NAMES[input.providerId as SupportedSocialProvider]
					: (existing?.displayName ?? OIDC_DISPLAY_NAME));
			const scopes =
				input.scopes ??
				(input.type === "social"
					? PROVIDER_DEFAULT_SCOPES[input.providerId as SupportedSocialProvider]
					: [...DEFAULT_OIDC_SCOPES]);
			const oidcFields =
				input.type === "oidc"
					? {
							discoveryUrl: input.discoveryUrl,
							issuerUrl: input.issuerUrl,
							authorizationEndpoint: input.authorizationEndpoint,
							tokenEndpoint: input.tokenEndpoint,
							userinfoEndpoint: input.userinfoEndpoint,
							jwksEndpoint: input.jwksEndpoint,
						}
					: {
							discoveryUrl: null,
							issuerUrl: null,
							authorizationEndpoint: null,
							tokenEndpoint: null,
							userinfoEndpoint: null,
							jwksEndpoint: null,
						};
			const secretUpdates = encryptedSecret
				? {
						clientSecretEncrypted: encryptedSecret,
						clientSecretUpdatedAt: new Date(),
					}
				: {};
			const metadata = providerMetadataWithIconUrl(
				existing?.metadata ?? null,
				input.iconUrl,
			);

			const [row] = await ctx.db
				.insert(authProviderSetting)
				.values({
					id: existing?.id ?? crypto.randomUUID(),
					providerId: input.providerId,
					type: input.type,
					displayName,
					enabled: input.enabled ?? false,
					clientId: input.clientId,
					clientSecretEncrypted: encryptedSecret,
					clientSecretUpdatedAt: encryptedSecret ? new Date() : undefined,
					...oidcFields,
					scopes,
					allowSignUp: input.allowSignUp ?? true,
					overrideUserInfoOnSignIn: input.overrideUserInfoOnSignIn ?? false,
					sortOrder: input.sortOrder ?? 0,
					metadata,
				})
				.onConflictDoUpdate({
					target: authProviderSetting.providerId,
					set: {
						type: input.type,
						displayName,
						enabled: input.enabled ?? existing?.enabled ?? false,
						clientId: input.clientId,
						...oidcFields,
						scopes,
						allowSignUp: input.allowSignUp ?? existing?.allowSignUp ?? true,
						overrideUserInfoOnSignIn:
							input.overrideUserInfoOnSignIn ??
							existing?.overrideUserInfoOnSignIn ??
							false,
						sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
						metadata,
						updatedAt: new Date(),
						...secretUpdates,
					},
				})
				.returning();

			if (!row) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Provider was not saved",
				});
			}

			clearProviderCache(input.providerId);
			return safeProvider(row);
		}),

	toggleAuthProvider: adminProcedure
		.input(z.object({ providerId: providerIdSchema, enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.select()
				.from(authProviderSetting)
				.where(eq(authProviderSetting.providerId, input.providerId))
				.limit(1);

			if (!row) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Provider not found",
				});
			}

			if (input.enabled && (!row.clientId || !row.clientSecretEncrypted)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Client ID and client secret are required before enabling",
				});
			}
			if (
				input.enabled &&
				row.type === "oidc" &&
				!row.discoveryUrl &&
				!(
					row.authorizationEndpoint &&
					row.tokenEndpoint &&
					row.userinfoEndpoint
				)
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"OIDC providers require a discovery URL or authorization/token/userinfo endpoints before enabling",
				});
			}

			const [updated] = await ctx.db
				.update(authProviderSetting)
				.set({ enabled: input.enabled, updatedAt: new Date() })
				.where(eq(authProviderSetting.providerId, input.providerId))
				.returning();

			if (!updated) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Provider status was not updated",
				});
			}

			clearProviderCache(input.providerId);
			return safeProvider(updated);
		}),

	deleteAuthProvider: adminProcedure
		.input(z.object({ providerId: providerIdSchema }))
		.mutation(async ({ ctx, input }) => {
			const [linkedAccounts] = await ctx.db
				.select({ total: count() })
				.from(account)
				.where(eq(account.providerId, input.providerId));

			if ((linkedAccounts?.total ?? 0) > 0) {
				const [updated] = await ctx.db
					.update(authProviderSetting)
					.set({ enabled: false, updatedAt: new Date() })
					.where(eq(authProviderSetting.providerId, input.providerId))
					.returning();

				clearProviderCache(input.providerId);
				return {
					deleted: false,
					provider: updated ? safeProvider(updated) : null,
				};
			}

			await ctx.db
				.delete(authProviderSetting)
				.where(eq(authProviderSetting.providerId, input.providerId));

			clearProviderCache(input.providerId);
			return { deleted: true, provider: null };
		}),
});
