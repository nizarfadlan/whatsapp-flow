import { describe, expect, mock, test } from "bun:test";

const createPresignedPost = mock(async () => ({
	url: "https://bucket.example.com",
	fields: {
		key: "media/file.jpg",
		"Content-Type": "image/jpeg",
		policy: "policy",
	},
}));
let lastGetCommand: { input: unknown } | undefined;
const getSignedUrl = mock(
	async (_client: unknown, command: { input: unknown }) => {
		lastGetCommand = command;
		return "https://bucket.example.com/signed";
	},
);

mock.module("@whatsapp-flow/env/server", () => ({
	env: {
		S3_BUCKET: "media-bucket",
		S3_REGION: "us-east-1",
		S3_ACCESS_KEY_ID: "access-key",
		S3_SECRET_ACCESS_KEY: "secret-key",
		S3_ENDPOINT: undefined,
		S3_PUBLIC_URL: "https://cdn.example.com/media/",
	},
}));
mock.module("@aws-sdk/s3-presigned-post", () => ({ createPresignedPost }));
mock.module("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl }));

const { S3StorageDriver } = await import("./s3");

describe("S3StorageDriver", () => {
	test("creates a POST policy that exactly binds key, type, and byte range", async () => {
		const driver = new S3StorageDriver();
		const upload = await driver.presignPut(
			"media/file.jpg",
			"image/jpeg",
			120,
			{
				maxBytes: 1024,
			},
		);

		expect(upload).toEqual({
			key: "media/file.jpg",
			uploadUrl: "https://bucket.example.com",
			uploadMethod: "POST",
			fields: {
				key: "media/file.jpg",
				"Content-Type": "image/jpeg",
				policy: "policy",
			},
			publicUrl: "https://cdn.example.com/media/media/file.jpg",
		});
		expect(createPresignedPost).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				Bucket: "media-bucket",
				Key: "media/file.jpg",
				Fields: { "Content-Type": "image/jpeg" },
				Conditions: [
					{ bucket: "media-bucket" },
					{ key: "media/file.jpg" },
					{ "Content-Type": "image/jpeg" },
					["content-length-range", 1, 1024],
				],
				Expires: 120,
			}),
		);
	});

	test("signs private reads as safe attachment downloads", async () => {
		const driver = new S3StorageDriver();
		await driver.presignGet("whatsapp/inbound/file.bin", 60, {
			fileName: 'unsafe\r\n"name.pdf',
			contentType: "application/pdf",
		});

		expect(lastGetCommand?.input).toMatchObject({
			Bucket: "media-bucket",
			Key: "whatsapp/inbound/file.bin",
			ResponseContentDisposition: 'attachment; filename="unsafe___name.pdf"',
			ResponseContentType: "application/octet-stream",
		});
	});
});
