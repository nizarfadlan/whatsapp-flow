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
	downloadMetaMedia,
	exchangeMetaOAuthCode,
	type MetaCredentials,
	MetaGraphError,
	sendMetaMessage,
	validateMetaPhoneNumber,
} from "./client";

export const META_ACCESS_TOKEN_SECRET = "meta_access_token";
export const META_APP_SECRET_SECRET = "meta_app_secret";

type MetaTokenSource = "manual" | "embedded_signup";

type MetaTokenMetadata = {
	source?: MetaTokenSource;
	type?: string | null;
	receivedAt?: string;
	expiresAt?: string | null;
	lastValidatedAt?: string;
};

type MetaProviderConfig = {
	graphApiVersion?: string | null;
	verifiedName?: string | null;
	qualityRating?: string | null;
	token?: MetaTokenMetadata;
	[key: string]: unknown;
};

export type ConfigureMetaDeviceInput = {
	deviceId: string;
	phoneNumberId: string;
	accessToken?: string;
	appSecret?: string;
	businessAccountId?: string | null;
	displayPhoneNumber?: string | null;
	graphApiVersion?: string | null;
	tokenSource?: MetaTokenSource;
	tokenType?: string | null;
	tokenExpiresAt?: Date | null;
};

export async function configureMetaDevice(input: ConfigureMetaDeviceInput) {
	const existingConfig = await getMetaProviderConfig(input.deviceId);
	const credentials = await getCandidateMetaCredentials(input);
	const phone = await validateMetaDevice(input.deviceId, credentials);
	const validatedAt = new Date();

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
			lastConnectedAt: validatedAt,
			providerConfig: buildMetaProviderConfig(existingConfig, input, {
				graphApiVersion: credentials.graphApiVersion ?? null,
				verifiedName: phone.verified_name ?? null,
				qualityRating: phone.quality_rating ?? null,
				validatedAt,
			}),
			capabilities: metaCloudCapabilities,
		})
		.where(eq(device.id, input.deviceId));

	return getMetaConfigSummary(input.deviceId);
}

export type ConfigureMetaDeviceFromEmbeddedSignupInput = Omit<
	ConfigureMetaDeviceInput,
	"accessToken" | "appSecret"
> & {
	code: string;
	redirectUri?: string | null;
};

export async function configureMetaDeviceFromEmbeddedSignup(
	input: ConfigureMetaDeviceFromEmbeddedSignupInput,
) {
	const token = await exchangeMetaOAuthCode({
		code: input.code,
		redirectUri: input.redirectUri,
		graphApiVersion: input.graphApiVersion,
	});

	return configureMetaDevice({
		...input,
		accessToken: token.accessToken,
		appSecret: undefined,
		tokenSource: "embedded_signup",
		tokenType: token.tokenType,
		tokenExpiresAt: token.expiresIn
			? new Date(Date.now() + token.expiresIn * 1000)
			: null,
	});
}

