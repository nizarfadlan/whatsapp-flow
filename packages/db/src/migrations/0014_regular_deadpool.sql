CREATE TABLE "audit_export" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"actor_email" text,
	"filters" jsonb NOT NULL,
	"format" text NOT NULL,
	"status" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"from_sequence" bigint,
	"to_sequence" bigint,
	"manifest_hash" text,
	"storage_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "previous_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entry_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "hash_algorithm" text DEFAULT 'sha256-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_export" ADD CONSTRAINT "audit_export_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_export_actor_created_idx" ON "audit_export" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_export_status_idx" ON "audit_export" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_sequence_unique_idx" ON "audit_log" USING btree ("sequence");