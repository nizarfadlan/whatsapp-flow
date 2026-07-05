import { afterEach, describe, expect, mock, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.META_GRAPH_API_VERSION = "v23.0";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";

const originalFetch = globalThis.fetch;
const { MetaGraphError, sendMetaMessage } = await import("./client");

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

describe("Meta Graph client", () => {
	test("does not retry non-retryable Graph errors", async () => {
		const fetchMock = mock(async () => graphErrorResponse(400));
		globalThis.fetch = fetchMock as never;

		try {
			await sendMetaMessage({
				credentials: { accessToken: "token", phoneNumberId: "phone-id" },
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

	test("retries retryable Graph errors", async () => {
		const fetchMock = mock(async () => graphErrorResponse(500));
		globalThis.fetch = fetchMock as never;

		try {
			await sendMetaMessage({
				credentials: { accessToken: "token", phoneNumberId: "phone-id" },
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
				attempts: 3,
			});
			expect(fetchMock).toHaveBeenCalledTimes(3);
			return;
		}

		throw new Error("Expected MetaGraphError");
	});
});
