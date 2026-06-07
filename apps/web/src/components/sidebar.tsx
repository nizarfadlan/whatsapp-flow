import { Link, useLocation } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { buttonVariants } from "@whatsapp-flow/ui/components/button";
import { Separator } from "@whatsapp-flow/ui/components/separator";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@whatsapp-flow/ui/components/sheet";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	Activity,
	Bot,
	LayoutDashboard,
	Menu,
	MessageSquare,
	Plus,
	Smartphone,
} from "lucide-react";
import type { ComponentProps } from "react";

const navItems = [
	{ to: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
	{
		to: "/dashboard/devices",
		label: "Devices",
		icon: Smartphone,
		exact: false,
	},
	{ to: "/dashboard/flows", label: "Flows", icon: MessageSquare, exact: false },
	{ to: "/dashboard/logs", label: "Logs", icon: Activity, exact: false },
] as const;

function Brand() {
	return (
		<Link to="/" className="flex items-center gap-3">
			<span className="flex size-9 items-center justify-center border bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
				<Bot className="size-4" />
			</span>
			<span className="min-w-0">
				<span className="block truncate font-semibold text-sm">
					WhatsApp Flow
				</span>
				<span className="block truncate text-sidebar-foreground/60 text-xs">
					Automation builder
				</span>
			</span>
		</Link>
	);
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
	const location = useLocation();

	return (
		<nav className="flex flex-col gap-1">
			{navItems.map(({ to, label, icon: Icon, exact }) => {
				const active = exact
					? location.pathname === to
					: location.pathname.startsWith(to);
				return (
					<Link
						key={to}
						to={to}
						onClick={onNavigate}
						className={cn(
							"group flex items-center gap-2 border border-transparent px-2.5 py-2 font-medium text-xs transition-colors",
							active
								? "border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
								: "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
						)}
					>
						<Icon className="size-4" />
						<span className="flex-1">{label}</span>
						{active && <span className="size-1.5 bg-sidebar-primary" />}
					</Link>
				);
			})}
		</nav>
	);
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
	return (
		<div className="flex min-h-0 w-full flex-1 flex-col bg-sidebar text-sidebar-foreground">
			<div className="flex h-16 items-center border-sidebar-border border-b px-4">
				<Brand />
			</div>

			<div className="space-y-4 p-3">
				<Link
					to="/dashboard/flows/new"
					onClick={onNavigate}
					className={cn(buttonVariants({ size: "sm" }), "w-full justify-start")}
				>
					<Plus className="size-3.5" />
					New Flow
				</Link>

				<div>
					<div className="mb-2 px-2 font-medium text-[10px] text-sidebar-foreground/50 uppercase tracking-wider">
						Workspace
					</div>
					<SidebarNav onNavigate={onNavigate} />
				</div>
			</div>

			<div className="mt-auto p-3">
				<Separator className="mb-3 bg-sidebar-border" />
				<div className="border border-sidebar-border bg-sidebar-accent/50 p-3">
					<div className="mb-2 flex items-center justify-between gap-2">
						<p className="font-medium text-xs">Runtime</p>
						<Badge variant="secondary" className="text-[10px]">
							Live
						</Badge>
					</div>
					<p className="text-[10px] text-sidebar-foreground/60 leading-relaxed">
						Connect a device, build a flow, then deploy it to respond from your
						WhatsApp number.
					</p>
				</div>
			</div>
		</div>
	);
}

export function DashboardSidebar({ className }: ComponentProps<"aside">) {
	return (
		<aside
			className={cn(
				"hidden h-svh w-64 shrink-0 border-sidebar-border border-r bg-sidebar md:flex",
				className,
			)}
		>
			<SidebarContent />
		</aside>
	);
}

export function MobileSidebarTrigger() {
	return (
		<Sheet>
			<SheetTrigger className="inline-flex size-8 items-center justify-center border bg-background text-muted-foreground hover:bg-muted hover:text-foreground md:hidden">
				<Menu className="size-4" />
			</SheetTrigger>
			<SheetContent
				side="left"
				className="w-72 max-w-72 p-0"
				childrenClassName="p-0"
			>
				<SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
				<SidebarContent />
			</SheetContent>
		</Sheet>
	);
}

export default DashboardSidebar;
