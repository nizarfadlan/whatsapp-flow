import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { Bot, Home, LayoutDashboard } from "lucide-react";
import UserMenu from "./user-menu";

const links = [
	{ to: "/", label: "Home", icon: Home },
	{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
] as const;

export default function Header() {
	const location = useLocation();

	return (
		<header className="border-border/70 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
			<div className="flex h-14 items-center justify-between px-4">
				<div className="flex items-center gap-6">
					<Link
						to="/"
						className="flex items-center gap-2 font-semibold text-sm"
					>
						<span className="flex size-8 items-center justify-center border bg-primary text-primary-foreground shadow-sm">
							<Bot className="size-4" />
						</span>
						<span>WhatsApp Flow</span>
					</Link>
					<nav className="hidden items-center gap-1 md:flex">
						{links.map(({ to, label, icon: Icon }) => {
							const active =
								to === "/dashboard"
									? location.pathname.startsWith(to)
									: location.pathname === to;
							return (
								<Link
									key={to}
									to={to}
									className={cn(
										"flex h-8 items-center gap-1.5 px-2.5 font-medium text-xs transition-colors",
										active
											? "bg-muted text-foreground"
											: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
									)}
								>
									{Icon && <Icon className="size-3.5" />}
									{label}
								</Link>
							);
						})}
					</nav>
				</div>
				<UserMenu />
			</div>
		</header>
	);
}
