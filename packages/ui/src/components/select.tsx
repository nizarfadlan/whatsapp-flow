import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { Check, ChevronDownIcon } from "lucide-react";
import type * as React from "react";

function Select({ ...props }: SelectPrimitive.Root.Props<unknown>) {
	return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ ...props }: SelectPrimitive.Group.Props) {
	return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
	return (
		<SelectPrimitive.Value
			data-slot="select-value"
			className={cn("flex items-baseline gap-1", className)}
			{...props}
		/>
	);
}

function SelectTrigger({
	className,
	children,
	...props
}: SelectPrimitive.Trigger.Props) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			className={cn(
				"flex h-8 w-full items-center justify-between gap-2 rounded-none border border-input bg-background px-2.5 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon>
				<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectPopup({ className, ...props }: SelectPrimitive.Popup.Props) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner>
				<SelectPrimitive.Popup
					data-slot="select-popup"
					className={cn(
						"data-closed:fade-out-0 data-open:fade-in-0 z-50 max-h-[--available-height] min-w-[--anchor-width] rounded-none border bg-popover p-1 text-popover-foreground shadow-md",
						className,
					)}
					{...props}
				/>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectItem({
	className,
	children,
	...props
}: SelectPrimitive.Item.Props) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				"relative flex w-full cursor-default select-none items-center rounded-none py-1.5 pr-8 pl-2 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
				<Check className="size-3.5" />
			</SelectPrimitive.ItemIndicator>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

function SelectLabel({ className, ...props }: SelectPrimitive.Label.Props) {
	return (
		<SelectPrimitive.Label
			data-slot="select-label"
			className={cn("px-2 py-1.5 text-muted-foreground text-xs", className)}
			{...props}
		/>
	);
}

function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="select-separator"
			className={cn("-mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

export {
	Select,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectPopup,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
