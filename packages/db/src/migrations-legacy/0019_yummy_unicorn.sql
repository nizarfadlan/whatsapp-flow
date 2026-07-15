DROP INDEX "flow_session_active_contact_unique_idx";--> statement-breakpoint
DROP INDEX "inbox_thread_device_chat_jid_unique_idx";--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "identity_key" text;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ADD COLUMN "contact_key" text;--> statement-breakpoint
ALTER TABLE "flow_execution_log" ADD COLUMN "contact_key" text;--> statement-breakpoint
ALTER TABLE "flow_session" ADD COLUMN "contact_key" text;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ALTER COLUMN "contact_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "flow_execution_log" ALTER COLUMN "contact_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "flow_session" ALTER COLUMN "contact_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_thread" ADD COLUMN "thread_key" text;--> statement-breakpoint
UPDATE "contact"
SET "identity_key" = CASE
	WHEN "phone_number" IS NOT NULL AND "phone_number" <> '' THEN 'phone:' || regexp_replace("phone_number", '[^0-9]', '', 'g')
	WHEN "jid" LIKE '%@s.whatsapp.net' THEN 'phone:' || regexp_replace(split_part(split_part("jid", '@', 1), ':', 1), '[^0-9]', '', 'g')
	WHEN "lid" IS NOT NULL AND "lid" <> '' THEN 'lid:' || "lid"
	WHEN "jid" LIKE '%@lid' THEN 'lid:' || "jid"
	ELSE 'jid:' || "jid"
END;--> statement-breakpoint
WITH grouped AS (
	SELECT
		"device_id",
		"identity_key",
		(array_agg("id" ORDER BY ("phone_number" IS NOT NULL) DESC, ("lid" IS NOT NULL) DESC, "updated_at" DESC, "created_at" DESC))[1] AS survivor_id,
		max("phone_number") FILTER (WHERE "phone_number" IS NOT NULL AND "phone_number" <> '') AS phone_number,
		max("lid") FILTER (WHERE "lid" IS NOT NULL AND "lid" <> '') AS lid,
		max("provider_contact_id") FILTER (WHERE "provider_contact_id" IS NOT NULL AND "provider_contact_id" <> '') AS provider_contact_id,
		max("name") FILTER (WHERE "name" IS NOT NULL AND "name" <> '') AS name,
		max("push_name") FILTER (WHERE "push_name" IS NOT NULL AND "push_name" <> '') AS push_name,
		max("profile_name") FILTER (WHERE "profile_name" IS NOT NULL AND "profile_name" <> '') AS profile_name
	FROM "contact"
	GROUP BY "device_id", "identity_key"
), duplicate_contacts AS (
	SELECT c."id" AS duplicate_id, g.survivor_id
	FROM "contact" c
	JOIN grouped g ON g."device_id" = c."device_id" AND g."identity_key" = c."identity_key"
	WHERE c."id" <> g.survivor_id
), updated_survivors AS (
	UPDATE "contact" c
	SET
		"phone_number" = COALESCE(c."phone_number", g.phone_number),
		"lid" = COALESCE(c."lid", g.lid),
		"provider_contact_id" = COALESCE(c."provider_contact_id", g.provider_contact_id),
		"name" = COALESCE(c."name", g.name),
		"push_name" = COALESCE(c."push_name", g.push_name),
		"profile_name" = COALESCE(c."profile_name", g.profile_name),
		"updated_at" = now()
	FROM grouped g
	WHERE c."id" = g.survivor_id
	RETURNING c."id"
), repointed_threads AS (
	UPDATE "inbox_thread" t
	SET "contact_id" = d.survivor_id, "updated_at" = now()
	FROM duplicate_contacts d
	WHERE t."contact_id" = d.duplicate_id
	RETURNING t."id"
)
DELETE FROM "contact" c
USING duplicate_contacts d
WHERE c."id" = d.duplicate_id;--> statement-breakpoint
UPDATE "inbox_thread" t
SET "thread_key" = c."identity_key"
FROM "contact" c
WHERE t."chat_type" = 'private' AND c."id" = t."contact_id";--> statement-breakpoint
UPDATE "inbox_thread" t
SET "thread_key" = CASE
	WHEN t."chat_type" = 'private' THEN CASE
		WHEN t."contact_number" IS NOT NULL AND t."contact_number" <> '' THEN 'phone:' || regexp_replace(t."contact_number", '[^0-9]', '', 'g')
		WHEN t."chat_jid" LIKE '%@s.whatsapp.net' THEN 'phone:' || regexp_replace(split_part(split_part(t."chat_jid", '@', 1), ':', 1), '[^0-9]', '', 'g')
		WHEN t."chat_jid" LIKE '%@lid' THEN 'lid:' || t."chat_jid"
		ELSE 'jid:' || COALESCE(t."chat_jid", t."id")
	END
	WHEN t."chat_type" = 'group' THEN 'group:' || COALESCE(t."group_jid", t."chat_jid", t."id")
	WHEN t."chat_type" = 'channel' THEN 'channel:' || COALESCE(t."channel_jid", t."chat_jid", t."id")
	WHEN t."chat_type" = 'broadcast' THEN 'broadcast:' || COALESCE(t."chat_jid", t."id")
	ELSE 'chat:' || COALESCE(t."chat_jid", t."id")
