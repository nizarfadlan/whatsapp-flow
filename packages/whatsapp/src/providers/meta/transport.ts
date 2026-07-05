import { db } from "@whatsapp-flow/db";
import { device } from "@whatsapp-flow/db/schema/device";
import { eq } from "drizzle-orm";
import type { OutgoingMessage } from "../../message-sender";
import {
	deleteProviderSecrets,
	getProviderSecret,
	getProviderSecretSummary,
	upsertProviderSecret,
} from "../../secrets";
import { metaCloudCapabilities } from "../types";
import {
	type MetaCredentials,
	sendMetaMessage,
	validateMetaPhoneNumber,
} from "./client";

export const META_ACCESS_TOKEN_SECRET = "meta_access_token";
export const META_APP_SECRET_SECRET = "meta_app_secret";

export type ConfigureMetaDeviceInput = {
	deviceId: string;
	phoneNumberId: string;
	accessToken?: string;
	appSecret?: string;
	businessAccountId?: string | null;
	displayPhoneNumber?: string | null;
	graphApiVersion?: string | null;
};

export async function configureMetaDevice(input: ConfigureMetaDeviceInput) {
	if (input.accessToken) {
		await upsertProviderSecret({
			deviceId: input.deviceId,
			provider: "meta_cloud",
			key: META_ACCESS_TOKEN_SECRET,
			value: input.accessToken,
		});
	}
	if (input.appSecret) {
		await upsertProviderSecret({
			deviceId: input.deviceId,
			provider: "meta_cloud",
			key: META_APP_SECRET_SECRET,
			value: input.appSecret,
		});
	}
	const credentials = await getMetaCredentials(input.deviceId, {
		phoneNumberId: input.phoneNumberId,
		graphApiVersion: input.graphApiVersion,
	});
	const phone = await validateMetaPhoneNumber(credentials);
	const displayPhoneNumber =
		phone.display_phone_number ?? input.displayPhoneNumber ?? null;

	await db
		.update(device)
		.set({
			provider: "meta_cloud",
			externalId: input.phoneNumberId,
			phoneNumber: normalizePhone(displayPhoneNumber),
			businessAccountId: input.businessAccountId ?? null,
			displayPhoneNumber,
			status: "connected",
			statusReason: null,
			lastError: null,
			lastConnectedAt: new Date(),
			providerConfig: {
				graphApiVersion: input.graphApiVersion ?? null,
				verifiedName: phone.verified_name ?? null,
				qualityRating: phone.quality_rating ?? null,
			},
			capabilities: metaCloudCapabilities,
		})
		.where(eq(device.id, input.deviceId));

	return getMetaConfigSummary(input.deviceId);
}

export async function connectMetaDevice(deviceId: string) {
	const credentials = await getMetaCredentials(deviceId);
	const phone = await validateMetaPhoneNumber(credentials);
	const displayPhoneNumber = phone.display_phone_number ?? null;

	await db
		.update(device)
		.set({
			phoneNumber: normalizePhone(displayPhoneNumber),
			displayPhoneNumber,
			status: "connected",
			statusReason: null,
			lastError: null,
			lastConnectedAt: new Date(),
			providerConfig: {
				graphApiVersion: credentials.graphApiVersion ?? null,
				verifiedName: phone.verified_name ?? null,
				qualityRating: phone.quality_rating ?? null,
			},
			capabilities: metaCloudCapabilities,
		})
		.where(eq(device.id, deviceId));

	return {
		provider: "meta_cloud" as const,
		status: "connected" as const,
		qrCode: null,
	};
}

export async function disconnectMetaDevice(deviceId: string) {
	await db
		.update(device)
		.set({ status: "disconnected", statusReason: "manually_disconnected" })
		.where(eq(device.id, deviceId));
}

export async function logoutMetaDevice(deviceId: string) {
	await deleteProviderSecrets(deviceId);
	await db
		.update(device)
		.set({
			status: "disconnected",
			statusReason: null,
			lastError: null,
			externalId: null,
			phoneNumber: null,
			businessAccountId: null,
			displayPhoneNumber: null,
			providerConfig: null,
			capabilities: metaCloudCapabilities,
		})
		.where(eq(device.id, deviceId));
}

export async function sendMetaDeviceMessage(
	deviceId: string,
	to: string,
	message: OutgoingMessage,
) {
	const credentials = await getMetaCredentials(deviceId);
	const response = await sendMetaMessage({ credentials, to, message });
	return {
		provider: "meta_cloud" as const,
		messageId: response.messages?.[0]?.id,
		raw: response,
	};
}

export async function getMetaConfigSummary(deviceId: string) {
	const [row] = await db
		.select({
			phoneNumberId: device.externalId,
			businessAccountId: device.businessAccountId,
			displayPhoneNumber: device.displayPhoneNumber,
			providerConfig: device.providerConfig,
			status: device.status,
		})
		.from(device)
		.where(eq(device.id, deviceId))
		.limit(1);
	if (!row) return null;

	const secrets = await getProviderSecretSummary(deviceId);
	return {
		...row,
		hasAccessToken: secrets.has(META_ACCESS_TOKEN_SECRET),
		hasAppSecret: secrets.has(META_APP_SECRET_SECRET),
	};
}

export async function getMetaAppSecret(deviceId: string) {
	return getProviderSecret(deviceId, META_APP_SECRET_SECRET);
}

async function getMetaCredentials(
	deviceId: string,
	overrides: { phoneNumberId?: string; graphApiVersion?: string | null } = {},
): Promise<MetaCredentials> {
	const [row] = await db
		.select({
			phoneNumberId: device.externalId,
			providerConfig: device.providerConfig,
		})
		.from(device)
		.where(eq(device.id, deviceId))
		.limit(1);

	const accessToken = await getProviderSecret(
		deviceId,
		META_ACCESS_TOKEN_SECRET,
	);
	const phoneNumberId = overrides.phoneNumberId ?? row?.phoneNumberId;
	if (!accessToken || !phoneNumberId) {
		throw new Error("Meta WhatsApp credentials are incomplete");
	}

	const providerConfig = row?.providerConfig as {
		graphApiVersion?: string | null;
	} | null;

	return {
		accessToken,
		phoneNumberId,
		graphApiVersion:
			overrides.graphApiVersion ?? providerConfig?.graphApiVersion ?? null,
	};
}

function normalizePhone(value: string | null) {
	const normalized = value?.replace(/[^\d]/g, "") ?? "";
	return normalized || null;
}
