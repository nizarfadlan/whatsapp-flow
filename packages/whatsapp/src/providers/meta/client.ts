import { env } from "@whatsapp-flow/env/server";
import type { OutgoingMessage } from "../../message-sender";

const GRAPH_BASE_URL = "https://graph.facebook.com";
const MAX_META_MEDIA_BYTES = 64 * 1024 * 1024;

type GraphErrorResponse = {
	error?: {
		message?: string;
		type?: string;
		code?: number;
		error_subcode?: number;
		fbtrace_id?: string;
	};
};

type MetaPhoneNumberResponse = {
	id: string;
	display_phone_number?: string;
	verified_name?: string;
	quality_rating?: string;
};

type MetaSendResponse = {
	messages?: { id?: string }[];
	contacts?: { input?: string; wa_id?: string }[];
};

type MetaOAuthTokenResponse = {
	access_token?: string;
	token_type?: string;
	expires_in?: number;
};

type MetaMediaResponse = {
	id?: string;
	url?: string;
	mime_type?: string;
	sha256?: string;
	file_size?: number;
};

export class MetaGraphError extends Error {
	constructor(
		message: string,
		readonly details: {
			status: number;
			code?: number;
			subcode?: number;
			type?: string;
			fbtraceId?: string;
			path: string;
		},
	) {
		super(message);
		this.name = "MetaGraphError";
	}
}

export type MetaCredentials = {
	accessToken: string;
	phoneNumberId: string;
	graphApiVersion?: string | null;
};

export async function validateMetaPhoneNumber(credentials: MetaCredentials) {
	return graphRequest<MetaPhoneNumberResponse>(
		credentials,
		`/${credentials.phoneNumberId}`,
		{
			method: "GET",
			query: {
				fields: "id,display_phone_number,verified_name,quality_rating",
			},
		},
	);
}

export async function sendMetaMessage(input: {
	credentials: MetaCredentials;
	to: string;
	message: OutgoingMessage;
}) {
	const payload = toMetaMessagePayload(input.to, input.message);
	return graphRequest<MetaSendResponse>(
		input.credentials,
		`/${input.credentials.phoneNumberId}/messages`,
		{
			method: "POST",
			body: payload,
		},
	);
}

export async function downloadMetaMedia(input: {
	credentials: MetaCredentials;
	mediaId: string;
}) {
	const metadata = await graphRequest<MetaMediaResponse>(
		input.credentials,
		`/${input.mediaId}`,
		{ method: "GET" },
	);
	if (!metadata.url) {
		throw new Error("Meta media metadata did not include a download URL");
	}
	if (metadata.file_size && metadata.file_size > MAX_META_MEDIA_BYTES) {
		throw new Error("Meta media file exceeds the inbound download limit");
	}

	const response = await fetch(metadata.url, {
		headers: { Authorization: `Bearer ${input.credentials.accessToken}` },
	});
	if (!response.ok) {
		throw new Error(
			`Meta media download failed with status ${response.status}`,
		);
	}

	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_META_MEDIA_BYTES) {
		throw new Error("Meta media file exceeds the inbound download limit");
	}

	return {
		bytes: new Uint8Array(await response.arrayBuffer()),
		mimeType: metadata.mime_type ?? response.headers.get("content-type"),
		size:
			metadata.file_size ??
			(Number.isFinite(contentLength) ? contentLength : null),
		sha256: metadata.sha256 ?? null,
	};
}

export async function exchangeMetaOAuthCode(input: {
	code: string;
	redirectUri?: string | null;
	graphApiVersion?: string | null;
}) {
	if (!env.META_APP_ID || !env.META_APP_SECRET) {
		throw new Error(
			"Meta app ID and app secret are required for Embedded Signup",
		);
	}

	const response = await appGraphRequest<MetaOAuthTokenResponse>(
		"/oauth/access_token",
		{
			client_id: env.META_APP_ID,
			client_secret: env.META_APP_SECRET,
			code: input.code,
			...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
		},
		input.graphApiVersion,
	);

	if (!response.access_token) {
		throw new Error("Meta OAuth code exchange did not return an access token");
	}

	return {
		accessToken: response.access_token,
		tokenType: response.token_type ?? null,
		expiresIn: response.expires_in ?? null,
	};
}

async function graphRequest<T>(
	credentials: MetaCredentials,
	path: string,
	options: {
		method: "GET" | "POST";
		query?: Record<string, string>;
		body?: Record<string, unknown>;
	},
) {
	const version = normalizeGraphApiVersion(credentials.graphApiVersion);
	const url = new URL(`${GRAPH_BASE_URL}/${version}${path}`);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		url.searchParams.set(key, value);
	}

	const response = await fetch(url, {
		method: options.method,
		headers: {
			Authorization: `Bearer ${credentials.accessToken}`,
			...(options.body ? { "Content-Type": "application/json" } : {}),
		},
		body: options.body ? JSON.stringify(options.body) : undefined,
	});

	const json = (await response.json().catch(() => null)) as
		| (T & GraphErrorResponse)
		| null;

	if (!response.ok) {
		const graphError = json?.error;
		const message =
			graphError?.message ??
			`Meta Graph API request failed with status ${response.status}`;
		throw new MetaGraphError(message, {
			status: response.status,
			code: graphError?.code,
			subcode: graphError?.error_subcode,
			type: graphError?.type,
			fbtraceId: graphError?.fbtrace_id,
			path,
		});
	}

	if (!json) {
		throw new Error("Meta Graph API returned an empty response");
	}

	return json as T;
}

