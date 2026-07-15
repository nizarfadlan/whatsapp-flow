export type StoredObject = {
	key: string;
	url: string;
};

export type PresignedUpload = {
	key: string;
	uploadUrl: string;
	uploadMethod: "POST";
	fields: Record<string, string>;
	publicUrl: string;
};

export type PresignPutOptions = {
	userId?: string;
	maxBytes?: number;
};

export type PresignGetOptions = {
	fileName: string;
	contentType: string;
};

export type LocalUploadResult =
	| { status: "created"; object: StoredObject }
	| { status: "conflict" }
	| { status: "oversize" };

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
		options?: PresignPutOptions,
	): Promise<PresignedUpload>;
	resolveUrl(key: string): string;
}

export interface LocalReadableStorage {
	read(key: string): Promise<Uint8Array>;
	exists(key: string): Promise<boolean>;
}

export interface PresignedReadableStorage {
	presignGet(
		key: string,
		expiresInSeconds?: number,
		options?: PresignGetOptions,
	): Promise<string>;
}
