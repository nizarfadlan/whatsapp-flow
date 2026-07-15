ALTER TABLE "flow_session" ADD COLUMN "wait_context" jsonb;--> statement-breakpoint
ALTER TABLE "flow_session" ADD COLUMN "waiting_provider_message_id" text;--> statement-breakpoint
CREATE INDEX "flow_session_device_waiting_provider_status_idx" ON "flow_session" USING btree ("device_id","waiting_provider_message_id","status");