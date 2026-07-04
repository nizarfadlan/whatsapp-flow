import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { buttonVariants } from "@whatsapp-flow/ui/components/button";
import { Skeleton } from "@whatsapp-flow/ui/components/skeleton";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { Bot } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

const links = [
	{ href: "#features", label: "Features" },
	{ href: "#workflow", label: "Workflow" },
] as const;

export default function Header() {
	const location = useLocation();
	const trpc = useTRPC();
	const { data: publicSettings } = useQuery(
		trpc.settings.public.queryOptions(),
	);
	const isHome = location.pathname === "/";
	const branding = publicSettings?.branding;
	const appName = branding?.appName ?? "WhatsApp Flow";
	const logoUrl = branding?.logoUrl;

	return (
		<header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
			<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
				<div className="flex items-center gap-8">
					<Link
						to="/"
						className="flex items-center gap-2 font-semibold text-sm"
					>
						{logoUrl ? (
							<img
								src={logoUrl}
								alt={`${appName} logo`}
								className="size-8 border bg-muted object-contain shadow-sm"
							/>
						) : (
							<span className="flex size-8 items-center justify-center bg-primary text-primary-foreground shadow-sm">
								<Bot className="size-4" />
							</span>
						)}
						<span>{appName}</span>
					</Link>
					{isHome && (
						<nav className="hidden items-center gap-1 md:flex">
							{links.map((link) => (
								<a
									key={link.href}
									href={link.href}
									className={cn(
										"px-3 py-2 font-medium text-muted-foreground text-sm transition-colors",
										"hover:bg-muted hover:text-foreground",
									)}
								>
									{link.label}
								</a>
							))}
						</nav>
					)}
				</div>
				<HeaderAuthButton />
			</div>
		</header>
	);
}

function HeaderAuthButton() {
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return <Skeleton className="h-9 w-24" />;
	}

	if (session) {
		return (
			<Link to="/dashboard" className={cn(buttonVariants({ size: "sm" }))}>
				Dashboard
			</Link>
		);
	}

	return (
		<Link
			to="/login"
			className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
		>
			Sign in
		</Link>
	);
}
