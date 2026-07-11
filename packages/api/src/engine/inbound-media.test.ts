import { beforeEach, describe, expect, mock, test } from "bun:test";

const downloadMetaDeviceMedia = mock(async () => ({
	bytes: new Uint8Array([1, 2, 3]),
	mimeType: "image/jpeg",
	size: 3,
	sha256: "downloaded-hash",
}));
const downloadDeviceMedia = mock(async () => new Uint8Array([4, 5, 6]));
const put = mock(async (key: string) => ({
	key,
	url: `https://cdn.example.com/${key}`,
}));

mock.module("@whatsapp-flow/env/server", () => ({
	env: { INBOUND_MEDIA_AUTO_DOWNLOAD: true },
}));

mock.module("@whatsapp-flow/storage", () => ({
	storage: {
		driver: "s3",
		put,
	},
}));

mock.module("@whatsapp-flow/whatsapp", () => ({
	downloadMetaDeviceMedia,
	connectionManager: {
		downloadDeviceMedia,
	},
}));

const { enrichInboundMedia } = await import("./inbound-media");

beforeEach(() => {
	downloadMetaDeviceMedia.mockClear();
	downloadDeviceMedia.mockClear();
	put.mockClear();
	put.mockImplementation(async (key: string) => ({
		key,
		url: `https://cdn.example.com/${key}`,
	}));
});

describe("inbound media enrichment", () => {
	test("downloads and stores media by default", async () => {
		const result = await enrichInboundMedia({
			deviceId: "dev_123",
			provider: "meta_cloud",
			providerMessageId: "wamid.1",
			messageType: "image",
			raw: {
				image: {
					id: "media_123",
					mime_type: "image/jpeg",
					caption: "Payment proof",
					sha256: "raw-hash",
				},
			},
		});

		expect(downloadMetaDeviceMedia).toHaveBeenCalledTimes(1);
		expect(downloadMetaDeviceMedia).toHaveBeenCalledWith(
			"dev_123",
			"media_123",
		);
		expect(put).toHaveBeenCalledTimes(1);
		expect(result.media).toMatchObject({
			type: "image",
			providerMediaId: "media_123",
			mimeType: "image/jpeg",
			caption: "Payment proof",
			sha256: "raw-hash",
			stored: true,
			storage: {
				driver: "s3",
				key: "whatsapp/meta/dev_123/wamid.1/media_123.jpeg",
				url: "https://cdn.example.com/whatsapp/meta/dev_123/wamid.1/media_123.jpeg",
			},
		});
		expect(result.raw?.media).toEqual(result.media);
	});

	test("keeps metadata only when auto-download is disabled", async () => {
		const result = await enrichInboundMedia({
			deviceId: "dev_123",
			provider: "meta_cloud",
			providerMessageId: "wamid.2",
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
		expect(downloadDeviceMedia).not.toHaveBeenCalled();
		expect(put).not.toHaveBeenCalled();
		expect(result.media).toEqual({
			type: "document",
			providerMediaId: "media_doc",
			mimeType: "application/pdf",
			fileName: "invoice.pdf",
			caption: null,
			size: null,
			sha256: null,
			stored: false,
			storage: null,
		});
		expect(result.raw?.media).toEqual(result.media);
	});

	test("returns null media for text messages", async () => {
		const raw = { text: { body: "hello" } };
		const result = await enrichInboundMedia({
			deviceId: "dev_123",
			provider: "meta_cloud",
			providerMessageId: "wamid.3",
			messageType: "text",
			raw,
		});

		expect(downloadMetaDeviceMedia).not.toHaveBeenCalled();
		expect(downloadDeviceMedia).not.toHaveBeenCalled();
		expect(put).not.toHaveBeenCalled();
		expect(result).toEqual({ raw, media: null });
	});

	test("keeps media errors in metadata when storage fails", async () => {
		put.mockImplementation(async () => {
			throw new Error("storage offline");
		});

		const result = await enrichInboundMedia({
			deviceId: "dev_123",
			provider: "meta_cloud",
			providerMessageId: "wamid.4",
			messageType: "image",
			raw: {
				image: {
					id: "media_404",
					mime_type: "image/png",
				},
			},
		});

		expect(downloadMetaDeviceMedia).toHaveBeenCalledTimes(1);
		expect(put).toHaveBeenCalledTimes(1);
		expect(result.media).toMatchObject({
			type: "image",
			providerMediaId: "media_404",
			mimeType: "image/png",
			stored: false,
			storage: null,
			storageError: "storage offline",
		});
		expect(result.raw?.media).toEqual(result.media);
		expect(result.raw?.mediaDownloadError).toBe("storage offline");
	});
});
