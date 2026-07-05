CREATE TYPE "public"."device_provider" AS ENUM('baileys', 'meta_cloud');--> statement-breakpoint
CREATE TABLE "device_provider_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"provider" "device_provider" NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "profile_name" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "provider_contact_id" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "provider" "device_provider" DEFAULT 'baileys' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "business_account_id" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "display_phone_number" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "provider_config" jsonb;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "capabilities" jsonb;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "last_connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "last_webhook_at" timestamp;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN "read_at" timestamp;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "device_provider_secret" ADD CONSTRAINT "device_provider_secret_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_provider_secret_device_key_unique_idx" ON "device_provider_secret" USING btree ("device_id","key");--> statement-breakpoint
CREATE INDEX "device_provider_secret_device_idx" ON "device_provider_secret" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "contact_device_provider_contact_idx" ON "contact" USING btree ("device_id","provider_contact_id");--> statement-breakpoint
CREATE INDEX "device_provider_external_idx" ON "device" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "device_user_provider_idx" ON "device" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "device_provider_external_unique_idx" ON "device" USING btree ("provider","external_id") WHERE "device"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "inbox_message_provider_message_idx" ON "inbox_message" USING btree ("provider_message_id");