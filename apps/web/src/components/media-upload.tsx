import { Button } from "@whatsapp-flow/ui/components/button";
import { Input } from "@whatsapp-flow/ui/components/input";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { ImageIcon, Loader2, Paperclip, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTRPC } from "@/utils/trpc";

export interface UploadedMedia {
	key: string;
	url: string;
	mimeType: string;
	fileName: string;
}

interface MediaUploadProps {
	accept?: string;
	label?: string;
	value?: string;
	onUploaded: (media: UploadedMedia) => void;
	onUrlChange?: (url: string) => void;
	className?: string;
	maxSizeMb?: number;
}

const DEFAULT_MAX_MB = 64;

function isImageUrl(url: string) {
	return /\.(jpe?g|png|gif|webp)$/i.test(url);
}

export function MediaUpload({
	accept,
	label = "Media",
	value,
	onUploaded,
	onUrlChange,
	className,
	maxSizeMb = DEFAULT_MAX_MB,
}: MediaUploadProps) {
	const trpc = useTRPC();
	const fileRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleFile = async (file: File) => {
		setError(null);
		const maxBytes = maxSizeMb * 1024 * 1024;
		if (file.size > maxBytes) {
			setError(`File too large (max ${maxSizeMb} MB)`);
			return;
		}

		setUploading(true);
		try {
			const { driver, uploadUrl, publicUrl, key } =
				await trpc.media.createUploadUrl.mutate({
					fileName: file.name,
					mimeType: file.type || "application/octet-stream",
					size: file.size,
				});

			if (driver === "s3") {
				const res = await fetch(uploadUrl, {
					method: "PUT",
					body: file,
					headers: { "Content-Type": file.type },
				});
				if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
			} else {
				const res = await fetch(uploadUrl, {
					method: "POST",
					body: file,
					headers: { "Content-Type": file.type },
					credentials: "include",
				});
				if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
			}

			onUploaded({
				key,
				url: publicUrl,
				mimeType: file.type,
				fileName: file.name,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Upload failed");
		} finally {
			setUploading(false);
		}
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		const file = e.dataTransfer.files[0];
		if (file) void handleFile(file);
	};

	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			{onUrlChange && (
				<Input
					className="h-7 text-xs"
					placeholder="https://..."
					value={value ?? ""}
					onChange={(e) => onUrlChange(e.target.value)}
				/>
			)}

			<button
				type="button"
				className="group relative flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-border/80 border-dashed bg-muted/20 px-3 py-3 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
				onDrop={handleDrop}
				onDragOver={(e) => e.preventDefault()}
				onClick={() => fileRef.current?.click()}
			>
				<input
					ref={fileRef}
					type="file"
					accept={accept}
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) void handleFile(file);
						e.target.value = "";
					}}
				/>
				{uploading ? (
					<Loader2 className="size-4 animate-spin text-muted-foreground" />
				) : value && isImageUrl(value) ? (
					<img
						src={value}
						alt="preview"
						className="max-h-20 rounded object-cover"
					/>
				) : (
					<>
						<Upload className="size-4 text-muted-foreground" />
						<span className="text-[10px] text-muted-foreground">
							{label} · drag & drop or click
						</span>
						<span className="text-[9px] text-muted-foreground/70">
							max {maxSizeMb} MB
						</span>
					</>
				)}
			</button>

			{value && !uploading && (
				<div className="flex items-center gap-1 rounded-md border bg-muted/20 px-2 py-1">
					{isImageUrl(value) ? (
						<ImageIcon className="size-3 shrink-0 text-muted-foreground" />
					) : (
						<Paperclip className="size-3 shrink-0 text-muted-foreground" />
					)}
					<span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
						{value}
					</span>
					{onUrlChange && (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="size-5 text-muted-foreground hover:text-destructive"
							onClick={(e) => {
								e.stopPropagation();
								onUrlChange("");
							}}
						>
							<X className="size-3" />
						</Button>
					)}
				</div>
			)}

			{error && <p className="text-[10px] text-destructive">{error}</p>}
		</div>
	);
}
