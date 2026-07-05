import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.ADMIN_EMAILS ??= "admin@example.com";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-token";
process.env.NODE_ENV = "test";
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
process.env.SMTP_HOST = "smtp.env.example.com";
process.env.SMTP_PORT = "2525";
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = "env-user";
process.env.SMTP_PASSWORD = "env-password";
process.env.SMTP_FROM = "Env Sender <env@example.com>";

const { resolveSmtpConfig } = await import("./email");

type SmtpRow = {
	id: string;
	host: string | null;
	port: number | null;
	secure: boolean;
	user: string | null;
	passwordEncrypted: string | null;
	passwordUpdatedAt: Date | null;
	fromAddress: string | null;
	createdAt: Date;
	updatedAt: Date;
};

function createDb(row: SmtpRow | null) {
	return {
		select: () => ({
			from() {
				return this;
			},
			where() {
				return this;
			},
			limit() {
				return Promise.resolve(row ? [row] : []);
			},
		}),
	} as never;
}

function makeRow(overrides: Partial<SmtpRow> = {}): SmtpRow {
	return {
		id: "global",
		host: "smtp.db.example.com",
		port: 587,
		secure: true,
		user: "db-user",
		passwordEncrypted: null,
		passwordUpdatedAt: null,
		fromAddress: "DB Sender <db@example.com>",
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

describe("resolveSmtpConfig", () => {
	test("uses environment SMTP when no database row exists", async () => {
		const result = await resolveSmtpConfig(createDb(null));

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error);
		expect(result.config).toMatchObject({
			source: "environment",
			host: "smtp.env.example.com",
			port: 2525,
			user: "env-user",
			password: "env-password",
			fromAddress: "Env Sender <env@example.com>",
		});
	});

	test("database SMTP overrides environment SMTP when complete", async () => {
		const result = await resolveSmtpConfig(createDb(makeRow()));

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error);
		expect(result.config).toMatchObject({
			source: "database",
			host: "smtp.db.example.com",
			port: 587,
			secure: true,
			user: "db-user",
			password: null,
			fromAddress: "DB Sender <db@example.com>",
		});
	});

	test("incomplete database SMTP falls back to environment SMTP", async () => {
		const result = await resolveSmtpConfig(
			createDb(makeRow({ host: null, fromAddress: null })),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error);
		expect(result.config.source).toBe("environment");
		expect(result.config.host).toBe("smtp.env.example.com");
	});
});
