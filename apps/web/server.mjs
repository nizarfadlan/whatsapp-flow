import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import serverEntry from "./dist/server/server.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const clientDir = join(currentDir, "dist", "client");
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3001);

const contentTypes = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

const server = createServer(async (nodeRequest, nodeResponse) => {
	try {
		if (nodeRequest.url === "/healthz") {
			nodeResponse.writeHead(200, { "content-type": "text/plain" });
			nodeResponse.end("OK");
			return;
		}

		if (await serveStaticAsset(nodeRequest, nodeResponse)) return;

		const request = createWebRequest(nodeRequest);
		const response = await serverEntry.fetch(request);
		await sendWebResponse(nodeResponse, response);
	} catch (error) {
		console.error("Failed to handle web request", error);
		if (!nodeResponse.headersSent) {
			nodeResponse.writeHead(500, { "content-type": "text/plain" });
		}
		nodeResponse.end("Internal Server Error");
	}
});

server.listen(port, host, () => {
	console.log(`Web server listening on http://${host}:${port}`);
});

async function serveStaticAsset(nodeRequest, nodeResponse) {
	if (nodeRequest.method !== "GET" && nodeRequest.method !== "HEAD")
		return false;

	const url = new URL(nodeRequest.url ?? "/", "http://localhost");
	const pathname = decodeURIComponent(url.pathname);
	const relativePath = normalize(pathname).replace(/^([/\\])+/, "");
	if (
		!relativePath ||
		relativePath.startsWith("..") ||
		relativePath.includes(`${sep}..${sep}`)
	) {
		return false;
	}

	const filePath = resolve(clientDir, relativePath);
	if (!filePath.startsWith(`${clientDir}${sep}`)) return false;

	try {
		const fileStat = await stat(filePath);
		if (!fileStat.isFile()) return false;

		const headers = {
			"content-length": fileStat.size,
			"content-type":
				contentTypes[extname(filePath)] ?? "application/octet-stream",
		};
		if (relativePath.startsWith("assets/")) {
			headers["cache-control"] = "public, max-age=31536000, immutable";
		}

		nodeResponse.writeHead(200, headers);
		if (nodeRequest.method === "HEAD") {
			nodeResponse.end();
			return true;
		}
		createReadStream(filePath).pipe(nodeResponse);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

function createWebRequest(nodeRequest) {
	const headers = new Headers();
	for (const [key, value] of Object.entries(nodeRequest.headers)) {
		if (Array.isArray(value)) {
			for (const item of value) headers.append(key, item);
		} else if (value !== undefined) {
			headers.set(key, value);
		}
	}

	const hostHeader = headers.get("host") ?? `localhost:${port}`;
	const protocol = headers.get("x-forwarded-proto") ?? "http";
	const body =
		nodeRequest.method === "GET" || nodeRequest.method === "HEAD"
			? undefined
			: nodeRequest;

	return new Request(`${protocol}://${hostHeader}${nodeRequest.url ?? "/"}`, {
		method: nodeRequest.method,
		headers,
		body,
		duplex: body ? "half" : undefined,
	});
}

async function sendWebResponse(nodeResponse, webResponse) {
	nodeResponse.statusCode = webResponse.status;
	for (const [key, value] of webResponse.headers) {
		if (key !== "set-cookie") nodeResponse.setHeader(key, value);
	}

	const setCookies = webResponse.headers.getSetCookie?.() ?? [];
	if (setCookies.length > 0) nodeResponse.setHeader("set-cookie", setCookies);

	if (!webResponse.body) {
		nodeResponse.end();
		return;
	}

	Readable.fromWeb(webResponse.body).pipe(nodeResponse);
}
