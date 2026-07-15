CREATE TABLE "contact_tag" (
	"contact_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "contact_tag_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
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
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tag" ADD CONSTRAINT "group_tag_group_id_chat_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tag" ADD CONSTRAINT "group_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_tag_tag_idx" ON "contact_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "group_tag_tag_idx" ON "group_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_user_name_unique_idx" ON "tag" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "tag_user_idx" ON "tag" USING btree ("user_id");