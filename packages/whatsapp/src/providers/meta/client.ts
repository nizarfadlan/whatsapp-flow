import { env } from "@whatsapp-flow/env/server";
import type { OutgoingMessage } from "../../message-sender";

const GRAPH_BASE_URL = "https://graph.facebook.com";

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
		const message =
			json?.error?.message ??
			`Meta Graph API request failed with status ${response.status}`;
		throw new Error(message);
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