async function appGraphRequest<T>(
	path: string,
	body: Record<string, string>,
	graphApiVersion?: string | null,
) {
	const version = normalizeGraphApiVersion(graphApiVersion);
	const url = new URL(`${GRAPH_BASE_URL}/${version}${path}`);
	const form = new URLSearchParams(body);

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: form,
	});
	const json = (await response.json().catch(() => null)) as
		| (T & GraphErrorResponse)
		| null;

	if (!response.ok) {
		const graphError = json?.error;
		const message =
			graphError?.message ??
			`Meta Graph API request failed with status ${response.status}`;
		throw new MetaGraphError(message, {
			status: response.status,
			code: graphError?.code,
			subcode: graphError?.error_subcode,
			type: graphError?.type,
			fbtraceId: graphError?.fbtrace_id,
			path,
		});
	}

	if (!json) {
		throw new Error("Meta Graph API returned an empty response");
	}

	return json as T;
}

function normalizeGraphApiVersion(value?: string | null) {
	const version = value?.trim() || env.META_GRAPH_API_VERSION;
	return version.startsWith("v") ? version : `v${version}`;
}

function toMetaMessagePayload(to: string, message: OutgoingMessage) {
	const base = {
		messaging_product: "whatsapp",
		to: normalizeRecipient(to),
	};

	switch (message.type) {
		case "text":
			return {
				...base,
				type: "text",
				text: { body: message.text, preview_url: false },
			};
		case "image":
			assertPublicHttpsUrl(message.url);
			return {
				...base,
				type: "image",
				image: { link: message.url, caption: message.caption },
			};
		case "video":
			assertPublicHttpsUrl(message.url);
			return {
				...base,
				type: "video",
				video: { link: message.url, caption: message.caption },
			};
		case "audio":
			assertPublicHttpsUrl(message.url);
			return { ...base, type: "audio", audio: { link: message.url } };
		case "document":
			assertPublicHttpsUrl(message.url);
			return {
				...base,
				type: "document",
				document: {
					link: message.url,
					filename: message.fileName,
					caption: message.caption,
				},
			};
		case "location":
			return {
				...base,
				type: "location",
				location: {
					latitude: message.latitude,
					longitude: message.longitude,
					name: message.name,
				},
			};
		case "template": {
			const name = message.name.trim();
			const languageCode = message.languageCode.trim();
			if (!name || !languageCode) {
				throw new Error(
					"Meta template messages require name and language code",
				);
			}
			const components = buildTemplateComponents(message);
			return {
				...base,
				type: "template",
				template: {
					name,
					language: { code: languageCode },
					...(components.length > 0 ? { components } : {}),
				},
			};
		}
		case "reaction": {
			if (!message.providerMessageId) {
				throw new Error("Meta reactions require a provider message id");
			}
			return {
				...base,
				type: "reaction",
				reaction: {
					message_id: message.providerMessageId,
					emoji: message.text,
				},
			};
		}
	}
}

function buildTemplateComponents(
	message: Extract<OutgoingMessage, { type: "template" }>,
) {
	const components: Record<string, unknown>[] = [];

	if (message.header) {
		components.push({
			type: "header",
			parameters: [toTemplateHeaderParameter(message.header)],
		});
	}

	const bodyParameters = message.bodyParameters ?? [];
	if (bodyParameters.length > 0) {
		components.push({
			type: "body",
			parameters: bodyParameters.map((text) => ({ type: "text", text })),
		});
	}

	return components;
}

function toTemplateHeaderParameter(
	header: Extract<OutgoingMessage, { type: "template" }>["header"],
) {
	if (!header) throw new Error("Meta template header is required");
	switch (header.type) {
		case "text":
			return { type: "text", text: header.text };
		case "image":
			assertPublicHttpsUrl(header.url);
			return { type: "image", image: { link: header.url } };
		case "video":
			assertPublicHttpsUrl(header.url);
			return { type: "video", video: { link: header.url } };
		case "document":
			assertPublicHttpsUrl(header.url);
			return {
				type: "document",
				document: {
					link: header.url,
					filename: header.fileName,
				},
			};
	}
}

function normalizeRecipient(value: string) {
	return value.split("@")[0]?.replace(/[^\d]/g, "") ?? value;
}

function assertPublicHttpsUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Meta media messages require an absolute public HTTPS URL");
	}

	if (url.protocol !== "https:") {
		throw new Error("Meta media messages require an HTTPS URL");
	}
}
