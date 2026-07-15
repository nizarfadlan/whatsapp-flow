CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp,
	"lease_until" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "job_queue_status_run_priority_idx" ON "job_queue" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "job_queue_lease_until_idx" ON "job_queue" USING btree ("lease_until");--> statement-breakpoint
CREATE INDEX "job_queue_kind_status_run_idx" ON "job_queue" USING btree ("kind","status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_queue_idempotency_key_unique_idx" ON "job_queue" USING btree ("idempotency_key") WHERE "job_queue"."idempotency_key" is not null;