export async function connectMetaDevice(deviceId: string) {
	const existingConfig = await getMetaProviderConfig(deviceId);
	const credentials = await getMetaCredentials(deviceId);
	const phone = await validateMetaDevice(deviceId, credentials);
	const displayPhoneNumber = phone.display_phone_number ?? null;
	const validatedAt = new Date();

	await db
		.update(device)
		.set({
			phoneNumber: normalizePhone(displayPhoneNumber),
			displayPhoneNumber,
			status: "connected",
			statusReason: null,
			lastError: null,
			lastConnectedAt: validatedAt,
			providerConfig: buildMetaProviderConfig(
				existingConfig,
				{},
				{
					graphApiVersion: credentials.graphApiVersion ?? null,
					verifiedName: phone.verified_name ?? null,
					qualityRating: phone.quality_rating ?? null,
					validatedAt,
				},
			),
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
	const providerConfig = row.providerConfig as MetaProviderConfig | null;
	return {
		...row,
		tokenMetadata: providerConfig?.token ?? null,
		hasAccessToken: secrets.has(META_ACCESS_TOKEN_SECRET),
		hasAppSecret: secrets.has(META_APP_SECRET_SECRET),
	};
}

export async function getMetaAppSecret(deviceId: string) {
	return getProviderSecret(deviceId, META_APP_SECRET_SECRET);
}

export async function downloadMetaDeviceMedia(
	deviceId: string,
	mediaId: string,
) {
	const credentials = await getMetaCredentials(deviceId);
	return downloadMetaMedia({ credentials, mediaId });
}

async function getMetaProviderConfig(deviceId: string) {
	const [row] = await db
		.select({ providerConfig: device.providerConfig })
		.from(device)
		.where(eq(device.id, deviceId))
		.limit(1);
	return (row?.providerConfig as MetaProviderConfig | null) ?? null;
}

function buildMetaProviderConfig(
	existingConfig: MetaProviderConfig | null,
	input: Partial<ConfigureMetaDeviceInput>,
	phone: {
		graphApiVersion: string | null;
		verifiedName: string | null;
		qualityRating: string | null;
		validatedAt: Date;
	},
): MetaProviderConfig {
	return {
		...(existingConfig ?? {}),
		graphApiVersion: phone.graphApiVersion,
		verifiedName: phone.verifiedName,
		qualityRating: phone.qualityRating,
		token: buildTokenMetadata(existingConfig?.token, input, phone.validatedAt),
	};
}

function buildTokenMetadata(
	existingToken: MetaTokenMetadata | undefined,
	input: Partial<ConfigureMetaDeviceInput>,
	validatedAt: Date,
): MetaTokenMetadata | undefined {
	if (!input.accessToken && !existingToken) return undefined;
	const lastValidatedAt = validatedAt.toISOString();
	if (!input.accessToken) {
		return { ...existingToken, lastValidatedAt };
	}

	return {
		source: input.tokenSource ?? "manual",
		type: input.tokenType ?? existingToken?.type ?? null,
		receivedAt: validatedAt.toISOString(),
		expiresAt: input.tokenExpiresAt?.toISOString() ?? null,
		lastValidatedAt,
	};
}

async function getCandidateMetaCredentials(
	input: ConfigureMetaDeviceInput,
): Promise<MetaCredentials> {
	const [row] = await db
		.select({ providerConfig: device.providerConfig })
		.from(device)
		.where(eq(device.id, input.deviceId))
		.limit(1);
	const providerConfig = row?.providerConfig as {
		graphApiVersion?: string | null;
	} | null;
	const accessToken =
		input.accessToken ??
		(await getProviderSecret(input.deviceId, META_ACCESS_TOKEN_SECRET));

	if (!accessToken || !input.phoneNumberId) {
		throw new Error("Meta WhatsApp credentials are incomplete");
	}

	return {
		accessToken,
		phoneNumberId: input.phoneNumberId,
		graphApiVersion:
			input.graphApiVersion ?? providerConfig?.graphApiVersion ?? null,
	};
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

async function validateMetaDevice(
	deviceId: string,
	credentials: MetaCredentials,
) {
	try {
		return await validateMetaPhoneNumber(credentials);
	} catch (error) {
		await db
			.update(device)
			.set({
				status: "disconnected",
				statusReason: "meta_validation_failed",
				lastError: describeMetaError(error),
			})
			.where(eq(device.id, deviceId));
		throw error;
	}
}

function describeMetaError(error: unknown) {
	if (error instanceof MetaGraphError) {
		const suffix = [
			error.details.code ? `code ${error.details.code}` : null,
			error.details.subcode ? `subcode ${error.details.subcode}` : null,
			error.details.fbtraceId ? `fbtrace ${error.details.fbtraceId}` : null,
		]
			.filter(Boolean)
			.join(", ");
		return suffix ? `${error.message} (${suffix})` : error.message;
	}

	return error instanceof Error
		? error.message
		: "Failed to validate Meta device";
}

function normalizePhone(value: string | null) {
	const normalized = value?.replace(/[^\d]/g, "") ?? "";
	return normalized || null;
}