END
WHERE t."thread_key" IS NULL;--> statement-breakpoint
WITH ranked_threads AS (
	SELECT
		"id",
		"device_id",
		"thread_key",
		first_value("id") OVER (
			PARTITION BY "device_id", "thread_key"
			ORDER BY "last_message_at" DESC, "updated_at" DESC, "created_at" DESC
		) AS survivor_id
	FROM "inbox_thread"
), duplicate_threads AS (
	SELECT "id" AS duplicate_id, survivor_id
	FROM ranked_threads
	WHERE "id" <> survivor_id
), deleted_duplicate_messages AS (
	DELETE FROM "inbox_message" m
	USING duplicate_threads d
	WHERE m."thread_id" = d.duplicate_id
		AND m."provider_message_id" IS NOT NULL
		AND EXISTS (
			SELECT 1
			FROM "inbox_message" kept
			WHERE kept."thread_id" = d.survivor_id
				AND kept."provider_message_id" = m."provider_message_id"
		)
	RETURNING m."id"
), moved_messages AS (
	UPDATE "inbox_message" m
	SET "thread_id" = d.survivor_id, "updated_at" = now()
	FROM duplicate_threads d
	WHERE m."thread_id" = d.duplicate_id
	RETURNING m."thread_id"
), refreshed_survivors AS (
	UPDATE "inbox_thread" t
	SET
		"last_message_at" = COALESCE(latest."created_at", t."last_message_at"),
		"last_message_text" = COALESCE(latest."text", t."last_message_text"),
		"unread_count" = counts.unread_count,
		"updated_at" = now()
	FROM (
		SELECT DISTINCT survivor_id FROM duplicate_threads
	) d
	LEFT JOIN LATERAL (
		SELECT "created_at", "text"
		FROM "inbox_message"
		WHERE "thread_id" = d.survivor_id
		ORDER BY "created_at" DESC
		LIMIT 1
	) latest ON true
	LEFT JOIN LATERAL (
		SELECT count(*)::integer AS unread_count
		FROM "inbox_message"
		WHERE "thread_id" = d.survivor_id AND "direction" = 'inbound' AND "read_at" IS NULL
	) counts ON true
	WHERE t."id" = d.survivor_id
	RETURNING t."id"
)
DELETE FROM "inbox_thread" t
USING duplicate_threads d
WHERE t."id" = d.duplicate_id;--> statement-breakpoint
UPDATE "flow_execution_log"
SET "contact_key" = 'phone:' || regexp_replace("contact_number", '[^0-9]', '', 'g');--> statement-breakpoint
UPDATE "flow_session"
SET "contact_key" = 'phone:' || regexp_replace("contact_number", '[^0-9]', '', 'g');--> statement-breakpoint
UPDATE "flow_execution_event"
SET "contact_key" = 'phone:' || regexp_replace("contact_number", '[^0-9]', '', 'g');--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "identity_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "flow_execution_event" ALTER COLUMN "contact_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "flow_execution_log" ALTER COLUMN "contact_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "flow_session" ALTER COLUMN "contact_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_thread" ALTER COLUMN "thread_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_device_identity_key_unique_idx" ON "contact" USING btree ("device_id","identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_device_phone_unique_idx" ON "contact" USING btree ("device_id","phone_number") WHERE "contact"."phone_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_device_lid_unique_idx" ON "contact" USING btree ("device_id","lid") WHERE "contact"."lid" is not null;--> statement-breakpoint
CREATE INDEX "flow_execution_event_device_contact_key_created_idx" ON "flow_execution_event" USING btree ("device_id","contact_key","created_at");--> statement-breakpoint
CREATE INDEX "flow_execution_log_device_contact_key_idx" ON "flow_execution_log" USING btree ("device_id","contact_key");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_session_active_contact_key_unique_idx" ON "flow_session" USING btree ("device_id","contact_key") WHERE "flow_session"."status" in ('waiting', 'running');--> statement-breakpoint
CREATE INDEX "flow_session_contact_key_status_idx" ON "flow_session" USING btree ("device_id","contact_key","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_thread_device_thread_key_unique_idx" ON "inbox_thread" USING btree ("device_id","thread_key");--> statement-breakpoint
CREATE INDEX "inbox_thread_device_chat_jid_idx" ON "inbox_thread" USING btree ("device_id","chat_jid");