import { env } from "@whatsapp-flow/env/server";
import { storage } from "@whatsapp-flow/storage";
import {
	connectionManager,
	downloadMetaDeviceMedia,
} from "@whatsapp-flow/whatsapp";

export type WebhookMedia = {
	type: "image" | "video" | "audio" | "document" | "sticker";
	providerMediaId?: string;
	mimeType?: string | null;
	fileName?: string | null;
	caption?: string | null;
	size?: number | null;
	sha256?: string | null;
	stored: boolean;
	storage?: {
		driver: "local" | "s3";
		key: string;
		url: string;
	} | null;
	storageError?: string;
};

type MediaCandidate = {
	type: WebhookMedia["type"];
	providerMediaId?: string;
	mimeType?: string;
	fileName?: string;
	caption?: string;
	sha256?: string;
	size?: number;
};

type DownloadedMedia = {
	bytes: Uint8Array;
	mimeType?: string;
	size?: number;
	sha256?: string;
};

export async function enrichInboundMedia(input: {
	deviceId: string;
	provider: string;
	providerMessageId?: string;
	messageType: string;
	raw: unknown;
	autoDownload?: boolean;
}): Promise<{
	raw: Record<string, unknown> | null;
	media: WebhookMedia | null;
}> {
	if (!input.raw || typeof input.raw !== "object") {
		return { raw: null, media: null };
	}

	const raw = input.raw as Record<string, unknown>;
	const candidate = getInboundMedia(input.provider, input.messageType, raw);
	if (!candidate) return { raw, media: null };

	const shouldDownload = input.autoDownload ?? env.INBOUND_MEDIA_AUTO_DOWNLOAD;
	if (!shouldDownload || !input.providerMessageId) {
		const media = toUnstoredMedia(candidate);
		return { raw: { ...raw, media }, media };
	}

	try {
		const downloaded =
			input.provider === "meta_cloud"
				? await downloadMetaMedia(input.deviceId, candidate)
				: await downloadBaileysMedia(input.deviceId, input.raw);
		const mimeType = downloaded.mimeType ?? candidate.mimeType;
		const fileName =
			candidate.fileName ??
			`${candidate.providerMediaId ?? input.providerMessageId}${extensionForMime(mimeType)}`;
		const key = [
			"whatsapp",
			input.provider === "meta_cloud" ? "meta" : "baileys",
			input.deviceId,
			input.providerMessageId,
			sanitizeFileName(fileName),
		].join("/");
		const stored = await storage.put(
			key,
			downloaded.bytes,
			mimeType ?? "application/octet-stream",
		);
		const media: WebhookMedia = {
			type: candidate.type,
			providerMediaId: candidate.providerMediaId,
			mimeType: mimeType ?? null,
			fileName,
			caption: candidate.caption ?? null,
			size:
				downloaded.size ??
				candidate.size ??
				downloaded.bytes.byteLength ??
				null,
			sha256: candidate.sha256 ?? downloaded.sha256 ?? null,
			stored: true,
			storage: {
				driver: storage.driver,
				key: stored.key,
				url: stored.url,
			},
		};

		return { raw: { ...raw, media }, media };
	} catch (error) {
		const storageError =
			error instanceof Error ? error.message : "Failed to store media";
		const media = { ...toUnstoredMedia(candidate), storageError };
		console.warn("Failed to store inbound WhatsApp media", {
			deviceId: input.deviceId,
			provider: input.provider,
			providerMessageId: input.providerMessageId,
			mediaType: candidate.type,
			providerMediaId: candidate.providerMediaId,
			error: storageError,
		});
		return { raw: { ...raw, media, mediaDownloadError: storageError }, media };
	}
}

function getInboundMedia(
	provider: string,
	messageType: string,
	raw: Record<string, unknown>,
): MediaCandidate | null {
	if (provider === "meta_cloud") return getMetaInboundMedia(messageType, raw);
	return getBaileysInboundMedia(raw);
}

function getMetaInboundMedia(
	messageType: string,
	raw: Record<string, unknown>,
): MediaCandidate | null {
	if (!["image", "video", "audio", "document"].includes(messageType)) {
		return null;
	}
	const media = raw[messageType];
	if (!media || typeof media !== "object") return null;
	const mediaRecord = media as Record<string, unknown>;
	const id = getString(mediaRecord.id);
	if (!id) return null;
	return {
		type: messageType as MediaCandidate["type"],
		providerMediaId: id,
		mimeType: getString(mediaRecord.mime_type),
		fileName: getString(mediaRecord.filename),
		caption: getString(mediaRecord.caption),
		sha256: getString(mediaRecord.sha256),
	};
}

function getBaileysInboundMedia(
	raw: Record<string, unknown>,
): MediaCandidate | null {
	const content = raw.message;
	if (!content || typeof content !== "object") return null;
	const contentRecord = content as Record<string, unknown>;
	const entries: [string, WebhookMedia["type"]][] = [
		["imageMessage", "image"],
		["videoMessage", "video"],
		["audioMessage", "audio"],
		["documentMessage", "document"],
		["stickerMessage", "sticker"],
	];

	for (const [key, type] of entries) {
		const value = contentRecord[key];
		if (!value || typeof value !== "object") continue;
		const media = value as Record<string, unknown>;
		return {
			type,
			mimeType: getString(media.mimetype),
			fileName: getString(media.fileName),
			caption: getString(media.caption),
			sha256: bytesToBase64(media.fileSha256),
			size: getNumber(media.fileLength),
		};
	}

	return null;
}

async function downloadMetaMedia(
	deviceId: string,
	media: MediaCandidate,
): Promise<DownloadedMedia> {
	if (!media.providerMediaId) throw new Error("Meta media ID is missing");
	const downloaded = await downloadMetaDeviceMedia(
		deviceId,
		media.providerMediaId,
	);
	return {
		bytes: downloaded.bytes,
		mimeType: downloaded.mimeType ?? undefined,
		size: downloaded.size ?? undefined,
		sha256: downloaded.sha256 ?? undefined,
	};
}

async function downloadBaileysMedia(
	deviceId: string,
	raw: unknown,
): Promise<DownloadedMedia> {
	const downloaded = await connectionManager.downloadDeviceMedia(deviceId, raw);
	const bytes = new Uint8Array(downloaded);
	return { bytes };
}

function toUnstoredMedia(media: MediaCandidate): WebhookMedia {
	return {
		type: media.type,
		providerMediaId: media.providerMediaId,
		mimeType: media.mimeType ?? null,
		fileName: media.fileName ?? null,
		caption: media.caption ?? null,
		size: media.size ?? null,
		sha256: media.sha256 ?? null,
		stored: false,
		storage: null,
	};
}

function getString(value: unknown) {
	return typeof value === "string" && value ? value : undefined;
}

function getNumber(value: unknown) {
	if (typeof value === "number") return value;
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	if (value && typeof value === "object" && "toNumber" in value) {
		const toNumber = value.toNumber;
		if (typeof toNumber === "function") return toNumber.call(value) as number;
	}
	return undefined;
}

function bytesToBase64(value: unknown) {
	if (!value) return undefined;
	if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
	if (Array.isArray(value)) return Buffer.from(value).toString("base64");
	return undefined;
}

function sanitizeFileName(value: string) {
	return value.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "media";
}

function extensionForMime(value?: string | null) {
	if (!value) return "";
	const subtype = value.split("/")[1]?.split(";")[0];
	return subtype ? `.${subtype.replace(/[^\w.-]+/g, "")}` : "";
}
