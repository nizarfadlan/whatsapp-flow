import { describe, expect, test } from "bun:test";
import type { GroupMetadata } from "baileys";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.NODE_ENV = "test";

const { GroupMetadataStore } = await import("./group-metadata-store");

function groupMetadata(id: string): GroupMetadata {
	return {
		id,
		owner: "owner@s.whatsapp.net",
		subject: "Test group",
		participants: [{ id: "member@s.whatsapp.net", admin: null }],
	};
}

describe("GroupMetadataStore", () => {
	test("only caches complete participant metadata and invalidates per group", async () => {
		const store = new GroupMetadataStore();
		const jid = "123@g.us";

		expect(store.set("device", { id: jid, subject: "partial" })).toBe(false);
		expect(await store.get("device", jid)).toBeUndefined();
		expect(store.set("device", groupMetadata(jid))).toBe(true);
		expect(await store.get("device", jid)).toEqual(groupMetadata(jid));

		store.invalidate("device", jid);
	});

	test("does not return cached metadata while a group is dirty", async () => {
		const store = new GroupMetadataStore();
		const jid = "123@g.us";

		store.set("device", groupMetadata(jid));
		store.invalidateDirty("device", jid);
		expect(await store.get("device", jid)).toBeUndefined();

		store.set("device", groupMetadata(jid));
		expect(await store.get("device", jid)).toEqual(groupMetadata(jid));
	});

	test("invalidates all cached metadata and dirty markers for a disconnected device", async () => {
		const store = new GroupMetadataStore();
		const jid = "123@g.us";
		store.set("device-a", groupMetadata(jid));
		store.set("device-b", groupMetadata(jid));
		store.invalidateDirty("device-a", jid);

		store.invalidateDevice("device-a");
		expect(await store.get("device-b", jid)).toEqual(groupMetadata(jid));
	});
});
