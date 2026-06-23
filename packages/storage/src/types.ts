export type StoredObject = {
	key: string;
	url: string;
};

export type PresignedUpload = {
	key: string;
	uploadUrl: string;
	publicUrl: string;
};

export interface StorageDriver {
	driver: "local" | "s3";
	put(
		key: string,
		data: Uint8Array,
		contentType: string,
	): Promise<StoredObject>;
	presignPut(
		key: string,
		contentType: string,
		expiresInSeconds?: number,
	): Promise<PresignedUpload>;
	resolveUrl(key: string): string;
}
