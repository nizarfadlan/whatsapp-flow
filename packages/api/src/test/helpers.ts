import { expect } from "bun:test";
import { TRPCError } from "@trpc/server";

export function makeSession(
	overrides: Partial<{ id: string; email: string }> = {},
) {
	const id = overrides.id ?? "user-1";
	return {
		user: {
			id,
			email: overrides.email ?? "admin@example.com",
			name: "Test User",
			emailVerified: true,
			image: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
		session: {
			id: "session-1",
			userId: id,
			expiresAt: new Date("2026-01-02T00:00:00.000Z"),
			token: "session-token",
			ipAddress: null,
			userAgent: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
	};
}

export function makeCurrentUser(
	overrides: Partial<{
		id: string;
		email: string;
		role: "admin" | "member";
		status: "active" | "suspended";
	}> = {},
) {
	return {
		id: overrides.id ?? "user-1",
		email: overrides.email ?? "admin@example.com",
		role: overrides.role ?? "admin",
		status: overrides.status ?? "active",
	};
}

export async function expectTRPCError(
	value: Promise<unknown>,
	code: TRPCError["code"],
	message?: string,
) {
	try {
		await value;
	} catch (error) {
		expect(error).toBeInstanceOf(TRPCError);
		expect((error as TRPCError).code).toBe(code);
		if (message) {
			expect((error as TRPCError).message).toContain(message);
		}
		return;
	}

	throw new Error(`Expected TRPCError with code ${code}`);
}
