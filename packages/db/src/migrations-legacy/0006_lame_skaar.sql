CREATE TABLE "flow_execution_event" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_log_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"device_id" text NOT NULL,
	"session_id" text,
	"contact_number" text NOT NULL,
	"type" text NOT NULL,
	"node_id" text,
	"message" text,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_execution_event" ADD CONSTRAINT "flow_execution_event_execution_log_id_flow_execution_log_id_fk" FOREIGN KEY ("execution_log_id") REFERENCES "public"."flow_execution_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ADD CONSTRAINT "flow_execution_event_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ADD CONSTRAINT "flow_execution_event_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ADD CONSTRAINT "flow_execution_event_session_id_flow_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."flow_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_execution_event_log_created_idx" ON "flow_execution_event" USING btree ("execution_log_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_execution_event_flow_created_idx" ON "flow_execution_event" USING btree ("flow_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_execution_event_session_created_idx" ON "flow_execution_event" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_execution_event_device_contact_created_idx" ON "flow_execution_event" USING btree ("device_id","contact_number","created_at");