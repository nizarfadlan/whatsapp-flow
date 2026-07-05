import { decryptSecret } from "@whatsapp-flow/auth/crypto";
import type { createDb } from "@whatsapp-flow/db";
import { smtpSetting } from "@whatsapp-flow/db/schema/settings";
import { env } from "@whatsapp-flow/env/server";
import { eq } from "drizzle-orm";
import { logger } from "./observability/logger";

export const SMTP_SETTINGS_ID = "global";

type SmtpSource = "database" | "environment";

type ResolvedSmtpConfig = {
	source: SmtpSource;
	host: string;
	port: number;
	secure: boolean;
	user: string | null;
	password: string | null;
	fromAddress: string;
};

type ResolveSmtpResult =
	| { ok: true; config: ResolvedSmtpConfig }
	| { ok: false; source: SmtpSource | null; error: string };

type EmailMessage = {
	to: string;
	subject: string;
	text: string;
	html?: string;
};

type InviteEmailInput = {
	to: string;
	inviteLink: string;
	roleName: string;
	expiresAt: Date;
	invitedByEmail?: string | null;
};

type EmailOptions = {
	db?: ReturnType<typeof createDb>;
};

function smtpEnv() {
	const host = env.SMTP_HOST ?? process.env.SMTP_HOST;
	const fromAddress = env.SMTP_FROM ?? process.env.SMTP_FROM;
	const port = Number(process.env.SMTP_PORT ?? env.SMTP_PORT);
	const secureRaw = process.env.SMTP_SECURE;
	return {
		host,
		fromAddress,
		port: Number.isFinite(port) ? port : env.SMTP_PORT,
		secure:
			secureRaw === undefined
				? env.SMTP_SECURE
				: secureRaw === "true" || secureRaw === "1",
		user: env.SMTP_USER ?? process.env.SMTP_USER ?? null,
		password: env.SMTP_PASSWORD ?? process.env.SMTP_PASSWORD ?? null,
	};
}

export function isEnvSmtpConfigured() {
	const smtp = smtpEnv();
	return Boolean(smtp.host && smtp.fromAddress);
}

export function isSmtpConfigured() {
	return isEnvSmtpConfigured();
}

function envSmtpConfig(): ResolvedSmtpConfig | null {
	const smtp = smtpEnv();
	if (!smtp.host || !smtp.fromAddress) return null;
	return {
		source: "environment",
		host: smtp.host,
		port: smtp.port,
		secure: smtp.secure,
		user: smtp.user,
		password: smtp.password,
		fromAddress: smtp.fromAddress,
	};
}

function isCompleteDatabaseSmtp(
	row: typeof smtpSetting.$inferSelect,
): row is typeof smtpSetting.$inferSelect & {
	host: string;
	port: number;
	fromAddress: string;
} {
	return Boolean(row.host && row.port && row.fromAddress);
}

export async function resolveSmtpConfig(
	db?: ReturnType<typeof createDb>,
): Promise<ResolveSmtpResult> {
	if (db) {
		const [row] = await db
			.select()
			.from(smtpSetting)
			.where(eq(smtpSetting.id, SMTP_SETTINGS_ID))
			.limit(1);

		if (row && isCompleteDatabaseSmtp(row)) {
			try {
				return {
					ok: true,
					config: {
						source: "database",
						host: row.host,
						port: row.port,
						secure: row.secure,
						user: row.user,
						password: row.passwordEncrypted
							? decryptSecret(row.passwordEncrypted)
							: null,
						fromAddress: row.fromAddress,
					},
				};
			} catch (error) {
				logger.error("email.smtp.decrypt_failed", { error });
				return {
					ok: false,
					source: "database",
					error: "SMTP settings could not be decrypted",
				};
			}
		}
	}

	const fallback = envSmtpConfig();
	if (fallback) return { ok: true, config: fallback };

	return { ok: false, source: null, error: "SMTP is not configured" };
}

