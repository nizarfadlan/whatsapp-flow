import { env } from "@whatsapp-flow/env/server";
import { storage } from "@whatsapp-flow/storage";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

const ALLOWED_MIME_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/x-icon",
	"image/vnd.microsoft.icon",
	"video/mp4",
	"video/3gpp",
	"audio/ogg",
	"audio/mpeg",
	"audio/mp4",
	"audio/webm",
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/zip",
	"text/plain",
]);

const MAX_BYTES = 64 * 1024 * 1024; // 64 MB

function ext(mimeType: string) {
	const map: Record<string, string> = {
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/gif": "gif",
		"image/webp": "webp",
		"image/x-icon": "ico",
		"image/vnd.microsoft.icon": "ico",
		"video/mp4": "mp4",
		"video/3gpp": "3gpp",
		"audio/ogg": "ogg",
		"audio/mpeg": "mp3",
		"audio/mp4": "m4a",
		"audio/webm": "webm",
		"application/pdf": "pdf",
	};
	return map[mimeType] ?? "bin";
}

export const mediaRouter = router({
	/**
	 * Creates a presigned POST (S3) or a direct-upload endpoint (local).
	 * The client uploads to `uploadUrl` with the returned method and fields.
	 * After upload the `publicUrl` is used as `mediaUrl` on the node.
	 */
	createUploadUrl: protectedProcedure
		.input(
			z.object({
				fileName: z.string().min(1).max(255),
				mimeType: z.string().min(1),
				size: z.number().int().positive().max(MAX_BYTES),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			if (storage.driver === "s3" && !env.S3_PUBLIC_URL) {
				throw new Error(
					"S3_PUBLIC_URL is required for direct outbound S3 uploads",
				);
			}
			if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
				throw new Error(`File type not allowed: ${input.mimeType}`);
			}

			const key = `media/${crypto.randomUUID()}.${ext(input.mimeType)}`;
			const presigned = await storage.presignPut(key, input.mimeType, 300, {
				userId: ctx.session.user.id,
				maxBytes: input.size,
			});

			return {
				driver: storage.driver,
				key: presigned.key,
				uploadUrl: presigned.uploadUrl,
				uploadMethod: presigned.uploadMethod,
				fields: presigned.fields,
				publicUrl: presigned.publicUrl,
				mimeType: input.mimeType,
				fileName: input.fileName,
			};
		}),
});
