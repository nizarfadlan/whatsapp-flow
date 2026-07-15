CREATE TABLE "baileys_message_content" (
	"device_id" text NOT NULL,
	"remote_jid" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"from_me" boolean NOT NULL,
	"participant" text DEFAULT '' NOT NULL,
	"content" jsonb NOT NULL,
	"provider_timestamp" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "baileys_message_content" ADD CONSTRAINT "baileys_message_content_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "baileys_message_content_key_unique_idx" ON "baileys_message_content" USING btree ("device_id","remote_jid","provider_message_id","from_me","participant");--> statement-breakpoint
CREATE INDEX "baileys_message_content_device_timestamp_idx" ON "baileys_message_content" USING btree ("device_id","provider_timestamp");