export function renderInviteEmail(input: InviteEmailInput) {
	const appUrl = env.PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL;
	const appName = "WhatsApp Flow";
	const expires = input.expiresAt.toLocaleString("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
	});
	const inviter = input.invitedByEmail
		? `${input.invitedByEmail} invited you`
		: "You were invited";
	const subject = `You're invited to ${appName}`;
	const text = `${inviter} to join ${appName} as ${input.roleName}.

Accept your invite:
${input.inviteLink}

This invite expires on ${expires}.

If you were not expecting this invite, you can ignore this email.

${appUrl}`;
	const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 12px;">
              <h1 style="margin:0;font-size:24px;line-height:32px;color:#111827;">You're invited to ${escapeHtml(appName)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 20px;color:#4b5563;font-size:14px;line-height:22px;">
              <p style="margin:0 0 12px;">${escapeHtml(inviter)} to join <strong>${escapeHtml(appName)}</strong>.</p>
              <p style="margin:0;">Initial role: <strong>${escapeHtml(input.roleName)}</strong></p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;">
              <a href="${escapeAttribute(input.inviteLink)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:600;font-size:14px;">Accept invite</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;color:#6b7280;font-size:12px;line-height:18px;">
              <p style="margin:0 0 10px;">This invite expires on ${escapeHtml(expires)}.</p>
              <p style="margin:0;">If the button does not work, copy and paste this link into your browser:</p>
              <p style="word-break:break-all;margin:8px 0 0;"><a href="${escapeAttribute(input.inviteLink)}" style="color:#2563eb;">${escapeHtml(input.inviteLink)}</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

	return { subject, text, html };
}

function renderSmtpTestEmail() {
	const appUrl = env.PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL;
	const subject = "SMTP test email";
	const text = `This is a test email from WhatsApp Flow.

If you received this email, SMTP delivery is configured correctly.

${appUrl}`;
	const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:30px;color:#111827;">SMTP test email</h1>
              <p style="margin:0;color:#4b5563;font-size:14px;line-height:22px;">If you received this email, WhatsApp Flow can send email using the configured SMTP settings.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

	return { subject, text, html };
}

async function sendEmailWithSmtpConfig(
	config: ResolvedSmtpConfig,
	message: EmailMessage,
) {
	const nodemailer = await import("nodemailer");
	const transport = nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: config.user
			? { user: config.user, pass: config.password ?? "" }
			: undefined,
	});

	await transport.sendMail({
		from: config.fromAddress,
		to: message.to,
		subject: message.subject,
		text: message.text,
		html: message.html,
	});
}

export async function sendInviteEmail(
	input: InviteEmailInput,
	options: EmailOptions = {},
) {
	const resolved = await resolveSmtpConfig(options.db);
	if (!resolved.ok) {
		return {
			sent: false as const,
			source: resolved.source,
			error: resolved.error,
		};
	}

	try {
		const rendered = renderInviteEmail(input);
		await sendEmailWithSmtpConfig(resolved.config, {
			to: input.to,
			...rendered,
		});
		return { sent: true as const, source: resolved.config.source };
	} catch (error) {
		logger.error("email.invite.failed", {
			error,
			to: input.to,
			source: resolved.config.source,
		});
		return {
			sent: false as const,
			source: resolved.config.source,
			error: error instanceof Error ? error.message : "Invite email failed",
		};
	}
}

export async function sendSmtpTestEmail(
	db: ReturnType<typeof createDb>,
	input: { to: string },
) {
	const resolved = await resolveSmtpConfig(db);
	if (!resolved.ok) {
		return {
			sent: false as const,
			source: resolved.source,
			error: resolved.error,
		};
	}

	try {
		await sendEmailWithSmtpConfig(resolved.config, {
			to: input.to,
			...renderSmtpTestEmail(),
		});
		return { sent: true as const, source: resolved.config.source };
	} catch (error) {
		logger.error("email.smtp_test.failed", {
			error,
			to: input.to,
			source: resolved.config.source,
		});
		return {
			sent: false as const,
			source: resolved.config.source,
			error: error instanceof Error ? error.message : "SMTP test email failed",
		};
	}
}

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function escapeAttribute(value: string) {
	return escapeHtml(value);
}
