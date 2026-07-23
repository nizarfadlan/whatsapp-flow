import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import { env } from "@whatsapp-flow/env/server";
import {
	configureMetaDevice,
	configureMetaDeviceFromEmbeddedSignup,
	connectionManager,
	getMetaConfigSummary,
} from "@whatsapp-flow/whatsapp";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAuditLog } from "../audit-log";
import { requireOrganizationPermission } from "../authorization/organization";
import {
	listDeviceResourceSyncRuns,
	startDeviceResourceSync,
} from "../engine/device-resource-sync";
import { organizationPermissionProcedure, router } from "../index";
import { logger } from "../observability/logger";

const requiredTrimmedString = z.string().trim().min(1);
const optionalTrimmedString = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed || undefined;
}, z.string().min(1).optional());

const metaConfigInput = z.object({
	phoneNumberId: requiredTrimmedString,
	accessToken: optionalTrimmedString,
	appSecret: optionalTrimmedString,
	businessAccountId: optionalTrimmedString,
	displayPhoneNumber: optionalTrimmedString,
	graphApiVersion: optionalTrimmedString.transform((value) =>
		value ? normalizeGraphApiVersion(value) : undefined,
	),
});

const metaEmbeddedSignupInput = metaConfigInput
	.omit({ accessToken: true, appSecret: true })
	.extend({
		name: requiredTrimmedString,
		code: requiredTrimmedString,
		state: requiredTrimmedString,
		redirectUri: optionalTrimmedString,
	});

async function requireOrganizationDevice(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	deviceId: string,
	tenantId: string,
) {
	const [found] = await db
		.select()
		.from(device)
		.where(and(eq(device.id, deviceId), eq(device.tenantId, tenantId)))
		.limit(1);

	if (!found) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
	}

	return found;
}

function requireConnectedBaileysDevice(found: typeof device.$inferSelect) {
	if (found.provider !== "baileys") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Resource sync currently supports Baileys devices only",
		});
	}
	if (connectionManager.getConnection(found.id)?.status !== "connected") {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Device must be connected before synchronization",
		});
	}
}

function normalizeGraphApiVersion(value: string) {
	return value.startsWith("v") ? value : `v${value}`;
}

function createEmbeddedSignupState(userId: string) {
	const expiresAt = String(Date.now() + 10 * 60 * 1000);
	const payload = `meta.${userId}.${expiresAt}`;
	const signature = createHmac("sha256", env.AUTH_SECRET)
		.update(payload)
		.digest("hex");
	return `${payload}.${signature}`;
}

function requireValidEmbeddedSignupState(state: string, userId: string) {
	const [prefix, stateUserId, expiresAt, signature] = state.split(".");
	if (prefix !== "meta" || stateUserId !== userId || !expiresAt || !signature) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid Meta Embedded Signup state",
		});
	}

	if (Number(expiresAt) < Date.now()) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Meta Embedded Signup state has expired",
		});
	}

	const payload = `${prefix}.${stateUserId}.${expiresAt}`;
	const expected = createHmac("sha256", env.AUTH_SECRET)
		.update(payload)
		.digest("hex");
	if (!safeEqual(signature, expected)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid Meta Embedded Signup state",
		});
	}
}

function requireAllowedEmbeddedRedirectUri(value?: string) {
	if (!value) return;
	let redirectOrigin: string;
	try {
		redirectOrigin = new URL(value).origin;
	} catch {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Meta Embedded Signup redirect URI is invalid",
		});
	}

	const allowedOrigins = [env.CORS_ORIGIN, env.AUTH_URL].map(
		(origin) => new URL(origin).origin,
	);
	if (!allowedOrigins.includes(redirectOrigin)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Meta Embedded Signup redirect URI is not allowed",
		});
	}
}

function safeEqual(a: string, b: string) {
	const aBuffer = Buffer.from(a);
	const bBuffer = Buffer.from(b);
	if (aBuffer.length !== bBuffer.length) return false;
	return timingSafeEqual(aBuffer, bBuffer);
}

function requireInitialMetaCredentials(input: z.infer<typeof metaConfigInput>) {
	if (!input.accessToken) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Meta access token is required",
		});
	}

	if (!input.appSecret && !env.META_APP_SECRET) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"Meta app secret is required unless META_APP_SECRET is configured on the server",
		});
	}
}

function toMetaConfigError(error: unknown) {
	return new TRPCError({
		code: "BAD_REQUEST",
		message:
			error instanceof Error
				? error.message
				: "Failed to configure Meta connection",
	});
}

