import { describe, expect, test } from "bun:test";
import type { proto, WAMessageKey } from "baileys";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.NODE_ENV = "test";

const {
	BoundedDeviceCache,
	getMessageCacheKey,
	reviveMessageContent,
	serializeMessageContent,
} = await import("./baileys-message-store");

describe("Baileys message cache", () => {
	test("separates full message key dimensions", () => {
		const baseKey: WAMessageKey = {
			remoteJid: "123@g.us",
			id: "message-id",
			fromMe: false,
		};

		expect(getMessageCacheKey(baseKey)).not.toBe(
			getMessageCacheKey({ ...baseKey, participant: "first@s.whatsapp.net" }),
		);
		expect(getMessageCacheKey(baseKey)).not.toBe(
			getMessageCacheKey({ ...baseKey, fromMe: true }),
		);
		expect(
			getMessageCacheKey({
				...baseKey,
				fromMe: true,
				participant: "retrying-device:1@s.whatsapp.net",
			}),
		).toBe(getMessageCacheKey({ ...baseKey, fromMe: true }));
		expect(
			getMessageCacheKey({ ...baseKey, participant: undefined }),
		).toContain('"participant":""');
	});

	test("bounds each device independently and expires entries", () => {
		let now = 0;
		const cache = new BoundedDeviceCache<string>(2, 100, () => now);
		cache.set("device-a", "first", "one");
		cache.set("device-a", "second", "two");
		cache.set("device-a", "third", "three");
		cache.set("device-b", "first", "other-device");

		expect(cache.get("device-a", "first")).toBeUndefined();
		expect(cache.get("device-a", "second")).toBe("two");
		expect(cache.get("device-b", "first")).toBe("other-device");

		now = 100;
		expect(cache.get("device-a", "second")).toBeUndefined();
	});

	test("revives BufferJSON message content", () => {
		const message: proto.IMessage = {
			imageMessage: { jpegThumbnail: Buffer.from([1, 2, 3]) },
		};

		const revived = reviveMessageContent(serializeMessageContent(message));
		expect(Buffer.isBuffer(revived.imageMessage?.jpegThumbnail)).toBe(true);
		expect(revived.imageMessage?.jpegThumbnail).toEqual(Buffer.from([1, 2, 3]));
	});

	test("preserves poll creation secrets through BufferJSON", () => {
		const message: proto.IMessage = {
			pollCreationMessage: {
				name: "Choose",
				encKey: Buffer.from([9, 8, 7]),
				selectableOptionsCount: 1,
			},
		};
		const revived = reviveMessageContent(serializeMessageContent(message));
		expect(revived.pollCreationMessage?.encKey).toEqual(Buffer.from([9, 8, 7]));
	});
});
