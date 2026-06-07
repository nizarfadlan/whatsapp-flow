import { Link, useLocation } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { buttonVariants } from "@whatsapp-flow/ui/components/button";
import { Separator } from "@whatsapp-flow/ui/components/separator";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	Activity,
	Bot,
	LayoutDashboard,
	MessageSquare,
	Plus,
	Smartphone,
} from "lucide-react";

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

export default function Sidebar() {
	const location = useLocation();

	return (
		<aside className="hidden h-full w-64 shrink-0 border-border/70 border-r bg-card/60 md:flex">
			<div className="flex min-h-0 w-full flex-col">
				<div className="flex h-16 items-center gap-3 border-border/70 border-b px-4">
					<div className="flex size-9 items-center justify-center border bg-primary text-primary-foreground shadow-sm">
						<Bot className="size-4" />
					</div>
					<div className="min-w-0">
						<p className="truncate font-semibold text-sm">WhatsApp Flow</p>
						<p className="truncate text-muted-foreground text-xs">
							Automation builder
						</p>
					</div>
				</div>

				<div className="space-y-3 p-3">
					<Link
						to="/dashboard/flows/new"
						className={cn(
							buttonVariants({ size: "sm" }),
							"w-full justify-start",
						)}
					>
						<Plus className="size-3.5" />
						New Flow
					</Link>

					<div>
						<div className="mb-2 px-2 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
							Workspace
						</div>
						<nav className="flex flex-col gap-1">
							{navItems.map(({ to, label, icon: Icon, exact }) => {
								const active = exact
									? location.pathname === to
									: location.pathname.startsWith(to);
								return (
									<Link
										key={to}
										to={to}
										className={cn(
											"group flex items-center gap-2 border border-transparent px-2.5 py-2 font-medium text-xs transition-colors",
											active
												? "border-border bg-muted text-foreground shadow-sm"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
										)}
									>
										<Icon className="size-4" />
										<span className="flex-1">{label}</span>
										{active && <span className="size-1.5 bg-primary" />}
									</Link>
								);
							})}
						</nav>
					</div>
				</div>

				<div className="mt-auto p-3">
					<Separator className="mb-3" />
					<div className="border bg-muted/40 p-3">
						<div className="mb-2 flex items-center justify-between gap-2">
							<p className="font-medium text-xs">Runtime</p>
							<Badge variant="secondary" className="text-[10px]">
								Live
							</Badge>
						</div>
						<p className="text-[10px] text-muted-foreground leading-relaxed">
							Connect a device, build a flow, then deploy it to handle incoming
							WhatsApp messages.
						</p>
					</div>
				</div>
			</div>
		</aside>
	);
}
