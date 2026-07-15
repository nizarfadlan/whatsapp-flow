CREATE TYPE "public"."device_sync_mode" AS ENUM('normal', 'repair');--> statement-breakpoint
CREATE TYPE "public"."device_sync_resource" AS ENUM('contacts', 'groups', 'newsletters');--> statement-breakpoint
CREATE TYPE "public"."device_sync_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "device_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"device_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"resource" "device_sync_resource" NOT NULL,
	"scope_key" text DEFAULT 'all' NOT NULL,
	"mode" "device_sync_mode" DEFAULT 'normal' NOT NULL,
	"status" "device_sync_status" DEFAULT 'queued' NOT NULL,
	"job_id" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb,
	"last_error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_sync_run" ADD CONSTRAINT "device_sync_run_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_run" ADD CONSTRAINT "device_sync_run_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_run" ADD CONSTRAINT "device_sync_run_job_id_job_queue_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_queue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_sync_run_active_scope_unique_idx" ON "device_sync_run" USING btree ("device_id","resource","scope_key") WHERE "device_sync_run"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "device_sync_run_request_idx" ON "device_sync_run" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "device_sync_run_device_created_idx" ON "device_sync_run" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "device_sync_run_status_created_idx" ON "device_sync_run" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "device_sync_run_job_idx" ON "device_sync_run" USING btree ("job_id");