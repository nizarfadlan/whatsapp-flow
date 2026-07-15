ALTER TABLE "flow_session" ADD COLUMN "claim_job_id" text;--> statement-breakpoint
ALTER TABLE "flow_session" ADD COLUMN "claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "flow_session" ADD COLUMN "recovery_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "flow_session" ADD COLUMN "last_recovery_at" timestamp;--> statement-breakpoint
ALTER TABLE "flow_session" ADD COLUMN "failure_code" text;--> statement-breakpoint
CREATE INDEX "flow_session_claim_job_idx" ON "flow_session" USING btree ("claim_job_id");--> statement-breakpoint
CREATE INDEX "flow_session_status_expiresAt_idx" ON "flow_session" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "flow_session_status_claimedAt_idx" ON "flow_session" USING btree ("status","claimed_at");