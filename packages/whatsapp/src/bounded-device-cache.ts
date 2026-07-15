type CacheEntry<T> = {
	value: T;
	expiresAt: number;
};

export class BoundedDeviceCache<T> {
	private readonly entries = new Map<string, Map<string, CacheEntry<T>>>();

	constructor(
		private readonly maxEntriesPerDevice: number,
		private readonly ttlMs: number,
		private readonly now: () => number = Date.now,
	) {}

	get(deviceId: string, key: string): T | undefined {
		const deviceEntries = this.entries.get(deviceId);
		const entry = deviceEntries?.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= this.now()) {
			deviceEntries?.delete(key);
			if (deviceEntries?.size === 0) this.entries.delete(deviceId);
			return undefined;
		}

		deviceEntries?.delete(key);
		deviceEntries?.set(key, entry);
		return entry.value;
	}

	set(deviceId: string, key: string, value: T) {
		const deviceEntries = this.entries.get(deviceId) ?? new Map();
		this.entries.set(deviceId, deviceEntries);
		deviceEntries.delete(key);
		deviceEntries.set(key, { value, expiresAt: this.now() + this.ttlMs });

		while (deviceEntries.size > this.maxEntriesPerDevice) {
			const oldestKey = deviceEntries.keys().next().value;
			if (!oldestKey) break;
			deviceEntries.delete(oldestKey);
		}
	}

	delete(deviceId: string, key: string) {
		const deviceEntries = this.entries.get(deviceId);
		deviceEntries?.delete(key);
		if (deviceEntries?.size === 0) this.entries.delete(deviceId);
	}

	clearDevice(deviceId: string) {
		this.entries.delete(deviceId);
	}
}
