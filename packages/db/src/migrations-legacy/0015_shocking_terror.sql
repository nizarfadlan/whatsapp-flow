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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "user_invitation" ADD CONSTRAINT "user_invitation_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitation" ADD CONSTRAINT "user_invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitation" ADD CONSTRAINT "user_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_invitation_email_idx" ON "user_invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_invitation_status_idx" ON "user_invitation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_invitation_role_idx" ON "user_invitation" USING btree ("role_id");