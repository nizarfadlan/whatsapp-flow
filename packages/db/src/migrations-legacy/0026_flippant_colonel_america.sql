DROP INDEX "tag_user_name_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "tag_user_name_unique_idx" ON "tag" USING btree ("user_id",lower("name"));