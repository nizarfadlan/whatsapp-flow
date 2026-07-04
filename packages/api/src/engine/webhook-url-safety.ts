import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpAddress(address: string) {
	if (address === "::1" || address.toLowerCase().startsWith("fe80:")) {
		return true;
	}
	if (address.startsWith("::ffff:")) {
		return isPrivateIpAddress(address.slice("::ffff:".length));
	}

	const parts = address.split(".").map((part) => Number(part));
	if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
		const [a, b] = parts as [number, number, number, number];
		return (
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a === 0
		);
	}

	return address.startsWith("fc") || address.startsWith("fd");
}

export async function assertSafeOutboundWebhookUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Webhook URL is invalid");
	}

	if (url.protocol !== "https:") {
		throw new Error("Webhook URL must use HTTPS");
	}
	if (url.username || url.password) {
		throw new Error("Webhook URL cannot include credentials");
	}

	const hostname = url.hostname.toLowerCase();
	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		throw new Error("Webhook URL cannot target localhost");
	}

	let resolved: { address: string }[];
	try {
		resolved = isIP(hostname)
			? [{ address: hostname }]
			: await lookup(hostname, { all: true });
	} catch {
		throw new Error("Webhook URL host cannot be resolved");
	}
	if (resolved.some((item) => isPrivateIpAddress(item.address))) {
		throw new Error("Webhook URL cannot target private networks");
	}
}

export async function fetchSafeOutboundWebhookUrl(
	value: string,
	body: string,
	headers: Record<string, string>,
) {
	let currentUrl = value;
	for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
		await assertSafeOutboundWebhookUrl(currentUrl);
		const response = await fetch(currentUrl, {
			method: "POST",
			headers,
			body,
			redirect: "manual",
			signal: AbortSignal.timeout(10_000),
		});

		if (![301, 302, 303, 307, 308].includes(response.status)) {
			return response;
		}

		const location = response.headers.get("location");
		if (!location) return response;
		currentUrl = new URL(location, currentUrl).toString();
	}

	throw new Error("Webhook URL redirected too many times");
}
