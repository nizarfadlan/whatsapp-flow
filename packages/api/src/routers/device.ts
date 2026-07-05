import { TRPCError } from "@trpc/server";
import { device } from "@whatsapp-flow/db/schema/device";
import {
	configureMetaDevice,
	connectionManager,
	getMetaConfigSummary,
} from "@whatsapp-flow/whatsapp";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

async function requireDeviceOwnership(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	deviceId: string,
	userId: string,
) {
	const rows = await db
		.select()
		.from(device)
		.where(and(eq(device.id, deviceId), eq(device.userId, userId)))
		.limit(1);

	const found = rows[0];
	if (!found) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
	}

	return found;
}

export const deviceRouter = router({
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select({
				id: device.id,
				name: device.name,
				provider: device.provider,
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
			.where(eq(device.userId, ctx.session.user.id))
			.orderBy(desc(device.updatedAt));
	}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				provider: z.enum(["baileys", "meta_cloud"]).default("baileys"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const id = crypto.randomUUID();
			const rows = await ctx.db
				.insert(device)
				.values({
					id,
					userId: ctx.session.user.id,
					name: input.name,
					provider: input.provider,
				})
				.returning({
					id: device.id,
					name: device.name,
					provider: device.provider,
					status: device.status,
				});

			return rows[0];
		}),

	configureMeta: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				phoneNumberId: z.string().min(1),
				accessToken: z.string().min(1).optional(),
				appSecret: z.string().min(1).optional(),
				businessAccountId: z.string().optional(),
				displayPhoneNumber: z.string().optional(),
				graphApiVersion: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const found = await requireDeviceOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);
			if (found.provider !== "meta_cloud") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Device is not a Meta Cloud API connection",
				});
			}

			try {
				return await configureMetaDevice({
					deviceId: input.id,
					phoneNumberId: input.phoneNumberId,
					accessToken: input.accessToken,
					appSecret: input.appSecret,
					businessAccountId: input.businessAccountId,
					displayPhoneNumber: input.displayPhoneNumber,
					graphApiVersion: input.graphApiVersion,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to configure Meta connection",
				});
			}
		}),

	getMetaConfig: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const found = await requireDeviceOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);
			if (found.provider !== "meta_cloud") return null;
			return getMetaConfigSummary(input.id);
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireDeviceOwnership(ctx.db, input.id, ctx.session.user.id);
			await connectionManager.disconnect(input.id);
			await ctx.db.delete(device).where(eq(device.id, input.id));
			return { success: true };
		}),

	connect: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireDeviceOwnership(ctx.db, input.id, ctx.session.user.id);
			const connection = await connectionManager.connect(input.id);
			return {
				id: input.id,
				status: connection.status,
				qrCode: connection.qrCode,
			};
		}),

	requestPairingCode: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				phoneNumber: z.string().min(6),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await requireDeviceOwnership(ctx.db, input.id, ctx.session.user.id);
			const code = await connectionManager.requestPairingCode(
				input.id,
				input.phoneNumber,
			);
			return { code };
		}),

	disconnect: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireDeviceOwnership(ctx.db, input.id, ctx.session.user.id);
			await connectionManager.disconnect(input.id);
			return { success: true };
		}),

	logout: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireDeviceOwnership(ctx.db, input.id, ctx.session.user.id);
			await connectionManager.logout(input.id);
			return { success: true };
		}),

	getQR: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await requireDeviceOwnership(ctx.db, input.id, ctx.session.user.id);
			return { qrCode: connectionManager.getQrCode(input.id) };
		}),

	status: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const found = await requireDeviceOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
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
