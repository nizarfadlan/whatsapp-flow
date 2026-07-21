import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const authProviderTypeEnum = pgEnum("auth_provider_type", [
	"social",
	"oidc",
	"sso",
]);

export const appSettings = pgTable("app_settings", {
	id: text("id").primaryKey(),
	appName: text("app_name").default("WhatsApp Flow").notNull(),
	appTagline: text("app_tagline").default("Automation builder").notNull(),
	logoUrl: text("logo_url"),
	faviconUrl: text("favicon_url"),
	primaryColor: text("primary_color"),
	supportEmail: text("support_email"),
	globalSignupEnabled: boolean("global_signup_enabled").default(true).notNull(),
	emailPasswordSignupEnabled: boolean("email_password_signup_enabled")
		.default(true)
		.notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const smtpSetting = pgTable("smtp_setting", {
	id: text("id").primaryKey(),
	host: text("host"),
	port: integer("port"),
	secure: boolean("secure").default(false).notNull(),
	user: text("user"),
	passwordEncrypted: text("password_encrypted"),
	passwordUpdatedAt: timestamp("password_updated_at"),
	fromAddress: text("from_address"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const authProviderSetting = pgTable(
	"auth_provider_setting",
	{
		id: text("id").primaryKey(),
		providerId: text("provider_id").notNull(),
		type: authProviderTypeEnum("type").default("social").notNull(),
		displayName: text("display_name").notNull(),
		enabled: boolean("enabled").default(false).notNull(),
		clientId: text("client_id"),
		clientSecretEncrypted: text("client_secret_encrypted"),
		clientSecretUpdatedAt: timestamp("client_secret_updated_at"),
		issuerUrl: text("issuer_url"),
		discoveryUrl: text("discovery_url"),
		authorizationEndpoint: text("authorization_endpoint"),
		tokenEndpoint: text("token_endpoint"),
		userinfoEndpoint: text("userinfo_endpoint"),
		jwksEndpoint: text("jwks_endpoint"),
		scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
		allowSignUp: boolean("allow_sign_up").default(true).notNull(),
		overrideUserInfoOnSignIn: boolean("override_user_info_on_sign_in")
			.default(false)
			.notNull(),
		sortOrder: integer("sort_order").default(0).notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("auth_provider_setting_providerId_idx").on(table.providerId),
		index("auth_provider_setting_enabled_sortOrder_idx").on(
			table.enabled,
			table.sortOrder,
		),
	],
);
