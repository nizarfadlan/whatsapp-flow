"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { XIcon } from "lucide-react";
import type * as React from "react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogPopup({ className, ...props }: DialogPrimitive.Popup.Props) {
	return (
		<DialogPrimitive.Popup
			data-slot="dialog-popup"
			className={cn(
				"data-closed:fade-out-0 data-closed:zoom-out-95 data-open:fade-in-0 data-open:zoom-in-95 fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-none bg-background p-6 shadow-lg ring-1 ring-foreground/10 duration-200",
				className,
			)}
			{...props}
		/>
	);
}

function DialogContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-content"
			className={cn("flex flex-col gap-4", className)}
			{...props}
		/>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			className={cn("flex flex-col gap-1 text-center sm:text-left", className)}
			{...props}
		/>
	);
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				"flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("font-medium text-sm", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("text-muted-foreground text-xs", className)}
			{...props}
		/>
	);
}

function DialogCloseButton({
	className,
	...props
}: DialogPrimitive.Close.Props) {
	return (
		<DialogClose
			data-slot="dialog-close-button"
			className={cn(
				"absolute top-3 right-3 flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground",
				className,
			)}
			{...props}
		>
			<XIcon className="size-4" />
		</DialogClose>
	);
}

export {
	Dialog,
	DialogClose,
	DialogCloseButton,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPopup,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
