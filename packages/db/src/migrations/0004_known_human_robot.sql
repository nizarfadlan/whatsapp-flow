ALTER TABLE "webhook_endpoint" ADD COLUMN "tenant_id" text;--> statement-breakpoint
UPDATE "webhook_endpoint" SET "tenant_id" = "user_id" WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "device_access_grant" ADD CONSTRAINT "device_access_grant_device_tenant_fk" FOREIGN KEY ("device_id","tenant_id") REFERENCES "public"."device"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_access_grant" ADD CONSTRAINT "device_access_grant_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_member"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_access_grant" ADD CONSTRAINT "flow_access_grant_flow_tenant_fk" FOREIGN KEY ("flow_id","tenant_id") REFERENCES "public"."flow"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_access_grant" ADD CONSTRAINT "flow_access_grant_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_member"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_id_tenant_unique_idx" ON "device" USING btree ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_id_tenant_unique_idx" ON "flow" USING btree ("id","tenant_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_tenant_created_idx" ON "webhook_endpoint" USING btree ("tenant_id","created_at");