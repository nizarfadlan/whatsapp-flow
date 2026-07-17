import {
	access,
	link,
	mkdir,
	open,
	readFile,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env } from "@whatsapp-flow/env/server";
import { normalizeStorageKey, resolveStoragePath } from "./key";
import { createLocalUploadGrant } from "./local-upload-grant";
import type {
	LocalReadableStorage,
	LocalUploadResult,
	PresignedUpload,
	PresignPutOptions,
	StorageDriver,
	StoredObject,
} from "./types";

function localDir() {
	return env.LOCAL_UPLOAD_DIR ?? "uploads";
}

function publicBaseUrl() {
	return (env.PUBLIC_BASE_URL ?? env.AUTH_URL).replace(/\/$/, "");
}

async function writeAll(
	handle: Awaited<ReturnType<typeof open>>,
	bytes: Uint8Array,
) {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const { bytesWritten } = await handle.write(bytes, offset);
		if (bytesWritten === 0) throw new Error("Failed to write upload data");
		offset += bytesWritten;
	}
}

function isFileExistsError(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}

export class LocalStorageDriver implements StorageDriver, LocalReadableStorage {
	driver = "local" as const;
	private readonly root: string;

	constructor(root = localDir()) {
		this.root = resolve(root);
	}

	async put(
		key: string,
		data: Uint8Array,
		_contentType: string,
	): Promise<StoredObject> {
		const safeKey = normalizeStorageKey(key);
		const target = resolveStoragePath(this.root, safeKey);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, data);
		return { key: safeKey, url: this.resolveUrl(safeKey) };
	}

	async read(key: string): Promise<Uint8Array> {
		return new Uint8Array(await readFile(resolveStoragePath(this.root, key)));
	}

	async exists(key: string): Promise<boolean> {
		try {
			await access(resolveStoragePath(this.root, key));
			return true;
		} catch {
			return false;
		}
	}

	async createFromStream(
		key: string,
		stream: ReadableStream<Uint8Array> | null,
		maxBytes: number,
	): Promise<LocalUploadResult> {
		const safeKey = normalizeStorageKey(key);
		const target = resolveStoragePath(this.root, safeKey);
		const directory = dirname(target);
		const temporary = join(directory, `.upload-${crypto.randomUUID()}`);
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		let published = false;

		try {
			await mkdir(directory, { recursive: true });
			handle = await open(temporary, "wx");
			let totalBytes = 0;
			if (stream) {
				const reader = stream.getReader();
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						totalBytes += value.byteLength;
						if (totalBytes > maxBytes) {
							await reader.cancel();
							return { status: "oversize" };
						}
						await writeAll(handle, value);
					}
				} finally {
					reader.releaseLock();
				}
			}
			await handle.close();
			handle = undefined;

			try {
				await link(temporary, target);
				published = true;
			} catch (error) {
				if (isFileExistsError(error)) return { status: "conflict" };
				throw error;
			}
			return {
				status: "created",
				object: { key: safeKey, url: this.resolveUrl(safeKey) },
			};
		} finally {
			await handle?.close();
			if (!published) await unlink(temporary).catch(() => undefined);
			else await unlink(temporary);
		}
	}

	async presignPut(
		key: string,
		contentType: string,
		expiresInSeconds = 300,
		options?: PresignPutOptions,
	): Promise<PresignedUpload> {
		const safeKey = normalizeStorageKey(key);
		if (!options?.userId || !options.maxBytes) {
			throw new Error("Local upload grants require a user and maximum size");
		}
		const grant = createLocalUploadGrant(
			{
				key: safeKey,
				userId: options.userId,
				mimeType: contentType,
				maxBytes: options.maxBytes,
				expiresAt: Date.now() + expiresInSeconds * 1_000,
			},
			env.AUTH_SECRET,
		);
		return {
			key: safeKey,
			uploadUrl: `${publicBaseUrl()}/api/uploads/local/${safeKey}?grant=${encodeURIComponent(grant)}`,
			uploadMethod: "POST",
			fields: {},
			publicUrl: this.resolveUrl(safeKey),
		};
	}

	resolveUrl(key: string) {
		return `${publicBaseUrl()}/api/media/public/${normalizeStorageKey(key)}`;
	}
}
