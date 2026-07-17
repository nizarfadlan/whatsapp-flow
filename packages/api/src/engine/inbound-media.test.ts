import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";

const downloadMetaDeviceMedia = mock(async () => ({
	bytes: new Uint8Array([1, 2, 3]),
	mimeType: "image/jpeg",
	size: 3,
	sha256: createHash("sha256")
		.update(new Uint8Array([1, 2, 3]))
		.digest("hex"),
}));
const downloadDeviceMedia = mock(async () => new Uint8Array([4, 5, 6]));
const put = mock(async (key: string) => ({
	key,
	url: `https://cdn.example.com/${key}`,
}));

mock.module("@whatsapp-flow/env/server", () => ({
	env: {
		INBOUND_MEDIA_AUTO_DOWNLOAD: true,
		INBOUND_MEDIA_MAX_BYTES: 10,
		INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS: 20,
		INBOUND_MEDIA_DOWNLOAD_CONCURRENCY: 1,
		AUTH_URL: "https://app.example.com",
		META_GRAPH_API_VERSION: "v23.0",
	},
}));

mock.module("@whatsapp-flow/storage", () => ({
	storage: { driver: "s3", put },
}));

mock.module("@whatsapp-flow/whatsapp", () => ({
	downloadMetaDeviceMedia,
	connectionManager: { downloadDeviceMedia },
	derivePrivateIdentityKey: ({
		jid,
		number,
		lid,
	}: {
		jid?: string | null;
		number?: string | null;
		lid?: string | null;
	}) => {
		if (number) return `phone:${number}`;
		if (lid) return `lid:${lid}`;
		if (jid?.endsWith("@s.whatsapp.net")) return `phone:${jid.split("@")[0]}`;
		if (jid?.endsWith("@lid")) return `lid:${jid}`;
		return `jid:${jid ?? "unknown"}`;
	},
}));

const { enrichInboundMedia } = await import("./inbound-media");

beforeEach(() => {
	downloadMetaDeviceMedia.mockClear();
	downloadDeviceMedia.mockClear();
	put.mockClear();
	downloadMetaDeviceMedia.mockImplementation(async () => ({
		bytes: new Uint8Array([1, 2, 3]),
		mimeType: "image/jpeg",
		size: 3,
		sha256: createHash("sha256")
			.update(new Uint8Array([1, 2, 3]))
			.digest("hex"),
	}));
	downloadDeviceMedia.mockImplementation(async () => new Uint8Array([4, 5, 6]));
	put.mockImplementation(async (key: string) => ({
		key,
		url: `https://cdn.example.com/${key}`,
	}));
});

function metaInput(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		inboxMessageId: "inbox_123",
		deviceId: "dev_123",
		provider: "meta_cloud",
		providerMessageId: "wamid.1",
		messageType: "image",
		raw: { image: { id: "media_123", mime_type: "image/jpeg", ...overrides } },
	};
}

