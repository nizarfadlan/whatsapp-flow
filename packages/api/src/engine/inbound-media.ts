import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@whatsapp-flow/env/server";
import { storage } from "@whatsapp-flow/storage";
import {
	connectionManager,
	downloadMetaDeviceMedia,
} from "@whatsapp-flow/whatsapp";
import { normalizeMessageContent } from "baileys";

export type MediaErrorCode =
	| "oversize"
	| "timeout"
	| "reupload"
	| "network"
	| "download"
	| "integrity"
	| "storage";

export type WebhookMedia = {
	type: "image" | "video" | "audio" | "document" | "sticker";
	providerMediaId?: string;
	mimeType?: string | null;
	fileName?: string | null;
	caption?: string | null;
	size?: number | null;
	sha256?: string | null;
	status: "metadata_only" | "stored" | "failed";
	error?: { code: MediaErrorCode; message: string; retryable: boolean };
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

class MediaDownloadFailure extends Error {
	constructor(
		readonly code: MediaErrorCode,
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
		this.name = "MediaDownloadFailure";
	}
}

class BoundedSemaphore {
	private active = 0;
	private readonly waiters: (() => void)[] = [];

	constructor(private readonly limit: number) {}

	async acquire() {
		if (this.active < this.limit) {
			this.active++;
			return;
		}
		await new Promise<void>((resolve) => this.waiters.push(resolve));
	}

	release() {
		const waiter = this.waiters.shift();
		if (waiter) {
			waiter();
			return;
		}
		this.active--;
	}
}

const downloadSemaphore = new BoundedSemaphore(
	env.INBOUND_MEDIA_DOWNLOAD_CONCURRENCY,
);

export async function enrichInboundMedia(input: {
	inboxMessageId: string;
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
		const media = toUnstoredMedia(candidate, "metadata_only");
		return { raw: { ...raw, media }, media };
	}

	if (candidate.size && candidate.size > env.INBOUND_MEDIA_MAX_BYTES) {
		return failedResult(
			raw,
			candidate,
			input,
			new MediaDownloadFailure(
				"oversize",
				"Media exceeds the inbound download limit",
				false,
			),
		);
	}

	try {
		const downloaded = await downloadWithLimit(input.provider, () =>
			input.provider === "meta_cloud"
				? downloadMetaMedia(input.deviceId, candidate)
				: downloadBaileysMedia(input.deviceId, input.raw),
		);
		if (downloaded.bytes.byteLength > env.INBOUND_MEDIA_MAX_BYTES) {
			throw new MediaDownloadFailure(
				"oversize",
				"Media exceeds the inbound download limit",
				false,
			);
		}
		verifySha256(downloaded.bytes, candidate.sha256 ?? downloaded.sha256);

		const mimeType = downloaded.mimeType ?? candidate.mimeType;
		const fileName =
			candidate.fileName ??
			`${candidate.providerMediaId ?? input.providerMessageId}${extensionForMime(mimeType)}`;
		const key = buildStorageKey({
			provider: input.provider,
			deviceId: input.deviceId,
			providerMessageId: input.providerMessageId,
			bytes: downloaded.bytes,
			mimeType,
		});
		let stored: Awaited<ReturnType<typeof storage.put>>;
		try {
			stored = await storage.put(
				key,
				downloaded.bytes,
				mimeType ?? "application/octet-stream",
			);
		} catch {
			throw new MediaDownloadFailure("storage", "Media storage failed", true);
		}
		const media: WebhookMedia = {
			type: candidate.type,
			providerMediaId: candidate.providerMediaId,
			mimeType: mimeType ?? null,
			fileName,
			caption: candidate.caption ?? null,
			size: downloaded.size ?? candidate.size ?? downloaded.bytes.byteLength,
			sha256: candidate.sha256 ?? downloaded.sha256 ?? null,
			status: "stored",
			stored: true,
			storage: {
				driver: storage.driver,
				key: stored.key,
				url: inboxMediaUrl(input.inboxMessageId),
			},
		};

		return { raw: { ...raw, media }, media };
	} catch (error) {
		return failedResult(raw, candidate, input, error);
	}
}

function inboxMediaUrl(inboxMessageId: string) {
	return `${(env.PUBLIC_BASE_URL ?? env.AUTH_URL).replace(/\/$/, "")}/api/inbox/media/${encodeURIComponent(inboxMessageId)}`;
}

function failedResult(
	raw: Record<string, unknown>,
	candidate: MediaCandidate,
	input: { deviceId: string; provider: string; providerMessageId?: string },
	error: unknown,
) {
	const mediaError = toMediaError(error);
	const media = {
		...toUnstoredMedia(candidate, "failed"),
		error: mediaError,
		...(mediaError.code === "storage"
			? { storageError: mediaError.message }
			: {}),
	};
	console.warn("Failed to store inbound WhatsApp media", {
		deviceId: input.deviceId,
		provider: input.provider,
		providerMessageId: input.providerMessageId,
		mediaType: candidate.type,
		providerMediaId: candidate.providerMediaId,
		error: mediaError.code,
	});
	return {
		raw: { ...raw, media, mediaDownloadError: mediaError.message },
		media,
	};
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
		size: getNumber(mediaRecord.file_size),
	};
}

