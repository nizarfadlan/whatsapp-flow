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
import { device } from "@whatsapp-flow/db/schema/device";
import {
	appSettings,
	authProviderSetting,
	smtpSetting,
} from "@whatsapp-flow/db/schema/settings";
import { env } from "@whatsapp-flow/env/server";
import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { writeAuditLog } from "../audit-log";
import {
	isEnvSmtpConfigured,
	SMTP_SETTINGS_ID,
	sendSmtpTestEmail,
} from "../email";
import {
	adminProcedure,
	permissionProcedure,
	publicProcedure,
	router,
} from "../index";

const APP_SETTINGS_ID = "global";
const DEFAULT_BRANDING = {
	appName: "WhatsApp Flow",
	appTagline: "Automation builder",
	logoUrl: null,
	faviconUrl: null,
	primaryColor: null,
	supportEmail: null,
};
const DEFAULT_SIGNUP_SETTINGS = {
	globalSignupEnabled: true,
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

const optionalSmtpTextSchema = z
	.string()
	.nullable()
	.optional()
	.transform(emptyToNull)
	.pipe(z.string().max(512).nullable());

const optionalSmtpHostSchema = z
	.string()
	.nullable()
	.optional()
	.transform(emptyToNull)
	.pipe(z.string().max(253).nullable());

const optionalSmtpPasswordSchema = z
	.string()
	.max(4096)
	.optional()
	.transform((value) => emptyToNull(value) ?? undefined);

const smtpInputSchema = z
	.object({
		host: optionalSmtpHostSchema,
		port: z.coerce.number().int().min(1).max(65535).default(587),
		secure: z.boolean().default(false),
		user: optionalSmtpTextSchema,
		password: optionalSmtpPasswordSchema,
		clearPassword: z.boolean().default(false),
		fromAddress: optionalEmailSchema,
	})
	.superRefine((input, ctx) => {
		const hasDatabaseConfig = Boolean(input.host || input.fromAddress);
		if (!hasDatabaseConfig) return;
		if (!input.host) {
			ctx.addIssue({
				code: "custom",
				path: ["host"],
				message: "SMTP host is required when configuring database SMTP",
			});
		}
		if (!input.fromAddress) {
			ctx.addIssue({
				code: "custom",
				path: ["fromAddress"],
				message: "From email is required when configuring database SMTP",
			});
		}
	});

const smtpTestInputSchema = z.object({
	to: z.email(),
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

async function getSignupSettings(db: ReturnType<typeof createDb>) {
	const [row] = await db
		.select({ globalSignupEnabled: appSettings.globalSignupEnabled })
		.from(appSettings)
		.where(eq(appSettings.id, APP_SETTINGS_ID))
		.limit(1);

	return row ?? DEFAULT_SIGNUP_SETTINGS;
}

async function getSmtpRow(db: ReturnType<typeof createDb>) {
	const [row] = await db
		.select()
		.from(smtpSetting)
		.where(eq(smtpSetting.id, SMTP_SETTINGS_ID))
		.limit(1);
	return row ?? null;
}

function isDatabaseSmtpConfigured(row: typeof smtpSetting.$inferSelect | null) {
	return Boolean(row?.host && row.port && row.fromAddress);
}

function safeSmtpSetting(row: typeof smtpSetting.$inferSelect | null) {
	const databaseConfigured = isDatabaseSmtpConfigured(row);
	const envConfigured = isEnvSmtpConfigured();
	const source = databaseConfigured
		? "database"
		: envConfigured
			? "environment"
			: "none";

	return {
		host: row?.host ?? "",
		port: row?.port ?? 587,
		secure: row?.secure ?? false,
		user: row?.user ?? "",
		fromAddress: row?.fromAddress ?? "",
		hasPassword: Boolean(row?.passwordEncrypted),
		passwordUpdatedAt: row?.passwordUpdatedAt ?? null,
		databaseConfigured,
		envConfigured,
		configured: databaseConfigured || envConfigured,
		source,
	};
}

type EnterpriseAuditStatus = "pass" | "warn" | "fail" | "manual";
type EnterpriseAuditCategory =
	| "security"
	| "reliability"
	| "operations"
	| "data"
	| "auth";

type EnterpriseAuditCheck = {
	id: string;
	category: EnterpriseAuditCategory;
	title: string;
	status: EnterpriseAuditStatus;
	evidence: string;
	recommendation: string;
};

async function createEnterpriseAudit(db: ReturnType<typeof createDb>) {
	const isProduction = env.NODE_ENV === "production";
	const storageDriver = env.STORAGE_DRIVER ?? null;
	const adminEmails =
		env.ADMIN_EMAILS?.split(",")
			.map((email) => email.trim())
			.filter(Boolean) ?? [];
	const smtpStatus = safeSmtpSetting(await getSmtpRow(db));
	const [legacyBaileysRows] = await db
		.select({ total: count() })
		.from(device)
		.where(and(eq(device.provider, "baileys"), isNotNull(device.sessionData)));
	const legacyBaileysSessionCount = Number(legacyBaileysRows?.total ?? 0);
	const checks: EnterpriseAuditCheck[] = [
		{
			id: "runtime-production-mode",
			category: "operations",
			title: "Runtime environment is explicit",
			status: isProduction ? "pass" : "manual",
			evidence: `NODE_ENV is ${env.NODE_ENV}.`,
			recommendation:
				"Run production deployments with NODE_ENV=production and validate environment variables during release.",
		},
		{
			id: "settings-encryption-key",
			category: "security",
			title: "Encrypted secret key is configured",
			status: env.SETTINGS_ENCRYPTION_KEY
				? "pass"
				: isProduction
					? "fail"
					: "warn",
			evidence: env.SETTINGS_ENCRYPTION_KEY
				? "SETTINGS_ENCRYPTION_KEY is present."
				: "SETTINGS_ENCRYPTION_KEY is missing.",
			recommendation:
				"Configure a strong SETTINGS_ENCRYPTION_KEY before storing OAuth, OIDC, Meta, or Baileys encrypted secrets.",
		},
		{
			id: "admin-bootstrap",
			category: "auth",
			title: "Admin bootstrap is configured",
			status: adminEmails.length > 0 ? "pass" : "warn",
			evidence:
				adminEmails.length > 0
					? `${adminEmails.length} ADMIN_EMAILS entr${adminEmails.length === 1 ? "y" : "ies"} configured.`
					: "ADMIN_EMAILS is empty; admin access depends only on persisted user roles.",
			recommendation:
				"Keep at least one audited bootstrap admin path and migrate long-term access to persisted admin roles.",
		},
		{
			id: "storage-driver",
			category: "data",
			title: "Media storage choice is explicit",
			status: !storageDriver && isProduction ? "fail" : "pass",
			evidence: storageDriver
				? `STORAGE_DRIVER is explicitly set to ${storageDriver}.`
				: "STORAGE_DRIVER is not set; development/test may use fallback local storage.",
			recommendation:
				"Set STORAGE_DRIVER explicitly in production. Use S3-compatible storage for durable multi-replica media, or choose local deliberately for OSS/self-hosted single-node deployments.",
		},
		{
			id: "storage-durability",
			category: "data",
			title: "Media storage is production durable",
			status: isProduction && storageDriver === "local" ? "warn" : "pass",
			evidence: `Configured storage driver is ${storageDriver ?? "fallback-local"}.`,
			recommendation:
				"Use S3-compatible durable object storage for production media when running multiple replicas or ephemeral compute.",
		},
		{
			id: "baileys-session-encryption",
			category: "security",
			title: "Baileys session state uses encrypted storage",
			status:
				legacyBaileysSessionCount === 0
					? "pass"
					: isProduction
						? "fail"
						: "warn",
			evidence:
				legacyBaileysSessionCount === 0
					? "No legacy Baileys device.sessionData rows were found."
					: `${legacyBaileysSessionCount} Baileys device.sessionData row${legacyBaileysSessionCount === 1 ? "" : "s"} still need lazy encrypted migration.`,
			recommendation:
				"Reconnect or allow active Baileys devices to save credentials so auth state migrates into encrypted provider-secret storage, then verify no plaintext session rows remain.",
		},
		{
			id: "meta-secret-storage",
			category: "security",
			title: "Meta provider secrets use encrypted storage",
			status: "pass",
			evidence:
				"Meta access tokens and app secrets are stored through the provider-secret encryption path.",
			recommendation:
				"Continue keeping token values server-only and display only non-secret metadata in the UI.",
		},
		{
			id: "meta-graph-timeouts",
			category: "reliability",
			title: "Meta Graph calls have timeout and retry policy",
			status: "pass",
			evidence:
				"Meta Graph requests use bounded AbortSignal timeouts and retry only transient network/status failures.",
			recommendation:
				"Monitor retryable Meta failures and tune timeouts only if production telemetry shows a need.",
		},
		{
			id: "smtp-delivery",
			category: "operations",
			title: "Invite email SMTP delivery is configured",
			status: smtpStatus.configured ? "pass" : "warn",
			evidence: smtpStatus.configured
				? `SMTP delivery is configured through ${smtpStatus.source === "database" ? "database settings" : "environment fallback"}.`
				: "SMTP delivery is not configured; invite links must be copied manually.",
			recommendation:
				"Configure SMTP in Settings or via SMTP_* environment variables so user invitations can be emailed automatically.",
		},
		{
			id: "in-process-dispatchers",
			category: "reliability",
			title: "Dispatchers are in-process",
			status: "warn",
			evidence:
				"Flow and webhook dispatchers run in-process, which can double-run under multiple replicas and lose work on restarts.",
			recommendation:
				"Move flow execution, outbound sends, and webhook delivery to a durable queue/worker model when horizontal scaling becomes required.",
		},
		{
			id: "audit-log",
			category: "operations",
			title: "Sensitive admin actions have immutable audit logs",
			status: "pass",
			evidence:
				"An append-only audit_log table and admin audit router capture user, auth-provider, settings, and device actions.",
			recommendation:
				"Add SIEM/export and tamper-evidence if regulated enterprise deployments require external retention.",
		},
		{
			id: "user-suspension",
			category: "auth",
			title: "Suspended users are blocked server-side",
			status: "pass",
			evidence:
				"User status is enforced in tRPC protected procedures and authenticated Hono endpoints, with session revocation on suspension.",
			recommendation:
				"Add scoped permissions or organization/team roles if enterprise customers need separation of duties beyond admin/member.",
		},
		{
			id: "rbac-depth",
			category: "auth",
			title: "RBAC is coarse grained",
			status: "warn",
			evidence: "Authorization currently uses global admin/member roles.",
			recommendation:
				"Add scoped permissions or organization/team roles if enterprise customers need separation of duties.",
		},
		{
			id: "automated-tests",
			category: "operations",
			title: "Enterprise paths need automated tests",
			status: "manual",
			evidence:
				"No package-level automated test suite was found during repository audit.",
			recommendation:
				"Add integration and contract tests for Meta webhooks, admin auth, user role changes, audit logs, and dispatchers.",
		},
		{
			id: "migration-release-checks",
			category: "operations",
			title: "Migration and deployment checks need CI enforcement",
			status: "manual",
			evidence:
				"Drizzle migrations exist, but production release should explicitly verify pending migrations and env readiness.",
			recommendation:
				"Run migration verification, typecheck, build, and env validation in CI before deploy.",
		},
	];
	const summary = checks.reduce(
		(acc, check) => {
			acc[check.status] += 1;
			return acc;
		},
		{ pass: 0, warn: 0, fail: 0, manual: 0 } satisfies Record<
			EnterpriseAuditStatus,
			number
		>,
	);

	return { generatedAt: new Date(), summary, checks };
}

export const settingsRouter = router({
	public: publicProcedure.query(async ({ ctx }) => {
		const [branding, signupSettings, providerRows] = await Promise.all([
			getBranding(ctx.db),
			getSignupSettings(ctx.db),
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
				globalSignupEnabled: signupSettings.globalSignupEnabled,
				providers,
			},
		};
	}),

	getBranding: adminProcedure.query(async ({ ctx }) => getBranding(ctx.db)),

	getSignupSettings: adminProcedure.query(async ({ ctx }) =>
		getSignupSettings(ctx.db),
	),

	updateSignupSettings: adminProcedure
		.input(z.object({ globalSignupEnabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const before = await getSignupSettings(ctx.db);
			const [row] = await ctx.db
				.insert(appSettings)
				.values({
					id: APP_SETTINGS_ID,
					globalSignupEnabled: input.globalSignupEnabled,
				})
				.onConflictDoUpdate({
					target: appSettings.id,
					set: {
						globalSignupEnabled: input.globalSignupEnabled,
						updatedAt: new Date(),
					},
				})
				.returning({ globalSignupEnabled: appSettings.globalSignupEnabled });

			if (!row) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Signup settings were not saved",
				});
			}

			await writeAuditLog(ctx, {
				action: "settings.global_signup_updated",
				targetType: "settings",
				targetId: APP_SETTINGS_ID,
				targetDisplay: "Account registration",
				before,
				after: row,
			});

			return row;
		}),

	getEnterpriseAudit: adminProcedure.query(async ({ ctx }) =>
		createEnterpriseAudit(ctx.db),
	),

	getSmtpSettings: permissionProcedure("settings.read").query(async ({ ctx }) =>
		safeSmtpSetting(await getSmtpRow(ctx.db)),
	),

	updateSmtpSettings: permissionProcedure("settings.manage")
		.input(smtpInputSchema)
		.mutation(async ({ ctx, input }) => {
			const existing = await getSmtpRow(ctx.db);
			const before = safeSmtpSetting(existing);
			const encryptedPassword = input.password
				? encryptSecret(input.password)
				: undefined;
			const passwordFields = input.clearPassword
				? {
						passwordEncrypted: null,
						passwordUpdatedAt: null,
					}
				: encryptedPassword
					? {
							passwordEncrypted: encryptedPassword,
							passwordUpdatedAt: new Date(),
						}
					: {};

			const [row] = await ctx.db
				.insert(smtpSetting)
				.values({
					id: SMTP_SETTINGS_ID,
					host: input.host,
					port: input.port,
					secure: input.secure,
					user: input.user,
					fromAddress: input.fromAddress,
					passwordEncrypted: encryptedPassword ?? null,
					passwordUpdatedAt: encryptedPassword ? new Date() : null,
				})
				.onConflictDoUpdate({
					target: smtpSetting.id,
					set: {
						host: input.host,
						port: input.port,
						secure: input.secure,
						user: input.user,
						fromAddress: input.fromAddress,
						updatedAt: new Date(),
						...passwordFields,
					},
				})
				.returning();

			if (!row) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "SMTP settings were not saved",
				});
			}

			const after = safeSmtpSetting(row);
			await writeAuditLog(ctx, {
				action: "settings.smtp_updated",
				targetType: "settings",
				targetId: SMTP_SETTINGS_ID,
				targetDisplay: "SMTP settings",
				before,
				after,
				metadata: {
					passwordRotated: Boolean(encryptedPassword),
					passwordCleared: input.clearPassword,
				},
			});

			return after;
		}),

	sendSmtpTestEmail: permissionProcedure("settings.manage")
		.input(smtpTestInputSchema)
		.mutation(async ({ ctx, input }) => {
			const result = await sendSmtpTestEmail(ctx.db, input);
			await writeAuditLog(ctx, {
				action: result.sent
					? "settings.smtp_test_succeeded"
					: "settings.smtp_test_failed",
				targetType: "settings",
				targetId: SMTP_SETTINGS_ID,
				targetDisplay: "SMTP settings",
				metadata: {
					recipient: input.to,
					source: result.source,
					error: result.sent ? null : result.error,
				},
			});
			return result;
		}),

	updateBranding: adminProcedure
		.input(brandingInputSchema)
		.mutation(async ({ ctx, input }) => {
			const before = await getBranding(ctx.db);
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

			await writeAuditLog(ctx, {
				action: "settings.branding_updated",
				targetType: "settings",
				targetId: APP_SETTINGS_ID,
				targetDisplay: "Application branding",
				before,
				after: row,
			});

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

			const provider = safeProvider(row);
			await writeAuditLog(ctx, {
				action: "auth_provider.created",
				targetType: "auth_provider",
				targetId: row.providerId,
				targetDisplay: row.displayName,
				after: provider,
			});

			return provider;
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
			const provider = safeProvider(row);
			await writeAuditLog(ctx, {
				action: existing ? "auth_provider.updated" : "auth_provider.created",
				targetType: "auth_provider",
				targetId: row.providerId,
				targetDisplay: row.displayName,
				before: existing ? safeProvider(existing) : null,
				after: provider,
				metadata: { secretRotated: Boolean(encryptedSecret) },
			});
			return provider;
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
			const provider = safeProvider(updated);
			await writeAuditLog(ctx, {
				action: input.enabled
					? "auth_provider.enabled"
					: "auth_provider.disabled",
				targetType: "auth_provider",
				targetId: updated.providerId,
				targetDisplay: updated.displayName,
				before: safeProvider(row),
				after: provider,
			});
			return provider;
		}),

	deleteAuthProvider: adminProcedure
		.input(z.object({ providerId: providerIdSchema }))
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

			const [linkedAccounts] = await ctx.db
				.select({ total: count() })
				.from(account)
				.where(eq(account.providerId, input.providerId));
			const linkedAccountCount = Number(linkedAccounts?.total ?? 0);

			if (linkedAccountCount > 0) {
				const [updated] = await ctx.db
					.update(authProviderSetting)
					.set({ enabled: false, updatedAt: new Date() })
					.where(eq(authProviderSetting.providerId, input.providerId))
					.returning();

				const provider = updated ? safeProvider(updated) : null;
				clearProviderCache(input.providerId);
				await writeAuditLog(ctx, {
					action: "auth_provider.disabled",
					targetType: "auth_provider",
					targetId: row.providerId,
					targetDisplay: row.displayName,
					before: safeProvider(row),
					after: provider,
					metadata: {
						deleteRequested: true,
						linkedAccounts: linkedAccountCount,
					},
				});
				return {
					deleted: false,
					provider,
				};
			}

			await ctx.db
				.delete(authProviderSetting)
				.where(eq(authProviderSetting.providerId, input.providerId));

			clearProviderCache(input.providerId);
			await writeAuditLog(ctx, {
				action: "auth_provider.deleted",
				targetType: "auth_provider",
				targetId: row.providerId,
				targetDisplay: row.displayName,
				before: safeProvider(row),
			});
			return { deleted: true, provider: null };
		}),
});
