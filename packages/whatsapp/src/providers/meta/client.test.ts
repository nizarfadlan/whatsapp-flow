import { afterEach, describe, expect, mock, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_GRAPH_API_VERSION = "v23.0";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.INBOUND_MEDIA_MAX_BYTES = "4";
process.env.INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS = "30000";
process.env.INBOUND_MEDIA_DOWNLOAD_CONCURRENCY = "3";
process.env.NODE_ENV = "test";

const originalFetch = globalThis.fetch;
const {
	downloadMetaMedia,
	isAllowedMetaMediaUrl,
	MetaGraphError,
	readMediaBody,
	MetaMediaDownloadError,
	sendMetaMessage,
} = await import("./client");

const credentials = { accessToken: "token", phoneNumberId: "phone-id" };

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function graphErrorResponse(status: number, message = "Graph failed") {
	return new Response(
		JSON.stringify({
			error: {
				message,
				type: "OAuthException",
				code: status,
				error_subcode: 123,
				fbtrace_id: "trace-1",
			},
		}),
		{ status, headers: { "content-type": "application/json" } },
	);
}

function metadataResponse(url: string, fileSize?: number) {
	return new Response(
		JSON.stringify({
			id: "media-id",
			url,
			mime_type: "image/jpeg",
			file_size: fileSize,
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

function streamResponse(chunks: Uint8Array[]) {
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		}),
		{ headers: { "content-type": "image/jpeg" } },
	);
}

describe("Meta Graph client", () => {
	test("does not retry non-retryable Graph errors", async () => {
		const fetchMock = mock(async () => graphErrorResponse(400));
		globalThis.fetch = fetchMock as never;

		try {
			await sendMetaMessage({
				credentials,
				to: "628123456789",
				message: { type: "text", text: "hello" },
			});
		} catch (error) {
			expect(error).toBeInstanceOf(MetaGraphError);
			expect(
				(error as InstanceType<typeof MetaGraphError>).details,
			).toMatchObject({
				status: 400,
				retryable: false,
				attempts: 1,
			});
			expect(fetchMock).toHaveBeenCalledTimes(1);
			return;
		}
		throw new Error("Expected MetaGraphError");
	});

	test("does not retry message sends after ambiguous Graph errors", async () => {
		const fetchMock = mock(async () => graphErrorResponse(500));
		globalThis.fetch = fetchMock as never;
		try {
			await sendMetaMessage({
				credentials,
				to: "628123456789",
				message: { type: "text", text: "hello" },
			});
		} catch (error) {
			expect(error).toBeInstanceOf(MetaGraphError);
			expect(
				(error as InstanceType<typeof MetaGraphError>).details,
			).toMatchObject({
				status: 500,
				retryable: true,
				attempts: 1,
			});
			expect(fetchMock).toHaveBeenCalledTimes(1);
			return;
		}
		throw new Error("Expected MetaGraphError");
	});

	test("falls back to numbered poll text", async () => {
		const fetchMock = mock(
			async () =>
				new Response(JSON.stringify({ messages: [{ id: "wamid.poll" }] }), {
					headers: { "content-type": "application/json" },
				}),
		);
		globalThis.fetch = fetchMock as never;
		await sendMetaMessage({
			credentials,
			to: "628123456789",
			message: {
				type: "poll",
				name: "ignored by Meta",
				values: ["Sales", "Support"],
				selectableCount: 1,
				fallbackText: "Choose\n1. Sales\n2. Support",
			},
		});
		const [, request] = (fetchMock.mock.calls[0] ?? []) as unknown as [
			unknown,
			RequestInit,
		];
		expect(JSON.parse(String(request.body))).toMatchObject({
			type: "text",
			text: { body: "Choose\n1. Sales\n2. Support", preview_url: false },
		});
	});

	test("allows only HTTPS Meta media hosts", () => {
		expect(isAllowedMetaMediaUrl("https://lookaside.fbsbx.com/media")).toBe(
			true,
		);
		expect(isAllowedMetaMediaUrl("https://scontent.xx.fbcdn.net/media")).toBe(
			true,
		);
		expect(isAllowedMetaMediaUrl("http://lookaside.fbsbx.com/media")).toBe(
			false,
		);
		expect(isAllowedMetaMediaUrl("https://fbsbx.com.evil.example/media")).toBe(
			false,
		);
		expect(isAllowedMetaMediaUrl("https://evil-fbsbx.com/media")).toBe(false);
	});

	test("rejects an unsafe redirect before forwarding authorization", async () => {
		const fetchMock = mock(async (url: URL | string) => {
			if (String(url).includes("graph.facebook.com")) {
				return metadataResponse("https://lookaside.fbsbx.com/media");
			}
			return new Response(null, {
				status: 302,
				headers: { location: "https://evil.example/media" },
			});
		});
		globalThis.fetch = fetchMock as never;
		await expect(
			downloadMetaMedia({ credentials, mediaId: "media-id" }),
		).rejects.toMatchObject({
			code: "policy",
			retryable: false,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("rejects streamed media exceeding an explicit byte limit", async () => {
		await expect(
			readMediaBody(
				streamResponse([new Uint8Array([1, 2]), new Uint8Array(9)]),
				4,
			),
		).rejects.toBeInstanceOf(MetaMediaDownloadError);
		await expect(
			readMediaBody(
				streamResponse([new Uint8Array([1, 2]), new Uint8Array(9)]),
				4,
			),
		).rejects.toMatchObject({
			code: "oversize",
			retryable: false,
		});
	});

	test("downloads an allowed bounded media response", async () => {
		const fetchMock = mock(async (url: URL | string) =>
			String(url).includes("graph.facebook.com")
				? metadataResponse("https://lookaside.fbsbx.com/media")
				: streamResponse([new Uint8Array([1, 2]), new Uint8Array([3, 4])]),
		);
		globalThis.fetch = fetchMock as never;
		const downloaded = await downloadMetaMedia({
			credentials,
			mediaId: "media-id",
		});
		expect(downloaded.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
		const [, request] = (fetchMock.mock.calls[1] ?? []) as unknown as [
			unknown,
			RequestInit,
		];
		expect(request.headers).toEqual({ Authorization: "Bearer token" });
		expect(request.redirect).toBe("manual");
	});
});
