import { auth } from "@whatsapp-flow/auth";
import { createDb } from "@whatsapp-flow/db";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
	context: HonoContext;
};

function requestIp(headers: Headers) {
	const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return (
		headers.get("cf-connecting-ip") ??
		headers.get("x-real-ip") ??
		forwardedFor ??
		null
	);
}

export async function createContext({ context }: CreateContextOptions) {
	const headers = context.req.raw.headers;
	const session = await auth.api.getSession({ headers });
	const db = createDb();
	return {
		auth: null,
		session,
		db,
		requestIp: requestIp(headers),
		requestUserAgent: headers.get("user-agent"),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
