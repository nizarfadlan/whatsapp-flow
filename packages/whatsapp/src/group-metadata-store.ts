import type { GroupMetadata } from "baileys";
import { BoundedDeviceCache } from "./bounded-device-cache";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_GROUPS_PER_DEVICE = 200;

function hasCompleteParticipants(
	metadata: Partial<GroupMetadata>,
): metadata is GroupMetadata {
	return (
		typeof metadata.id === "string" &&
		typeof metadata.subject === "string" &&
		Array.isArray(metadata.participants)
	);
}

export class GroupMetadataStore {
	private readonly cache: BoundedDeviceCache<GroupMetadata>;
	private readonly dirtyGroups = new Map<string, Set<string>>();

	constructor(
		options: {
			cacheTtlMs?: number;
			maxGroupsPerDevice?: number;
			now?: () => number;
		} = {},
	) {
		this.cache = new BoundedDeviceCache(
			options.maxGroupsPerDevice ?? DEFAULT_MAX_GROUPS_PER_DEVICE,
			options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
			options.now,
		);
	}

	set(deviceId: string, metadata: Partial<GroupMetadata>) {
		if (!hasCompleteParticipants(metadata)) return false;
		this.cache.set(deviceId, metadata.id, metadata);
		this.clearDirty(deviceId, metadata.id);
		return true;
	}

	invalidate(deviceId: string, jid: string) {
		this.cache.delete(deviceId, jid);
	}

	invalidateDirty(deviceId: string, jid: string) {
		this.cache.delete(deviceId, jid);
		const dirtyGroups = this.dirtyGroups.get(deviceId) ?? new Set<string>();
		dirtyGroups.add(jid);
		this.dirtyGroups.set(deviceId, dirtyGroups);
	}

	invalidateDevice(deviceId: string) {
		this.cache.clearDevice(deviceId);
		this.dirtyGroups.delete(deviceId);
	}

	async get(deviceId: string, jid: string) {
		if (this.dirtyGroups.get(deviceId)?.has(jid)) return undefined;
		return this.cache.get(deviceId, jid);
	}

	private clearDirty(deviceId: string, jid: string) {
		const dirtyGroups = this.dirtyGroups.get(deviceId);
		if (!dirtyGroups) return;
		dirtyGroups.delete(jid);
		if (dirtyGroups.size === 0) this.dirtyGroups.delete(deviceId);
	}
}

export const groupMetadataStore = new GroupMetadataStore();
