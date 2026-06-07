import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Separator } from "@whatsapp-flow/ui/components/separator";
import { Activity, PanelLeft, Sparkles } from "lucide-react";

import { DashboardSidebar, MobileSidebarTrigger } from "@/components/sidebar";
import UserMenu from "@/components/user-menu";
import { getUser } from "@/functions/get-user";

export const Route = createFileRoute("/dashboard")({
	component: DashboardLayout,
	beforeLoad: async () => {
		const session = await getUser();
		return { session };
	},
	loader: async ({ context }) => {
		if (!context.session) {
			throw redirect({ to: "/login" });
		}
	},
});

function DashboardLayout() {
	return (
		<div className="flex h-svh overflow-hidden bg-background">
			<DashboardSidebar />
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-14 shrink-0 items-center gap-3 border-border/70 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75 md:px-6">
					<MobileSidebarTrigger />
					<div className="hidden items-center gap-2 text-muted-foreground md:flex">
						<PanelLeft className="size-4" />
						<Separator orientation="vertical" className="h-4" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<h1 className="truncate font-medium text-sm">Dashboard</h1>
							<Badge
								variant="secondary"
								className="hidden gap-1 text-[10px] sm:inline-flex"
							>
								<Sparkles className="size-3" />
								Builder workspace
							</Badge>
						</div>
						<p className="hidden text-[10px] text-muted-foreground sm:block">
							Manage devices, flows, and WhatsApp automation logs.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Badge
							variant="outline"
							className="hidden gap-1 text-[10px] sm:inline-flex"
						>
							<Activity className="size-3" />
							Runtime live
						</Badge>
						<UserMenu />
					</div>
				</header>

				<main className="min-h-0 flex-1 overflow-y-auto bg-muted/20">
					<div className="mx-auto w-full max-w-7xl p-4 md:p-6">
						<Outlet />
					</div>
				</main>
			</div>
		</div>
	);
}
