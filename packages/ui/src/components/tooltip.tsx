import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@whatsapp-flow/ui/lib/utils";

function TooltipProvider({
	delayDuration = 0,
	...props
}: TooltipPrimitive.Provider.Props & { delayDuration?: number }) {
	return (
		<TooltipPrimitive.Provider
			data-slot="tooltip-provider"
			delay={delayDuration}
			{...props}
		/>
	);
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipPopup({ className, ...props }: TooltipPrimitive.Popup.Props) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner>
				<TooltipPrimitive.Popup
					data-slot="tooltip-popup"
					className={cn(
						"data-closed:fade-out-0 data-open:fade-in-0 z-50 rounded-none bg-primary px-2 py-1 text-primary-foreground text-xs shadow-md",
						className,
					)}
					{...props}
				/>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	);
}

function TooltipArrow({ className, ...props }: TooltipPrimitive.Arrow.Props) {
	return (
		<TooltipPrimitive.Arrow
			data-slot="tooltip-arrow"
			className={cn("fill-primary", className)}
			{...props}
		/>
	);
}

export { Tooltip, TooltipArrow, TooltipPopup, TooltipProvider, TooltipTrigger };