export const deviceRouter = router({
	list: organizationPermissionProcedure("organization.devices.read").query(
		async ({ ctx }) => {
			return ctx.db
				.select({
					id: device.id,
					name: device.name,
					provider: device.provider,
					tenantId: device.tenantId,
					ownerUserId: device.userId,
					isOwner: sql<boolean>`${device.userId} = ${ctx.currentUser.id}`,
					externalId: device.externalId,
					phoneNumber: device.phoneNumber,
					businessAccountId: device.businessAccountId,
					displayPhoneNumber: device.displayPhoneNumber,
					status: device.status,
					statusReason: device.statusReason,
					lastError: device.lastError,
					lastConnectedAt: device.lastConnectedAt,
					lastWebhookAt: device.lastWebhookAt,
					createdAt: device.createdAt,
					updatedAt: device.updatedAt,
				})
				.from(device)
				.where(eq(device.tenantId, ctx.organization.id))
				.orderBy(desc(device.updatedAt));
		},
	),

	listForDeploy: organizationPermissionProcedure("organization.devices.read")
		.input(z.object({ flowId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await requireOrganizationPermission(
				ctx.db,
				ctx.organization.id,
				ctx.currentUser.id,
				"organization.flows.execute",
			);
			const [targetFlow] = await ctx.db
				.select({ id: flow.id })
				.from(flow)
				.where(
					and(
						eq(flow.id, input.flowId),
						eq(flow.tenantId, ctx.organization.id),
					),
				)
				.limit(1);
			if (!targetFlow) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
			}

			return ctx.db
				.select({
					id: device.id,
					name: device.name,
					provider: device.provider,
					status: device.status,
				})
				.from(device)
				.where(eq(device.tenantId, ctx.organization.id))
				.orderBy(desc(device.updatedAt));
		}),

	create: organizationPermissionProcedure("organization.devices.manage")
		.input(
			z.object({
				name: z.string().min(1),
				tenantId: z.string().min(1),
				provider: z.enum(["baileys", "meta_cloud"]).default("baileys"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const tenantId = ctx.organization.id;
			const id = crypto.randomUUID();
			const rows = await ctx.db
				.insert(device)
				.values({
					id,
					userId: ctx.session.user.id,
					tenantId,
					name: input.name,
					provider: input.provider,
				})
				.returning({
					id: device.id,
					name: device.name,
					provider: device.provider,
					status: device.status,
				});

			const row = rows[0];
			if (!row) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Device was not created",
				});
			}

			await writeAuditLog(ctx, {
				action: "device.created",
				targetType: "device",
				targetId: row.id,
				targetDisplay: row.name,
				after: row,
			});

			return row;
		}),

	createMeta: organizationPermissionProcedure("organization.devices.manage")
		.input(
			metaConfigInput.extend({
				name: requiredTrimmedString,
				tenantId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			requireInitialMetaCredentials(input);
			const tenantId = ctx.organization.id;

			const id = crypto.randomUUID();
			await ctx.db.insert(device).values({
				id,
				userId: ctx.session.user.id,
				tenantId,
				name: input.name,
				provider: "meta_cloud",
			});

			try {
				const configured = await configureMetaDevice({
					deviceId: id,
					phoneNumberId: input.phoneNumberId,
					accessToken: input.accessToken,
					appSecret: input.appSecret,
					businessAccountId: input.businessAccountId,
					displayPhoneNumber: input.displayPhoneNumber,
					graphApiVersion: input.graphApiVersion,
				});
				await writeAuditLog(ctx, {
					action: "device.created",
					targetType: "device",
					targetId: id,
					targetDisplay: input.name,
					after: {
						name: input.name,
						provider: "meta_cloud",
						phoneNumberId: input.phoneNumberId,
						businessAccountId: input.businessAccountId,
						displayPhoneNumber: input.displayPhoneNumber,
						graphApiVersion: input.graphApiVersion,
						hasAccessToken: Boolean(input.accessToken),
						hasAppSecret: Boolean(input.appSecret || env.META_APP_SECRET),
					},
				});
				return configured;
			} catch (error) {
				await ctx.db.delete(device).where(eq(device.id, id));
				throw toMetaConfigError(error);
			}
		}),

	getMetaEmbeddedSignupConfig: organizationPermissionProcedure(
		"organization.devices.manage",
	).query(({ ctx }) => ({
		configured: Boolean(
			env.META_APP_ID &&
				env.META_APP_SECRET &&
				env.META_EMBEDDED_SIGNUP_CONFIG_ID,
		),
		appId: env.META_APP_ID ?? null,
		configId: env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? null,
		state: createEmbeddedSignupState(ctx.session.user.id),
		graphApiVersion: env.META_GRAPH_API_VERSION,
	})),

	createMetaEmbedded: organizationPermissionProcedure(
		"organization.devices.manage",
	)
		.input(
			metaEmbeddedSignupInput.extend({
				tenantId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			requireValidEmbeddedSignupState(input.state, ctx.session.user.id);
			requireAllowedEmbeddedRedirectUri(input.redirectUri);
			const tenantId = ctx.organization.id;

			const id = crypto.randomUUID();
			await ctx.db.insert(device).values({
				id,
				userId: ctx.session.user.id,
				tenantId,
				name: input.name,
				provider: "meta_cloud",
			});

			try {
				const configured = await configureMetaDeviceFromEmbeddedSignup({
					deviceId: id,
					code: input.code,
					redirectUri: input.redirectUri,
					phoneNumberId: input.phoneNumberId,
					businessAccountId: input.businessAccountId,
					displayPhoneNumber: input.displayPhoneNumber,
					graphApiVersion: input.graphApiVersion,
				});
				await writeAuditLog(ctx, {
					action: "device.created",
					targetType: "device",
					targetId: id,
					targetDisplay: input.name,
					after: {
						name: input.name,
						provider: "meta_cloud",
						setup: "embedded_signup",
						phoneNumberId: input.phoneNumberId,
						businessAccountId: input.businessAccountId,
						displayPhoneNumber: input.displayPhoneNumber,
						graphApiVersion: input.graphApiVersion,
					},
				});
				return configured;
			} catch (error) {
				await ctx.db.delete(device).where(eq(device.id, id));
				throw toMetaConfigError(error);
			}
		}),

	configureMeta: organizationPermissionProcedure("organization.devices.manage")
		.input(
			metaConfigInput.extend({
				id: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const found = await requireOrganizationDevice(
				ctx.db,
				input.id,
				ctx.organization.id,
			);
			if (found.provider !== "meta_cloud") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Device is not a Meta Cloud API connection",
				});
			}

			const existingConfig = await getMetaConfigSummary(input.id);
			if (!input.accessToken && !existingConfig?.hasAccessToken) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Meta access token is required",
				});
			}
			if (
				!input.appSecret &&
				!env.META_APP_SECRET &&
				!existingConfig?.hasAppSecret
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Meta app secret is required unless META_APP_SECRET is configured on the server",
				});
			}

			try {
				const configured = await configureMetaDevice({
					deviceId: input.id,
					phoneNumberId: input.phoneNumberId,
					accessToken: input.accessToken,
					appSecret: input.appSecret,
					businessAccountId: input.businessAccountId,
					displayPhoneNumber: input.displayPhoneNumber,
					graphApiVersion: input.graphApiVersion,
				});
				await writeAuditLog(ctx, {
					action: "device.meta_configured",
					targetType: "device",
					targetId: found.id,
					targetDisplay: found.name,
					before: existingConfig,
					after: {
						phoneNumberId: input.phoneNumberId,
						businessAccountId: input.businessAccountId,
						displayPhoneNumber: input.displayPhoneNumber,
						graphApiVersion: input.graphApiVersion,
						hasAccessToken: Boolean(
							input.accessToken || existingConfig?.hasAccessToken,
						),
						hasAppSecret: Boolean(
							input.appSecret ||
								env.META_APP_SECRET ||
								existingConfig?.hasAppSecret,
						),
					},
					metadata: {
						accessTokenRotated: Boolean(input.accessToken),
						appSecretRotated: Boolean(input.appSecret),
					},
				});
				return configured;
			} catch (error) {
				throw toMetaConfigError(error);
			}
		}),

	getMetaConfig: organizationPermissionProcedure("organization.devices.read")
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const found = await requireOrganizationDevice(
				ctx.db,
				input.id,
				ctx.organization.id,
			);
			if (found.provider !== "meta_cloud") return null;
			return getMetaConfigSummary(input.id);
		}),

	delete: organizationPermissionProcedure("organization.devices.manage")
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const found = await requireOrganizationDevice(
				ctx.db,
				input.id,
				ctx.organization.id,
			);
			await connectionManager.disconnect(input.id);
			await ctx.db.delete(device).where(eq(device.id, input.id));
			await writeAuditLog(ctx, {
				action: "device.deleted",
				targetType: "device",
				targetId: found.id,
				targetDisplay: found.name,
				before: {
					id: found.id,
					name: found.name,
					provider: found.provider,
					status: found.status,
				},
			});
			return { success: true };
		}),

	connect: organizationPermissionProcedure("organization.devices.connect")
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const found = await requireOrganizationDevice(
				ctx.db,
				input.id,
				ctx.organization.id,
			);
			const connection = await connectionManager.connect(input.id);
			await writeAuditLog(ctx, {
				action: "device.connected",
				targetType: "device",
				targetId: found.id,
				targetDisplay: found.name,
				metadata: {
					provider: found.provider,
					status: connection.status,
					requiresQr: Boolean(connection.qrCode),
				},
			});
			return {
				id: input.id,
				status: connection.status,
				qrCode: connection.qrCode,
			};
		}),

	requestPairingCode: organizationPermissionProcedure(
		"organization.devices.connect",
	)
		.input(
			z.object({
				id: z.string().min(1),
				phoneNumber: z.string().min(6),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await requireOrganizationDevice(ctx.db, input.id, ctx.organization.id);
			try {
				const code = await connectionManager.requestPairingCode(
					input.id,
					input.phoneNumber,
				);
				return { code };
			} catch (error) {
				const output =
					error && typeof error === "object"
						? (error as { output?: { statusCode?: unknown } }).output
						: undefined;
				logger.error("device.pairing_code.failed", {
					deviceId: input.id,
					errorName: error instanceof Error ? error.name : "UnknownError",
					errorMessage:
						error instanceof Error ? error.message : "Unknown error",
					statusCode:
						typeof output?.statusCode === "number"
							? output.statusCode
							: undefined,
				});
				throw error;
			}
		}),

	disconnect: organizationPermissionProcedure("organization.devices.connect")
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const found = await requireOrganizationDevice(
				ctx.db,
				input.id,
				ctx.organization.id,
			);
			await connectionManager.disconnect(input.id);
			await writeAuditLog(ctx, {
				action: "device.disconnected",
				targetType: "device",
				targetId: found.id,
				targetDisplay: found.name,
				metadata: { provider: found.provider },
			});
			return { success: true };
		}),

	logout: organizationPermissionProcedure("organization.devices.connect")
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const found = await requireOrganizationDevice(
				ctx.db,
				input.id,
				ctx.organization.id,
			);
			await connectionManager.logout(input.id);
			await writeAuditLog(ctx, {
				action: "device.logged_out",
				targetType: "device",
				targetId: found.id,
				targetDisplay: found.name,
				metadata: { provider: found.provider },
			});
			return { success: true };
		}),

	getQR: organizationPermissionProcedure("organization.devices.connect")
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await requireOrganizationDevice(ctx.db, input.id, ctx.organization.id);
			return { qrCode: connectionManager.getQrCode(input.id) };
		}),

	startSync: organizationPermissionProcedure("organization.devices.connect")
		.input(
			z.object({
				id: z.string().min(1),
				resource: z.enum(["contacts", "groups", "newsletters", "all"]),
				mode: z.enum(["normal", "repair"]).default("normal"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const found = await requireOrganizationDevice(
				ctx.db,
				input.id,
				ctx.organization.id,
			);
			requireConnectedBaileysDevice(found);
			return startDeviceResourceSync({
				deviceId: found.id,
				requestedByUserId: ctx.session.user.id,
				resource: input.resource,
				mode: input.mode,
				db: ctx.db,
			});
		}),

	syncStatus: organizationPermissionProcedure("organization.devices.read")
		.input(
			z.object({
				id: z.string().min(1),
				limit: z.number().min(1).max(100).default(30),
			}),
		)
		.query(async ({ ctx, input }) => {
			await requireOrganizationDevice(ctx.db, input.id, ctx.organization.id);
			return listDeviceResourceSyncRuns({
				deviceId: input.id,
				limit: input.limit,
				db: ctx.db,
			});
		}),

	status: organizationPermissionProcedure("organization.devices.read")
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const found = await requireOrganizationDevice(
				ctx.db,
				input.id,
				ctx.organization.id,
			);
			return {
				id: found.id,
				provider: found.provider,
				status:
					found.provider === "baileys"
						? (connectionManager.getConnection(input.id)?.status ??
							found.status)
						: found.status,
				phoneNumber: found.phoneNumber,
			};
		}),
});
