CREATE TYPE "public"."channel_source" AS ENUM('sync', 'manual');--> statement-breakpoint
CREATE TABLE "channel" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"jid" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_jid" text,
	"subscribers_count" integer DEFAULT 0 NOT NULL,
	"is_subscribed" boolean DEFAULT true NOT NULL,
	"verification_status" text,
	"source" "channel_source" DEFAULT 'sync' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "lid" text;--> statement-breakpoint
ALTER TABLE "inbox_thread" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "inbox_thread" ADD COLUMN "channel_jid" text;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_device_jid_unique_idx" ON "channel" USING btree ("device_id","jid");--> statement-breakpoint
CREATE INDEX "channel_deviceId_idx" ON "channel" USING btree ("device_id");--> statement-breakpoint
ALTER TABLE "inbox_thread" ADD CONSTRAINT "inbox_thread_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_device_lid_idx" ON "contact" USING btree ("device_id","lid");--> statement-breakpoint
CREATE INDEX "inbox_thread_channelId_idx" ON "inbox_thread" USING btree ("channel_id");