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
ALTER TABLE "flow_node_secret" ADD CONSTRAINT "flow_node_secret_flow_id_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flow_node_secret_flow_node_key_unique_idx" ON "flow_node_secret" USING btree ("flow_id","node_id","key");--> statement-breakpoint
CREATE INDEX "flow_node_secret_flow_idx" ON "flow_node_secret" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "flow_node_secret_flow_node_idx" ON "flow_node_secret" USING btree ("flow_id","node_id");