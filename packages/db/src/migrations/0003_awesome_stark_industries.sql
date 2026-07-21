CREATE TYPE "public"."device_access_capability" AS ENUM('deploy');--> statement-breakpoint
CREATE TYPE "public"."flow_access_capability" AS ENUM('viewer', 'editor');--> statement-breakpoint
CREATE TYPE "public"."tenant_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "device_access_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"capability" "device_access_capability" DEFAULT 'deploy' NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_access_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"capability" "flow_access_capability" NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TABLE "flow_trigger_secret" (
	"flow_id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"rotated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "flow_trigger_secret" ("flow_id", "token_hash")
SELECT
	legacy_tokens."flow_id",
	encode(digest(convert_to(legacy_tokens."token", 'UTF8'), 'sha256'), 'hex')
FROM (
	SELECT
		"flow"."id" AS "flow_id",
		COALESCE(
			NULLIF("flow"."trigger_config" ->> 'webhookToken', ''),
			NULLIF(legacy_node."token", '')
		) AS "token"
	FROM "flow"
	LEFT JOIN LATERAL (
		SELECT node -> 'data' ->> 'webhookToken' AS "token"
		FROM jsonb_array_elements(
			CASE
				WHEN jsonb_typeof("flow"."nodes") = 'array' THEN "flow"."nodes"
				ELSE '[]'::jsonb
			END
		) AS node
		WHERE node -> 'data' ->> 'webhookToken' IS NOT NULL
		LIMIT 1
	) AS legacy_node ON true
	WHERE "flow"."trigger_type" = 'webhook'
) AS legacy_tokens
WHERE legacy_tokens."token" IS NOT NULL
ON CONFLICT ("flow_id") DO NOTHING;--> statement-breakpoint
UPDATE "flow"
SET "trigger_config" = "trigger_config" - 'webhookToken'
WHERE "trigger_type" = 'webhook'
	AND jsonb_typeof("trigger_config") = 'object'
	AND "trigger_config" ? 'webhookToken';--> statement-breakpoint
UPDATE "flow"
SET "nodes" = migrated_nodes."nodes"
FROM (
	SELECT
		"flow"."id",
		jsonb_agg(
			CASE
				WHEN node.value -> 'data' ? 'webhookToken' THEN jsonb_set(
					node.value,
					'{data}',
					(node.value -> 'data') - 'webhookToken'
				)
				ELSE node.value
			END
			ORDER BY node.ordinality
		) AS "nodes"
	FROM "flow"
	CROSS JOIN LATERAL jsonb_array_elements("flow"."nodes") WITH ORDINALITY AS node(value, ordinality)
	WHERE "flow"."trigger_type" = 'webhook'
		AND jsonb_typeof("flow"."nodes") = 'array'
	GROUP BY "flow"."id"
) AS migrated_nodes
WHERE "flow"."id" = migrated_nodes."id"
	AND EXISTS (
		SELECT 1
		FROM jsonb_array_elements("flow"."nodes") AS node
		WHERE node -> 'data' ? 'webhookToken'
	);--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" text,
	"accepted_by_user_id" text,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"revoked_at" timestamp,
	"email_sent_at" timestamp,
	"email_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tenant_member" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "tenant_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "flow" ADD COLUMN "tenant_id" text;--> statement-breakpoint
INSERT INTO "tenant" ("id", "name", "created_by_user_id")
SELECT "id", "name" || '''s workspace', "id"
FROM "user";--> statement-breakpoint
INSERT INTO "tenant_member" ("tenant_id", "user_id", "role")
SELECT "id", "id", 'owner'
FROM "user";--> statement-breakpoint
UPDATE "device" SET "tenant_id" = "user_id" WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "flow" SET "tenant_id" = "user_id" WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "flow" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "device_access_grant" ADD CONSTRAINT "device_access_grant_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_access_grant" ADD CONSTRAINT "device_access_grant_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_access_grant" ADD CONSTRAINT "device_access_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_access_grant" ADD CONSTRAINT "device_access_grant_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_access_grant" ADD CONSTRAINT "flow_access_grant_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_access_grant" ADD CONSTRAINT "flow_access_grant_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_access_grant" ADD CONSTRAINT "flow_access_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_access_grant" ADD CONSTRAINT "flow_access_grant_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_trigger_secret" ADD CONSTRAINT "flow_trigger_secret_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_trigger_secret" ADD CONSTRAINT "flow_trigger_secret_rotated_by_user_id_user_id_fk" FOREIGN KEY ("rotated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitation" ADD CONSTRAINT "tenant_invitation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitation" ADD CONSTRAINT "tenant_invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitation" ADD CONSTRAINT "tenant_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_access_grant_device_user_unique_idx" ON "device_access_grant" USING btree ("device_id","user_id");--> statement-breakpoint
CREATE INDEX "device_access_grant_user_tenant_idx" ON "device_access_grant" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_access_grant_flow_user_unique_idx" ON "flow_access_grant" USING btree ("flow_id","user_id");--> statement-breakpoint
CREATE INDEX "flow_access_grant_user_tenant_idx" ON "flow_access_grant" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_created_by_user_idx" ON "tenant" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "tenant_invitation_tenant_status_idx" ON "tenant_invitation" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "tenant_invitation_email_idx" ON "tenant_invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_member_tenant_user_unique_idx" ON "tenant_member" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_member_user_tenant_idx" ON "tenant_member" USING btree ("user_id","tenant_id");--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow" ADD CONSTRAINT "flow_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_tenantId_idx" ON "device" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "flow_tenant_updatedAt_idx" ON "flow" USING btree ("tenant_id","updated_at");