import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
	try {
		await pool.query(
			`DROP INDEX IF EXISTS "inbox_thread_device_contact_unique_idx";`,
		);
		await pool.query(
			`CREATE INDEX IF EXISTS "inbox_thread_device_contact_idx" ON "inbox_thread" USING btree ("device_id","contact_number");`,
		);
		console.log("Success!");
	} catch (err) {
		console.error(err);
	} finally {
		pool.end();
	}
}
run();
