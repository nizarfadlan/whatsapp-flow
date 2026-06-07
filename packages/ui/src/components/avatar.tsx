import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "@whatsapp-flow/ui/lib/utils";

function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
	return (
		<AvatarPrimitive.Root
			data-slot="avatar"
			className={cn(
				"relative flex size-9 shrink-0 overflow-hidden rounded-none",
				className,
			)}
			{...props}
		/>
	);
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
	return (
		<AvatarPrimitive.Image
			data-slot="avatar-image"
			className={cn("aspect-square size-full", className)}
			{...props}
		/>
	);
}

function AvatarFallback({
	className,
	...props
}: AvatarPrimitive.Fallback.Props) {
	return (
		<AvatarPrimitive.Fallback
			data-slot="avatar-fallback"
			className={cn(
				"flex size-full items-center justify-center rounded-none bg-muted text-xs",
				className,
			)}
			{...props}
		/>
	);
}

export { Avatar, AvatarFallback, AvatarImage };
