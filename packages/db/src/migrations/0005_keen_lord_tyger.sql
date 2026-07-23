CREATE TYPE "public"."tenant_member_source" AS ENUM('legacy', 'manual', 'invite', 'oidc_jit');--> statement-breakpoint
CREATE TYPE "public"."tenant_member_status" AS ENUM('active', 'suspended', 'removed');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "tenant_member_provenance" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" "tenant_member_source" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_member_provenance_tenant_id_user_id_source_pk" PRIMARY KEY("tenant_id","user_id","source")
);
--> statement-breakpoint
CREATE TABLE "tenant_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_role" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_role_assignment" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"assigned_by_user_id" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_role_assignment_tenant_id_user_id_role_id_pk" PRIMARY KEY("tenant_id","user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_role_permission" (
	"tenant_id" text NOT NULL,
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	CONSTRAINT "tenant_role_permission_tenant_id_role_id_permission_id_pk" PRIMARY KEY("tenant_id","role_id","permission_id")
);
--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "status" "tenant_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "archived_by_user_id" text;--> statement-breakpoint
ALTER TABLE "tenant_member" ADD COLUMN "status" "tenant_member_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
UPDATE "tenant"
SET "slug" = 'org-' || "id"
WHERE "slug" IS NULL;--> statement-breakpoint
INSERT INTO "tenant_member_provenance" ("tenant_id", "user_id", "source")
SELECT "tenant_id", "user_id", 'legacy'
FROM "tenant_member"
ON CONFLICT ("tenant_id", "user_id", "source") DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_permission_id_tenant_unique_idx" ON "tenant_permission" USING btree ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_role_id_tenant_unique_idx" ON "tenant_role" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "tenant_member_provenance" ADD CONSTRAINT "tenant_member_provenance_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_member_provenance" ADD CONSTRAINT "tenant_member_provenance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_member_provenance" ADD CONSTRAINT "tenant_member_provenance_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_member"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_permission" ADD CONSTRAINT "tenant_permission_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role" ADD CONSTRAINT "tenant_role_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_assignment" ADD CONSTRAINT "tenant_role_assignment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_assignment" ADD CONSTRAINT "tenant_role_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_assignment" ADD CONSTRAINT "tenant_role_assignment_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_assignment" ADD CONSTRAINT "tenant_role_assignment_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_member"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_assignment" ADD CONSTRAINT "tenant_role_assignment_role_fk" FOREIGN KEY ("role_id","tenant_id") REFERENCES "public"."tenant_role"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_permission" ADD CONSTRAINT "tenant_role_permission_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_permission" ADD CONSTRAINT "tenant_role_permission_role_fk" FOREIGN KEY ("role_id","tenant_id") REFERENCES "public"."tenant_role"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_permission" ADD CONSTRAINT "tenant_role_permission_permission_fk" FOREIGN KEY ("permission_id","tenant_id") REFERENCES "public"."tenant_permission"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_member_provenance_user_tenant_idx" ON "tenant_member_provenance" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_permission_tenant_key_unique_idx" ON "tenant_permission" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "tenant_permission_tenant_category_idx" ON "tenant_permission" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_role_tenant_key_unique_idx" ON "tenant_role" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "tenant_role_tenant_idx" ON "tenant_role" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_role_assignment_role_idx" ON "tenant_role_assignment" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX "tenant_role_assignment_user_tenant_idx" ON "tenant_role_assignment" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_role_permission_permission_idx" ON "tenant_role_permission" USING btree ("tenant_id","permission_id");--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_archived_by_user_id_user_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_status_idx" ON "tenant" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tenant_member_tenant_status_idx" ON "tenant_member" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_slug_unique" UNIQUE("slug");--> statement-breakpoint
WITH permission_definitions("key", "description", "category") AS (
	VALUES
		('organization.members.read', 'View organization members', 'Organization'),
		('organization.members.manage', 'Manage organization members', 'Organization'),
		('organization.roles.read', 'View organization roles', 'Organization'),
		('organization.roles.assign', 'Assign organization roles', 'Organization'),
		('organization.flows.read', 'View organization flows', 'Flows'),
		('organization.flows.manage', 'Manage organization flows', 'Flows'),
		('organization.flows.execute', 'Execute organization flows', 'Flows'),
		('organization.devices.read', 'View organization devices', 'Devices'),
		('organization.devices.manage', 'Manage organization devices', 'Devices'),
		('organization.devices.connect', 'Connect organization devices', 'Devices'),
		('organization.audit.read', 'View organization audit activity', 'Audit')
)
INSERT INTO "tenant_permission" ("id", "tenant_id", "key", "description", "category")
SELECT md5("tenant"."id" || ':organization-permission:' || permission_definitions."key"), "tenant"."id", permission_definitions."key", permission_definitions."description", permission_definitions."category"
FROM "tenant"
CROSS JOIN permission_definitions
ON CONFLICT ("tenant_id", "key") DO UPDATE SET
	"description" = EXCLUDED."description",
	"category" = EXCLUDED."category",
	"updated_at" = now();--> statement-breakpoint
WITH role_definitions("key", "name", "description") AS (
	VALUES
		('owner', 'Owner', 'Full organization administration'),
		('admin', 'Admin', 'Organization administration without ownership'),
		('operator', 'Operator', 'Operate organization flows and devices'),
		('collaborator', 'Collaborator', 'Create and manage organization flows'),
		('auditor', 'Auditor', 'Read-only organization audit access'),
		('viewer', 'Viewer', 'Read-only organization access')
)
INSERT INTO "tenant_role" ("id", "tenant_id", "key", "name", "description", "is_system")
SELECT md5("tenant"."id" || ':organization-role:' || role_definitions."key"), "tenant"."id", role_definitions."key", role_definitions."name", role_definitions."description", true
FROM "tenant"
CROSS JOIN role_definitions
ON CONFLICT ("tenant_id", "key") DO UPDATE SET
	"name" = EXCLUDED."name",
	"description" = EXCLUDED."description",
	"is_system" = true,
	"updated_at" = now();--> statement-breakpoint
WITH role_permissions("role_key", "permission_key") AS (
	VALUES
		('owner', 'organization.members.read'),
		('owner', 'organization.members.manage'),
		('owner', 'organization.roles.read'),
		('owner', 'organization.roles.assign'),
		('owner', 'organization.flows.read'),
		('owner', 'organization.flows.manage'),
		('owner', 'organization.flows.execute'),
		('owner', 'organization.devices.read'),
		('owner', 'organization.devices.manage'),
		('owner', 'organization.devices.connect'),
		('owner', 'organization.audit.read'),
		('admin', 'organization.members.read'),
		('admin', 'organization.members.manage'),
		('admin', 'organization.roles.read'),
		('admin', 'organization.roles.assign'),
		('admin', 'organization.flows.read'),
		('admin', 'organization.flows.manage'),
		('admin', 'organization.flows.execute'),
		('admin', 'organization.devices.read'),
		('admin', 'organization.devices.manage'),
		('admin', 'organization.devices.connect'),
		('admin', 'organization.audit.read'),
		('operator', 'organization.flows.read'),
		('operator', 'organization.flows.execute'),
		('operator', 'organization.devices.read'),
		('operator', 'organization.devices.connect'),
		('collaborator', 'organization.flows.read'),
		('collaborator', 'organization.flows.manage'),
		('collaborator', 'organization.flows.execute'),
		('collaborator', 'organization.devices.read'),
		('auditor', 'organization.audit.read'),
		('auditor', 'organization.flows.read'),
		('auditor', 'organization.devices.read'),
		('viewer', 'organization.flows.read'),
		('viewer', 'organization.devices.read')
), system_role_ids AS (
	SELECT "tenant_id", "id", "key"
	FROM "tenant_role"
	WHERE "is_system" = true
), permission_ids AS (
	SELECT "tenant_id", "id", "key"
	FROM "tenant_permission"
)
INSERT INTO "tenant_role_permission" ("tenant_id", "role_id", "permission_id")
SELECT system_role_ids."tenant_id", system_role_ids."id", permission_ids."id"
FROM role_permissions
INNER JOIN system_role_ids ON system_role_ids."key" = role_permissions."role_key"
INNER JOIN permission_ids ON permission_ids."tenant_id" = system_role_ids."tenant_id" AND permission_ids."key" = role_permissions."permission_key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "tenant_role_assignment" ("tenant_id", "user_id", "role_id")
SELECT tenant_member."tenant_id", tenant_member."user_id", tenant_role."id"
FROM "tenant_member"
INNER JOIN "tenant_role" ON tenant_role."tenant_id" = tenant_member."tenant_id"
	AND tenant_role."key" = CASE WHEN tenant_member."role" = 'owner' THEN 'owner' ELSE 'collaborator' END
WHERE tenant_member."status" = 'active'
ON CONFLICT DO NOTHING;