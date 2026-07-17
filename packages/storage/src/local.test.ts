import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeStorageKey, resolveStoragePath } from "./key";
import {
	createLocalUploadGrant,
	verifyLocalUploadGrant,
} from "./local-upload-grant";

mock.module("@whatsapp-flow/env/server", () => ({
	env: {
		LOCAL_UPLOAD_DIR: undefined,
		PUBLIC_BASE_URL: "https://app.example.com",
		AUTH_URL: "https://app.example.com",
		AUTH_SECRET: "a test secret that is safely long enough",
	},
}));

const { LocalStorageDriver } = await import("./local");

const secret = "a test secret that is safely long enough";

function byteStream(...chunks: number[][]) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
			controller.close();
		},
	});
}

describe("storage keys", () => {
	test("accepts controlled outbound and inbound keys", () => {
		expect(
			normalizeStorageKey("media/123e4567-e89b-12d3-a456-426614174000.jpg"),
		).toBe("media/123e4567-e89b-12d3-a456-426614174000.jpg");
		expect(normalizeStorageKey("whatsapp/baileys/a0b1/c2d3/e4f5.jpeg")).toBe(
			"whatsapp/baileys/a0b1/c2d3/e4f5.jpeg",
		);
	});

	test("rejects traversal, absolute, and URL-like keys", () => {
		for (const key of [
			"",
			"/media/file.jpg",
			"media\\file.jpg",
			"media/../file.jpg",
			"media/%2e%2e/file.jpg",
			"https://example.com/file.jpg",
			"media//file.jpg",
			"media/./file.jpg",
			"media/file?.jpg",
		]) {
			expect(() => normalizeStorageKey(key)).toThrow();
		}
	});

	test("resolves paths only within the absolute storage root", () => {
		const path = resolveStoragePath("relative-root", "media/file.jpg");
		expect(path).toContain("relative-root");
		expect(() => resolveStoragePath("relative-root", "../file.jpg")).toThrow();
	});
});

describe("local storage", () => {
	test("writes and reads contained bytes", async () => {
		const root = await mkdtemp(join(tmpdir(), "storage-test-"));
		try {
			const driver = new LocalStorageDriver(root);
			await driver.put(
				"media/file.txt",
				new Uint8Array([1, 2, 3]),
				"text/plain",
			);
			expect(await driver.read("media/file.txt")).toEqual(
				new Uint8Array([1, 2, 3]),
			);
			expect(await driver.exists("media/file.txt")).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("atomically creates a key once across concurrent and replayed uploads", async () => {
		const root = await mkdtemp(join(tmpdir(), "storage-test-"));
		try {
			const driver = new LocalStorageDriver(root);
			const [first, second] = await Promise.all([
				driver.createFromStream(
					"media/concurrent.txt",
					byteStream([1, 2, 3]),
					10,
				),
				driver.createFromStream(
					"media/concurrent.txt",
					byteStream([4, 5, 6]),
					10,
				),
			]);
			expect([first.status, second.status].sort()).toEqual([
				"conflict",
				"created",
			]);
			const replay = await driver.createFromStream(
				"media/concurrent.txt",
				byteStream([7]),
				10,
			);
			expect(replay).toEqual({ status: "conflict" });
			expect((await driver.read("media/concurrent.txt")).byteLength).toBe(3);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("cleans oversized temporary uploads without publishing a partial file", async () => {
		const root = await mkdtemp(join(tmpdir(), "storage-test-"));
		try {
			const driver = new LocalStorageDriver(root);
			const result = await driver.createFromStream(
				"media/oversized.txt",
				byteStream([1, 2], [3, 4]),
				3,
			);
			expect(result).toEqual({ status: "oversize" });
			expect(await driver.exists("media/oversized.txt")).toBe(false);
			expect(await readdir(join(root, "media"))).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("local upload grants", () => {
	const payload = {
		key: "media/file.txt",
		userId: "user_1",
		mimeType: "text/plain",
		maxBytes: 10,
		expiresAt: 2_000,
	};

	test("rejects tampering, expiry, wrong user, and wrong key", () => {
		const grant = createLocalUploadGrant(payload, secret);
		expect(
			verifyLocalUploadGrant(
				grant,
				secret,
				{
					key: payload.key,
					userId: payload.userId,
					mimeType: payload.mimeType,
				},
				1_000,
			),
		).toEqual(payload);
		expect(
			verifyLocalUploadGrant(
				`${grant}x`,
				secret,
				{
					key: payload.key,
					userId: payload.userId,
					mimeType: payload.mimeType,
				},
				1_000,
			),
		).toBeNull();
		expect(
			verifyLocalUploadGrant(
				grant,
				secret,
				{
					key: payload.key,
					userId: "user_2",
					mimeType: payload.mimeType,
				},
				1_000,
			),
		).toBeNull();
		expect(
			verifyLocalUploadGrant(
				grant,
				secret,
				{
					key: "media/other.txt",
					userId: payload.userId,
					mimeType: payload.mimeType,
				},
				1_000,
			),
		).toBeNull();
		expect(
			verifyLocalUploadGrant(
				grant,
				secret,
				{
					key: payload.key,
					userId: payload.userId,
					mimeType: payload.mimeType,
				},
				2_000,
			),
		).toBeNull();
	});
});
