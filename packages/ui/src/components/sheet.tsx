"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { XIcon } from "lucide-react";
import type * as React from "react";

function Sheet({ ...props }: DrawerPrimitive.Root.Props) {
	return <DrawerPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
	return <DrawerPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: DrawerPrimitive.Close.Props) {
	return <DrawerPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
	className,
	children,
	side = "right",
	...props
}: DrawerPrimitive.Popup.Props & {
	side?: "top" | "right" | "bottom" | "left";
}) {
	const sideClasses = {
		top: "top-0 left-0 right-0 max-h-[90dvh] max-w-none data-closed:slide-out-to-top data-open:slide-in-from-top",
		right:
			"top-0 right-0 h-full max-h-none w-[calc(100vw-2rem)] max-w-sm data-closed:slide-out-to-right data-open:slide-in-from-right",
		bottom:
			"bottom-0 left-0 right-0 max-h-[90dvh] max-w-none data-closed:slide-out-to-bottom data-open:slide-in-from-bottom",
		left: "top-0 left-0 h-full max-h-none w-[calc(100vw-2rem)] max-w-sm data-closed:slide-out-to-left data-open:slide-in-from-left",
	};

	return (
		<DrawerPrimitive.Portal>
			<DrawerPrimitive.Backdrop
				data-slot="sheet-backdrop"
				className="data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
			/>
			<DrawerPrimitive.Popup
				data-slot="sheet-content"
				className={cn(
					"fixed z-50 gap-4 bg-background shadow-lg ring-1 ring-foreground/10 duration-200 ease-out",
					sideClasses[side],
					className,
				)}
				{...props}
			>
				<div className="flex h-full flex-col">
					<DrawerPrimitive.Close
						data-slot="sheet-close-button"
						className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<XIcon className="size-4" />
					</DrawerPrimitive.Close>
					<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
						{children}
					</div>
				</div>
			</DrawerPrimitive.Popup>
		</DrawerPrimitive.Portal>
	);
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-header"
			className={cn("flex flex-col gap-1 text-center sm:text-left", className)}
			{...props}
		/>
	);
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-footer"
			className={cn(
				"flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		/>
	);
}

function SheetTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
	return (
		<DrawerPrimitive.Title
			data-slot="sheet-title"
			className={cn("font-medium text-sm", className)}
			{...props}
		/>
	);
}

function SheetDescription({
	className,
	...props
}: DrawerPrimitive.Description.Props) {
	return (
		<DrawerPrimitive.Description
			data-slot="sheet-description"
			className={cn("text-muted-foreground text-xs", className)}
			{...props}
		/>
	);
}

export {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
};
