CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."auth_provider_type" AS ENUM('social', 'oidc', 'sso');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"app_name" text DEFAULT 'WhatsApp Flow' NOT NULL,
	"app_tagline" text DEFAULT 'Automation builder' NOT NULL,
	"logo_url" text,
	"favicon_url" text,
	"primary_color" text,
	"support_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_provider_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"type" "auth_provider_type" DEFAULT 'social' NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"client_id" text,
	"client_secret_encrypted" text,
	"client_secret_updated_at" timestamp,
	"issuer_url" text,
	"discovery_url" text,
	"authorization_endpoint" text,
	"token_endpoint" text,
	"userinfo_endpoint" text,
	"jwks_endpoint" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_sign_up" boolean DEFAULT true NOT NULL,
	"override_user_info_on_sign_in" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" "user_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_provider_setting_providerId_idx" ON "auth_provider_setting" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "auth_provider_setting_enabled_sortOrder_idx" ON "auth_provider_setting" USING btree ("enabled","sort_order");