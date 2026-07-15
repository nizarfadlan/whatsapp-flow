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
CREATE TABLE "user_role_assignment" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"assigned_by_user_id" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_assignment_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_key_permission_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permission"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permission_category_idx" ON "permission" USING btree ("category");--> statement-breakpoint
CREATE INDEX "role_key_idx" ON "role" USING btree ("key");--> statement-breakpoint
CREATE INDEX "role_permission_permission_idx" ON "role_permission" USING btree ("permission_key");--> statement-breakpoint
CREATE INDEX "user_role_assignment_role_idx" ON "user_role_assignment" USING btree ("role_id");