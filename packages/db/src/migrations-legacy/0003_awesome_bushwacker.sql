DROP INDEX IF EXISTS "inbox_thread_device_contact_unique_idx";
CREATE INDEX IF EXISTS "inbox_thread_device_contact_idx" ON "inbox_thread" USING btree ("device_id","contact_number");
