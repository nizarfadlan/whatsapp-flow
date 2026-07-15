import { isAbsolute, relative, resolve } from "node:path";

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validates controlled object keys without rewriting potentially unsafe input.
 */
export function normalizeStorageKey(key: string): string {
	if (typeof key !== "string" || !key || isAbsolute(key)) {
		throw new Error("Storage key must be a non-empty relative path");
	}
	if (key.includes("\\") || key.includes("\0") || key.includes("%")) {
		throw new Error("Storage key contains disallowed characters");
	}
	if (/^[a-z][a-z\d+.-]*:/i.test(key) || key.includes("//")) {
		throw new Error("Storage key must not be URL-like");
	}

	const segments = key.split("/");
	if (
		segments.some(
			(segment) =>
				!segment ||
				segment === "." ||
				segment === ".." ||
				!SEGMENT_PATTERN.test(segment),
		)
	) {
		throw new Error("Storage key contains an invalid path segment");
	}
	return key;
}

/** Resolves a validated key and verifies that it remains within the storage root. */
export function resolveStoragePath(root: string, key: string): string {
	const safeKey = normalizeStorageKey(key);
	const resolvedRoot = resolve(root);
	const target = resolve(resolvedRoot, safeKey);
	const pathToTarget = relative(resolvedRoot, target);
	if (
		!pathToTarget ||
		pathToTarget === ".." ||
		pathToTarget.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(pathToTarget)
	) {
		throw new Error("Storage key resolves outside the storage root");
	}
	return target;
}