function getBaileysInboundMedia(
	raw: Record<string, unknown>,
): MediaCandidate | null {
	const message = raw.message;
	if (!message || typeof message !== "object") return null;
	const content = normalizeMessageContent(message as never) as
		| Record<string, unknown>
		| undefined;
	if (!content) return null;
	const entries: [string, WebhookMedia["type"]][] = [
		["imageMessage", "image"],
		["videoMessage", "video"],
		["audioMessage", "audio"],
		["documentMessage", "document"],
		["stickerMessage", "sticker"],
	];

	for (const [key, type] of entries) {
		const value = content[key];
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

async function downloadWithLimit(
	provider: string,
	download: () => Promise<DownloadedMedia>,
) {
	await downloadSemaphore.acquire();
	const pending = Promise.resolve().then(download);
	void pending
		.finally(() => downloadSemaphore.release())
		.catch(() => undefined);
	try {
		return await withTimeout(pending, env.INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS);
	} catch (error) {
		throw classifyDownloadError(provider, error);
	}
}

async function downloadMetaMedia(deviceId: string, media: MediaCandidate) {
	if (!media.providerMediaId) {
		throw new MediaDownloadFailure("download", "Media download failed", false);
	}
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

async function downloadBaileysMedia(deviceId: string, raw: unknown) {
	const downloaded = await connectionManager.downloadDeviceMedia(deviceId, raw);
	return { bytes: new Uint8Array(downloaded) };
}

function withTimeout<T>(pending: Promise<T>, timeoutMs: number) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new MediaDownloadFailure("timeout", "Media download timed out", true),
				),
			timeoutMs,
		);
	});
	return Promise.race([pending, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

function verifySha256(bytes: Uint8Array, expected?: string) {
	if (!expected) return;
	const actual = createHash("sha256").update(bytes).digest();
	const normalized = normalizeSha256(expected);
	if (
		!normalized ||
		normalized.length !== actual.length ||
		!timingSafeEqual(actual, normalized)
	) {
		throw new MediaDownloadFailure(
			"integrity",
			"Media integrity verification failed",
			false,
		);
	}
}

function normalizeSha256(value: string) {
	const trimmed = value.trim();
	if (/^[a-f\d]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
	try {
		const decoded = Buffer.from(trimmed, "base64");
		return decoded.length === 32 ? decoded : undefined;
	} catch {
		return undefined;
	}
}

function buildStorageKey(input: {
	provider: string;
	deviceId: string;
	providerMessageId: string;
	bytes: Uint8Array;
	mimeType?: string;
}) {
	const provider = input.provider === "meta_cloud" ? "meta" : "baileys";
	return [
		"whatsapp",
		provider,
		digest(input.deviceId),
		digest(input.providerMessageId),
		`${createHash("sha256").update(input.bytes).digest("hex")}${extensionForMime(input.mimeType)}`,
	].join("/");
}

function digest(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function classifyDownloadError(
	provider: string,
	error: unknown,
): MediaDownloadFailure {
	if (error instanceof MediaDownloadFailure) return error;
	if (error && typeof error === "object" && "code" in error) {
		const code = error.code;
		if (code === "oversize" || code === "timeout" || code === "network") {
			return new MediaDownloadFailure(
				code,
				code === "timeout"
					? "Media download timed out"
					: code === "oversize"
						? "Media exceeds the inbound download limit"
						: "Media download failed",
				code !== "oversize",
			);
		}
	}
	const message = error instanceof Error ? error.message.toLowerCase() : "";
	if (message.includes("reupload")) {
		return new MediaDownloadFailure(
			"reupload",
			"Media reupload is required",
			true,
		);
	}
	if (
		message.includes("network") ||
		message.includes("fetch") ||
		message.includes("socket")
	) {
		return new MediaDownloadFailure("network", "Media download failed", true);
	}
	return new MediaDownloadFailure(
		"download",
		"Media download failed",
		provider !== "meta_cloud",
	);
}

function toMediaError(error: unknown): NonNullable<WebhookMedia["error"]> {
	if (error instanceof MediaDownloadFailure) {
		return {
			code: error.code,
			message: error.message,
			retryable: error.retryable,
		};
	}
	return { code: "storage", message: "Media storage failed", retryable: true };
}

function toUnstoredMedia(
	media: MediaCandidate,
	status: "metadata_only" | "failed",
): WebhookMedia {
	return {
		type: media.type,
		providerMediaId: media.providerMediaId,
		mimeType: media.mimeType ?? null,
		fileName: media.fileName ?? null,
		caption: media.caption ?? null,
		size: media.size ?? null,
		sha256: media.sha256 ?? null,
		status,
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

function extensionForMime(value?: string | null) {
	if (!value) return "";
	const subtype = value.split("/")[1]?.split(";")[0];
	return subtype ? `.${subtype.replace(/[^\w.-]+/g, "")}` : "";
}
