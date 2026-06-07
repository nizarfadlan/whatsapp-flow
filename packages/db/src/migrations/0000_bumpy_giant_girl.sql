CREATE TYPE "public"."device_status" AS ENUM('disconnected', 'connecting', 'connected', 'banned');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('running', 'waiting', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."flow_session_status" AS ENUM('waiting', 'running', 'completed', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."flow_status" AS ENUM('draft', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."trigger_type" AS ENUM('keyword', 'any_message', 'webhook', 'schedule');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"phone_number" text,
	"status" "device_status" DEFAULT 'disconnected' NOT NULL,
	"session_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text,
	"name" text NOT NULL,
	"description" text,
	"nodes" jsonb DEFAULT '[]' NOT NULL,
	"edges" jsonb DEFAULT '[]' NOT NULL,
	"status" "flow_status" DEFAULT 'draft' NOT NULL,
	"trigger_type" "trigger_type" DEFAULT 'keyword' NOT NULL,
	"trigger_config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_execution_log" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"device_id" text NOT NULL,
	"contact_number" text NOT NULL,
	"trigger_source" text DEFAULT 'message' NOT NULL,
	"status" "execution_status" DEFAULT 'running' NOT NULL,
	"error" text,
	"node_results" jsonb DEFAULT '[]' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "flow_session" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"device_id" text NOT NULL,
	"contact_number" text NOT NULL,
	"execution_log_id" text NOT NULL,
	"status" "flow_session_status" DEFAULT 'waiting' NOT NULL,
	"waiting_node_id" text NOT NULL,
	"next_node_ids" jsonb DEFAULT '[]' NOT NULL,
	"variables" jsonb DEFAULT '{}' NOT NULL,
	"node_results" jsonb DEFAULT '[]' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow" ADD CONSTRAINT "flow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow" ADD CONSTRAINT "flow_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_log" ADD CONSTRAINT "flow_execution_log_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_log" ADD CONSTRAINT "flow_execution_log_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_session" ADD CONSTRAINT "flow_session_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_session" ADD CONSTRAINT "flow_session_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_session" ADD CONSTRAINT "flow_session_execution_log_id_flow_execution_log_id_fk" FOREIGN KEY ("execution_log_id") REFERENCES "public"."flow_execution_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "device_userId_idx" ON "device" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "flow_userId_idx" ON "flow" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "flow_deviceId_idx" ON "flow" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "flow_execution_log_flowId_idx" ON "flow_execution_log" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "flow_execution_log_deviceId_idx" ON "flow_execution_log" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "flow_execution_log_source_status_idx" ON "flow_execution_log" USING btree ("trigger_source","status");--> statement-breakpoint
CREATE INDEX "flow_session_contact_status_idx" ON "flow_session" USING btree ("device_id","contact_number","status");--> statement-breakpoint
CREATE INDEX "flow_session_flowId_idx" ON "flow_session" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "flow_session_executionLogId_idx" ON "flow_session" USING btree ("execution_log_id");--> statement-breakpoint
CREATE INDEX "flow_session_expiresAt_idx" ON "flow_session" USING btree ("expires_at");