import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { LayoutDashboard, MessageSquare, Smartphone } from "lucide-react";

const navItems = [
	{ to: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
	{ to: "/dashboard/devices", label: "Devices", icon: Smartphone },
	{ to: "/dashboard/flows", label: "Flows", icon: MessageSquare },
] as const;

export default function Sidebar() {
	const location = useLocation();

	return (
		<aside className="flex h-full w-56 shrink-0 flex-col border-foreground/10 border-r bg-muted/30">
			<nav className="flex flex-col gap-1 p-3">
				{navItems.map(({ to, label, icon: Icon, exact }) => {
					const active = exact
						? location.pathname === to
						: location.pathname.startsWith(to);
					return (
						<Link
							key={to}
							to={to}
							className={cn(
								"flex items-center gap-2 rounded-none px-3 py-2 font-medium text-xs transition-colors",
								active
									? "bg-primary/10 text-primary"
									: "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
						>
							<Icon className="size-4" />
							{label}
						</Link>
					);
				})}
			</nav>
		</aside>
	);
}
