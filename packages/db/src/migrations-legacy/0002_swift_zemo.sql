CREATE TYPE "message_direction" AS ENUM ('inbound', 'outbound');
CREATE TABLE "inbox_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"contact_number" text NOT NULL,
	"contact_name" text,
	"last_message_text" text,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "inbox_thread_device_contact_unique_idx" ON "inbox_thread" USING btree ("device_id","contact_number");
CREATE INDEX "inbox_thread_deviceId_idx" ON "inbox_thread" USING btree ("device_id");
CREATE INDEX "inbox_thread_lastMessageAt_idx" ON "inbox_thread" USING btree ("last_message_at");
CREATE TABLE "inbox_message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"text" text,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "inbox_message_threadId_idx" ON "inbox_message" USING btree ("thread_id");
CREATE INDEX "inbox_message_createdAt_idx" ON "inbox_message" USING btree ("created_at");
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_thread_id_inbox_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "inbox_thread"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "inbox_thread" ADD CONSTRAINT "inbox_thread_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE cascade ON UPDATE no action;
