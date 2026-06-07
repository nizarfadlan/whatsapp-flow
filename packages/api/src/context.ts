import { auth } from "@whatsapp-flow/auth";
import { createDb } from "@whatsapp-flow/db";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	const db = createDb();
	return {
		auth: null,
		session,
		db,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
