import { Link, useLocation } from "@tanstack/react-router";
import { Button } from "@whatsapp-flow/ui/components/button";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { Bot, LayoutDashboard } from "lucide-react";
import UserMenu from "./user-menu";

const links = [
	{ href: "#features", label: "Features" },
	{ href: "#workflow", label: "Workflow" },
	{ href: "#runtime", label: "Runtime" },
] as const;

export default function Header() {
	const location = useLocation();
	const isHome = location.pathname === "/";

	return (
		<header className="sticky top-0 z-40 border-border/70 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
			<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
				<div className="flex items-center gap-8">
					<Link
						to="/"
						className="flex items-center gap-2 font-semibold text-sm"
					>
						<span className="flex size-8 items-center justify-center border bg-primary text-primary-foreground shadow-sm">
							<Bot className="size-4" />
						</span>
						<span>WhatsApp Flow</span>
					</Link>
					{isHome && (
						<nav className="hidden items-center gap-1 md:flex">
							{links.map((link) => (
								<a
									key={link.href}
									href={link.href}
									className={cn(
										"px-2.5 py-1.5 font-medium text-muted-foreground text-xs transition-colors",
										"hover:bg-muted hover:text-foreground",
									)}
								>
									{link.label}
								</a>
							))}
						</nav>
					)}
				</div>
				<div className="flex items-center gap-2">
					<Link to="/dashboard" className="hidden sm:block">
						<Button variant="outline" size="sm">
							<LayoutDashboard className="size-3.5" />
							Dashboard
						</Button>
					</Link>
					<UserMenu />
				</div>
			</div>
		</header>
	);
}
