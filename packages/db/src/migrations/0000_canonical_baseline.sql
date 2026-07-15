CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."channel_source" AS ENUM('sync', 'manual');--> statement-breakpoint
CREATE TYPE "public"."contact_source" AS ENUM('sync', 'manual', 'message');--> statement-breakpoint
CREATE TYPE "public"."group_participant_role" AS ENUM('member', 'admin', 'superadmin');--> statement-breakpoint
CREATE TYPE "public"."group_source" AS ENUM('sync', 'manual');--> statement-breakpoint
CREATE TYPE "public"."device_provider" AS ENUM('baileys', 'meta_cloud');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('disconnected', 'connecting', 'connected', 'banned');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('running', 'waiting', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."flow_session_status" AS ENUM('waiting', 'running', 'completed', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."flow_status" AS ENUM('draft', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."trigger_type" AS ENUM('keyword', 'any_message', 'webhook', 'schedule');--> statement-breakpoint
CREATE TYPE "public"."chat_type" AS ENUM('private', 'group', 'channel', 'broadcast');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."auth_provider_type" AS ENUM('social', 'oidc', 'sso');--> statement-breakpoint
CREATE TYPE "public"."device_sync_mode" AS ENUM('normal', 'repair');--> statement-breakpoint
CREATE TYPE "public"."device_sync_resource" AS ENUM('contacts', 'groups', 'newsletters');--> statement-breakpoint
CREATE TYPE "public"."device_sync_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "audit_export" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"actor_email" text,
	"filters" jsonb NOT NULL,
	"format" text NOT NULL,
	"status" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"from_sequence" bigint,
	"to_sequence" bigint,
	"manifest_hash" text,
	"storage_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"actor_user_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"target_display" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_ip" text,
	"request_user_agent" text,
	"metadata" jsonb,
	"previous_hash" text,
	"entry_hash" text,
	"hash_algorithm" text DEFAULT 'sha256-v1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"suspended_at" timestamp,
	"suspended_by_user_id" text,
	"suspension_reason" text,
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
CREATE TABLE "chat_group" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"jid" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"owner_jid" text,
	"participant_count" integer DEFAULT 0 NOT NULL,
	"is_member" boolean DEFAULT true NOT NULL,
	"source" "group_source" DEFAULT 'sync' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"jid" text NOT NULL,
	"identity_key" text NOT NULL,
	"phone_number" text,
	"name" text,
	"push_name" text,
	"profile_name" text,
	"provider_contact_id" text,
	"is_wa_contact" boolean DEFAULT true NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"source" "contact_source" DEFAULT 'sync' NOT NULL,
	"avatar_url" text,
	"lid" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tag" (
	"contact_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "contact_tag_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "group_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"jid" text NOT NULL,
	"role" "group_participant_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_tag" (
	"group_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "group_tag_group_id_tag_id_pk" PRIMARY KEY("group_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" "device_provider" DEFAULT 'baileys' NOT NULL,
	"external_id" text,
	"phone_number" text,
	"business_account_id" text,
	"display_phone_number" text,
	"status" "device_status" DEFAULT 'disconnected' NOT NULL,
	"status_reason" text,
	"last_error" text,
	"session_data" jsonb,
	"provider_config" jsonb,
	"capabilities" jsonb,
	"last_connected_at" timestamp,
	"last_webhook_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "flow_execution_event" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_log_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"device_id" text NOT NULL,
	"session_id" text,
	"contact_number" text,
	"contact_key" text NOT NULL,
	"type" text NOT NULL,
	"node_id" text,
	"message" text,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_execution_log" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"device_id" text NOT NULL,
	"contact_number" text,
	"contact_key" text NOT NULL,
	"trigger_source" text DEFAULT 'message' NOT NULL,
	"status" "execution_status" DEFAULT 'running' NOT NULL,
	"error" text,
	"node_results" jsonb DEFAULT '[]' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "flow_node_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"node_id" text NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_session" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"device_id" text NOT NULL,
	"contact_number" text,
	"contact_key" text NOT NULL,
	"execution_log_id" text NOT NULL,
	"status" "flow_session_status" DEFAULT 'waiting' NOT NULL,
	"waiting_node_id" text NOT NULL,
	"next_node_ids" jsonb DEFAULT '[]' NOT NULL,
	"wait_context" jsonb,
	"waiting_provider_message_id" text,
	"variables" jsonb DEFAULT '{}' NOT NULL,
	"node_results" jsonb DEFAULT '[]' NOT NULL,
	"expires_at" timestamp,
	"claim_job_id" text,
	"claimed_at" timestamp,
	"recovery_count" integer DEFAULT 0 NOT NULL,
	"last_recovery_at" timestamp,
	"failure_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "inbox_message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"text" text,
	"provider_message_id" text,
	"delivery_status" text,
	"error" text,
	"raw" jsonb,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"chat_type" "chat_type" DEFAULT 'private' NOT NULL,
	"thread_key" text NOT NULL,
	"chat_jid" text,
	"contact_id" text,
	"group_id" text,
	"group_jid" text,
	"channel_id" text,
	"channel_jid" text,
	"contact_number" text,
	"contact_name" text,
	"last_message_text" text,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "permission" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" text NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "user_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" text,
	"accepted_by_user_id" text,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"revoked_at" timestamp,
	"email_sent_at" timestamp,
	"email_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_role_assignment" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"assigned_by_user_id" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_assignment_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"app_name" text DEFAULT 'WhatsApp Flow' NOT NULL,
	"app_tagline" text DEFAULT 'Automation builder' NOT NULL,
	"logo_url" text,
	"favicon_url" text,
	"primary_color" text,
	"support_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_provider_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"type" "auth_provider_type" DEFAULT 'social' NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"client_id" text,
	"client_secret_encrypted" text,
	"client_secret_updated_at" timestamp,
	"issuer_url" text,
	"discovery_url" text,
	"authorization_endpoint" text,
	"token_endpoint" text,
	"userinfo_endpoint" text,
	"jwks_endpoint" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_sign_up" boolean DEFAULT true NOT NULL,
	"override_user_info_on_sign_in" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smtp_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text,
	"port" integer,
	"secure" boolean DEFAULT false NOT NULL,
	"user" text,
	"password_encrypted" text,
	"password_updated_at" timestamp,
	"from_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"device_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"resource" "device_sync_resource" NOT NULL,
	"scope_key" text DEFAULT 'all' NOT NULL,
	"mode" "device_sync_mode" DEFAULT 'normal' NOT NULL,
	"status" "device_sync_status" DEFAULT 'queued' NOT NULL,
	"job_id" text,
	"claim_attempt" integer,
	"progress" integer DEFAULT 0 NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb,
	"last_error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"status_code" integer,
	"response_body" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"subscribed_events" jsonb DEFAULT '["*"]' NOT NULL,
	"device_ids" jsonb DEFAULT '[]' NOT NULL,
	"flow_ids" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_export" ADD CONSTRAINT "audit_export_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baileys_message_content" ADD CONSTRAINT "baileys_message_content_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group" ADD CONSTRAINT "chat_group_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_participant" ADD CONSTRAINT "group_participant_group_id_chat_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tag" ADD CONSTRAINT "group_tag_group_id_chat_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tag" ADD CONSTRAINT "group_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_provider_secret" ADD CONSTRAINT "device_provider_secret_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow" ADD CONSTRAINT "flow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow" ADD CONSTRAINT "flow_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ADD CONSTRAINT "flow_execution_event_execution_log_id_flow_execution_log_id_fk" FOREIGN KEY ("execution_log_id") REFERENCES "public"."flow_execution_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ADD CONSTRAINT "flow_execution_event_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ADD CONSTRAINT "flow_execution_event_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ADD CONSTRAINT "flow_execution_event_session_id_flow_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."flow_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_log" ADD CONSTRAINT "flow_execution_log_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_log" ADD CONSTRAINT "flow_execution_log_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_node_secret" ADD CONSTRAINT "flow_node_secret_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_session" ADD CONSTRAINT "flow_session_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_session" ADD CONSTRAINT "flow_session_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_session" ADD CONSTRAINT "flow_session_execution_log_id_flow_execution_log_id_fk" FOREIGN KEY ("execution_log_id") REFERENCES "public"."flow_execution_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_thread_id_inbox_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."inbox_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_thread" ADD CONSTRAINT "inbox_thread_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_thread" ADD CONSTRAINT "inbox_thread_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_thread" ADD CONSTRAINT "inbox_thread_group_id_chat_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_thread" ADD CONSTRAINT "inbox_thread_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_key_permission_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permission"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitation" ADD CONSTRAINT "user_invitation_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitation" ADD CONSTRAINT "user_invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitation" ADD CONSTRAINT "user_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_run" ADD CONSTRAINT "device_sync_run_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_run" ADD CONSTRAINT "device_sync_run_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_run" ADD CONSTRAINT "device_sync_run_job_id_job_queue_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_queue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_id_webhook_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_export_actor_created_idx" ON "audit_export" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_export_status_idx" ON "audit_export" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_sequence_unique_idx" ON "audit_log" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_created_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_status_idx" ON "user" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "baileys_message_content_key_unique_idx" ON "baileys_message_content" USING btree ("device_id","remote_jid","provider_message_id","from_me","participant");--> statement-breakpoint
CREATE INDEX "baileys_message_content_device_timestamp_idx" ON "baileys_message_content" USING btree ("device_id","provider_timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_device_jid_unique_idx" ON "channel" USING btree ("device_id","jid");--> statement-breakpoint
CREATE INDEX "channel_deviceId_idx" ON "channel" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_group_device_jid_unique_idx" ON "chat_group" USING btree ("device_id","jid");--> statement-breakpoint
CREATE INDEX "chat_group_deviceId_idx" ON "chat_group" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_device_identity_key_unique_idx" ON "contact" USING btree ("device_id","identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_device_phone_unique_idx" ON "contact" USING btree ("device_id","phone_number") WHERE "contact"."phone_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_device_lid_unique_idx" ON "contact" USING btree ("device_id","lid") WHERE "contact"."lid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_device_jid_unique_idx" ON "contact" USING btree ("device_id","jid");--> statement-breakpoint
CREATE INDEX "contact_deviceId_idx" ON "contact" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "contact_device_phone_idx" ON "contact" USING btree ("device_id","phone_number");--> statement-breakpoint
CREATE INDEX "contact_device_lid_idx" ON "contact" USING btree ("device_id","lid");--> statement-breakpoint
CREATE INDEX "contact_device_provider_contact_idx" ON "contact" USING btree ("device_id","provider_contact_id");--> statement-breakpoint
CREATE INDEX "contact_tag_tag_idx" ON "contact_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_participant_group_jid_unique_idx" ON "group_participant" USING btree ("group_id","jid");--> statement-breakpoint
CREATE INDEX "group_participant_groupId_idx" ON "group_participant" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_tag_tag_idx" ON "group_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_user_name_unique_idx" ON "tag" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "tag_user_idx" ON "tag" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "device_userId_idx" ON "device" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "device_provider_external_idx" ON "device" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "device_user_provider_idx" ON "device" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "device_provider_external_unique_idx" ON "device" USING btree ("provider","external_id") WHERE "device"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "device_provider_secret_device_key_unique_idx" ON "device_provider_secret" USING btree ("device_id","key");--> statement-breakpoint
CREATE INDEX "device_provider_secret_device_idx" ON "device_provider_secret" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "flow_userId_idx" ON "flow" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "flow_deviceId_idx" ON "flow" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "flow_execution_event_log_created_idx" ON "flow_execution_event" USING btree ("execution_log_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_execution_event_flow_created_idx" ON "flow_execution_event" USING btree ("flow_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_execution_event_session_created_idx" ON "flow_execution_event" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_execution_event_device_contact_key_created_idx" ON "flow_execution_event" USING btree ("device_id","contact_key","created_at");--> statement-breakpoint
CREATE INDEX "flow_execution_event_device_contact_created_idx" ON "flow_execution_event" USING btree ("device_id","contact_number","created_at");--> statement-breakpoint
CREATE INDEX "flow_execution_log_flowId_idx" ON "flow_execution_log" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "flow_execution_log_deviceId_idx" ON "flow_execution_log" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "flow_execution_log_device_contact_key_idx" ON "flow_execution_log" USING btree ("device_id","contact_key");--> statement-breakpoint
CREATE INDEX "flow_execution_log_source_status_idx" ON "flow_execution_log" USING btree ("trigger_source","status");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_node_secret_flow_node_key_unique_idx" ON "flow_node_secret" USING btree ("flow_id","node_id","key");--> statement-breakpoint
CREATE INDEX "flow_node_secret_flow_idx" ON "flow_node_secret" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "flow_node_secret_flow_node_idx" ON "flow_node_secret" USING btree ("flow_id","node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_session_active_contact_key_unique_idx" ON "flow_session" USING btree ("device_id","contact_key") WHERE "flow_session"."status" in ('waiting', 'running');--> statement-breakpoint
CREATE INDEX "flow_session_contact_key_status_idx" ON "flow_session" USING btree ("device_id","contact_key","status");--> statement-breakpoint
CREATE INDEX "flow_session_contact_status_idx" ON "flow_session" USING btree ("device_id","contact_number","status");--> statement-breakpoint
CREATE INDEX "flow_session_device_waiting_provider_status_idx" ON "flow_session" USING btree ("device_id","waiting_provider_message_id","status");--> statement-breakpoint
CREATE INDEX "flow_session_flowId_idx" ON "flow_session" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "flow_session_executionLogId_idx" ON "flow_session" USING btree ("execution_log_id");--> statement-breakpoint
CREATE INDEX "flow_session_expiresAt_idx" ON "flow_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "flow_session_claim_job_idx" ON "flow_session" USING btree ("claim_job_id");--> statement-breakpoint
CREATE INDEX "flow_session_status_expiresAt_idx" ON "flow_session" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "flow_session_status_claimedAt_idx" ON "flow_session" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "inbox_message_threadId_idx" ON "inbox_message" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "inbox_message_createdAt_idx" ON "inbox_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inbox_message_provider_message_idx" ON "inbox_message" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_message_thread_provider_message_unique_idx" ON "inbox_message" USING btree ("thread_id","provider_message_id") WHERE "inbox_message"."provider_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_thread_device_thread_key_unique_idx" ON "inbox_thread" USING btree ("device_id","thread_key");--> statement-breakpoint
CREATE INDEX "inbox_thread_device_chat_jid_idx" ON "inbox_thread" USING btree ("device_id","chat_jid");--> statement-breakpoint
CREATE INDEX "inbox_thread_device_contact_idx" ON "inbox_thread" USING btree ("device_id","contact_number");--> statement-breakpoint
CREATE INDEX "inbox_thread_deviceId_idx" ON "inbox_thread" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "inbox_thread_chatType_idx" ON "inbox_thread" USING btree ("chat_type");--> statement-breakpoint
CREATE INDEX "inbox_thread_contactId_idx" ON "inbox_thread" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "inbox_thread_groupId_idx" ON "inbox_thread" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "inbox_thread_channelId_idx" ON "inbox_thread" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "inbox_thread_lastMessageAt_idx" ON "inbox_thread" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "job_queue_status_run_priority_idx" ON "job_queue" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "job_queue_lease_until_idx" ON "job_queue" USING btree ("lease_until");--> statement-breakpoint
CREATE INDEX "job_queue_kind_status_run_idx" ON "job_queue" USING btree ("kind","status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_queue_idempotency_key_unique_idx" ON "job_queue" USING btree ("idempotency_key") WHERE "job_queue"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "permission_category_idx" ON "permission" USING btree ("category");--> statement-breakpoint
CREATE INDEX "role_key_idx" ON "role" USING btree ("key");--> statement-breakpoint
CREATE INDEX "role_permission_permission_idx" ON "role_permission" USING btree ("permission_key");--> statement-breakpoint
CREATE INDEX "user_invitation_email_idx" ON "user_invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_invitation_status_idx" ON "user_invitation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_invitation_role_idx" ON "user_invitation" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_role_assignment_role_idx" ON "user_role_assignment" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_provider_setting_providerId_idx" ON "auth_provider_setting" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "auth_provider_setting_enabled_sortOrder_idx" ON "auth_provider_setting" USING btree ("enabled","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "device_sync_run_active_scope_unique_idx" ON "device_sync_run" USING btree ("device_id","resource","scope_key") WHERE "device_sync_run"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "device_sync_run_request_idx" ON "device_sync_run" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "device_sync_run_device_created_idx" ON "device_sync_run" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "device_sync_run_status_created_idx" ON "device_sync_run" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "device_sync_run_job_idx" ON "device_sync_run" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_endpointId_idx" ON "webhook_delivery" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_status_nextAttemptAt_idx" ON "webhook_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_userId_idx" ON "webhook_endpoint" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_deviceId_idx" ON "webhook_endpoint" USING btree ("device_id");