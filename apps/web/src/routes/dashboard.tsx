import {
	createFileRoute,
	Outlet,
	redirect,
	useLocation,
} from "@tanstack/react-router";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@whatsapp-flow/ui/components/sidebar";
import { cn } from "@whatsapp-flow/ui/lib/utils";

import { DashboardSidebar } from "@/components/sidebar";
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
	const location = useLocation();
	const isFlowWorkspace = /^\/dashboard\/flows\/[^/]+$/.test(location.pathname);
	const isInboxWorkspace = location.pathname === "/dashboard/inbox";
	const isLogsWorkspace =
		location.pathname === "/dashboard/logs" ||
		location.pathname.endsWith("/logs") ||
		location.pathname.endsWith("/sessions");
	const isFixedWorkspace =
		isFlowWorkspace || isInboxWorkspace || isLogsWorkspace;

	return (
		<SidebarProvider className="h-svh min-h-0 overflow-hidden bg-sidebar">
			<DashboardSidebar />
			<SidebarInset className="h-[calc(100svh-1rem)] min-h-0 min-w-0 overflow-hidden border bg-background md:m-2 md:rounded-xl md:shadow-xs">
				<header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 md:px-5">
					<SidebarTrigger />
					<div className="min-w-0 flex-1">
						<h1 className="truncate font-semibold text-sm">Dashboard</h1>
						<p className="hidden text-muted-foreground text-xs sm:block">
							Manage devices, flows, inbox, and automation logs.
						</p>
					</div>
					<UserMenu />
				</header>

				<main
					className={cn(
						"flex min-h-0 flex-1 bg-muted/40",
						isFixedWorkspace ? "overflow-hidden" : "overflow-y-auto",
					)}
				>
					<div
						className={cn(
							"w-full",
							isFixedWorkspace
								? "h-full min-h-0 overflow-hidden p-0"
								: "mx-auto max-w-7xl p-4 md:p-6",
						)}
					>
						<Outlet />
					</div>
				</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
