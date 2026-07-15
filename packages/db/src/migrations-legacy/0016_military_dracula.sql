ALTER TABLE "user_invitation" ADD COLUMN "email_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_invitation" ADD COLUMN "email_error" text;