describe("inbound media enrichment", () => {
	test("downloads with digest-only storage path", async () => {
		const result = await enrichInboundMedia(
			metaInput({ caption: "Payment proof" }),
		);
		const expectedKey = [
			"whatsapp/meta",
			createHash("sha256").update("dev_123").digest("hex"),
			createHash("sha256").update("wamid.1").digest("hex"),
			`${createHash("sha256")
				.update(new Uint8Array([1, 2, 3]))
				.digest("hex")}.jpeg`,
		].join("/");

		expect(downloadMetaDeviceMedia).toHaveBeenCalledWith(
			"dev_123",
			"media_123",
		);
		expect(put).toHaveBeenCalledWith(
			expectedKey,
			new Uint8Array([1, 2, 3]),
			"image/jpeg",
		);
		expect(result.media).toMatchObject({
			status: "stored",
			stored: true,
			storage: {
				driver: "s3",
				key: expectedKey,
				url: "https://app.example.com/api/inbox/media/inbox_123",
			},
		});
		expect(expectedKey).not.toContain("dev_123");
		expect(expectedKey).not.toContain("wamid.1");
	});

	test("keeps metadata only when auto-download is disabled", async () => {
		const result = await enrichInboundMedia({
			...metaInput({ filename: "invoice.pdf" }),
			messageType: "document",
			autoDownload: false,
			raw: {
				document: {
					id: "media_doc",
					mime_type: "application/pdf",
					filename: "invoice.pdf",
				},
			},
		});

		expect(downloadMetaDeviceMedia).not.toHaveBeenCalled();
		expect(result.media).toMatchObject({
			type: "document",
			status: "metadata_only",
			stored: false,
			storage: null,
		});
	});

	test("detects wrapped Baileys media but downloads the complete message", async () => {
		const raw = {
			key: { id: "baileys-1" },
			message: {
				ephemeralMessage: {
					message: { imageMessage: { mimetype: "image/png", fileLength: 3 } },
				},
			},
		};
		const result = await enrichInboundMedia({
			inboxMessageId: "inbox_123",
			deviceId: "dev_123",
			provider: "baileys",
			providerMessageId: "baileys-1",
			messageType: "image",
			raw,
		});
		expect(downloadDeviceMedia).toHaveBeenCalledWith("dev_123", raw);
		expect(result.media).toMatchObject({ type: "image", status: "stored" });
	});

	test("rejects declared oversize media before download", async () => {
		const result = await enrichInboundMedia(metaInput({ file_size: 11 }));
		expect(downloadMetaDeviceMedia).not.toHaveBeenCalled();
		expect(result.media?.error).toEqual({
			code: "oversize",
			message: "Media exceeds the inbound download limit",
			retryable: false,
		});
	});

	test("rejects media that exceeds the post-download limit", async () => {
		downloadMetaDeviceMedia.mockImplementation(async () => ({
			bytes: new Uint8Array(11),
			mimeType: "image/jpeg",
			size: 11,
			sha256: "00".repeat(32),
		}));
		const result = await enrichInboundMedia(metaInput());
		expect(put).not.toHaveBeenCalled();
		expect(result.media?.error?.code).toBe("oversize");
	});

	test("classifies SHA-256 mismatches as non-retryable integrity failures", async () => {
		const result = await enrichInboundMedia(
			metaInput({ sha256: "00".repeat(32) }),
		);
		expect(result.media?.error).toEqual({
			code: "integrity",
			message: "Media integrity verification failed",
			retryable: false,
		});
	});

	test("returns a stable storage error contract", async () => {
		put.mockImplementation(async () => {
			throw new Error("storage offline");
		});
		const result = await enrichInboundMedia(metaInput());
		expect(result.media).toMatchObject({
			status: "failed",
			stored: false,
			storage: null,
			storageError: "Media storage failed",
			error: {
				code: "storage",
				message: "Media storage failed",
				retryable: true,
			},
		});
	});

	test("keeps the Baileys semaphore occupied until a timed-out download settles", async () => {
		let resolveFirst: ((value: Uint8Array<ArrayBuffer>) => void) | undefined;
		downloadDeviceMedia.mockImplementation(
			async () =>
				new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
					resolveFirst = resolve;
				}),
		);
		const first = enrichInboundMedia({
			inboxMessageId: "inbox_123",
			deviceId: "dev_123",
			provider: "baileys",
			providerMessageId: "first",
			messageType: "image",
			raw: { message: { imageMessage: { fileLength: 3 } } },
		});
		await Bun.sleep(25);
		expect((await first).media?.error?.code).toBe("timeout");

		const second = enrichInboundMedia({
			inboxMessageId: "inbox_123",
			deviceId: "dev_123",
			provider: "baileys",
			providerMessageId: "second",
			messageType: "image",
			raw: { message: { imageMessage: { fileLength: 3 } } },
		});
		await Bun.sleep(5);
		expect(downloadDeviceMedia).toHaveBeenCalledTimes(1);
		resolveFirst?.(new Uint8Array([4, 5, 6]));
		await Bun.sleep(5);
		expect(downloadDeviceMedia).toHaveBeenCalledTimes(2);
		resolveFirst?.(new Uint8Array([4, 5, 6]));
		await second;
	});
});
