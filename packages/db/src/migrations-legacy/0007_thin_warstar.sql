ALTER TABLE "webhook_endpoint" ADD COLUMN "device_ids" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD COLUMN "flow_ids" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE "webhook_endpoint" SET "device_ids" = jsonb_build_array("device_id") WHERE "device_id" IS NOT NULL;