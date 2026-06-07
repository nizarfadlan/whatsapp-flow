import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Bot, Sparkles } from "lucide-react";
import Sidebar from "@/components/sidebar";
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
	const { session } = Route.useRouteContext();

	return (
		<div className="flex h-full bg-muted/20">
			<Sidebar />
			<main className="min-w-0 flex-1 overflow-y-auto">
				<div className="border-border/70 border-b bg-background/80 px-4 py-4 backdrop-blur md:px-6">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<div className="mb-1 flex items-center gap-2">
								<span className="flex size-7 items-center justify-center border bg-primary/10 text-primary">
									<Bot className="size-3.5" />
								</span>
								<Badge variant="secondary" className="gap-1 text-[10px]">
									<Sparkles className="size-3" />
									Builder workspace
								</Badge>
							</div>
							<h1 className="font-semibold text-xl tracking-tight">
								Dashboard
							</h1>
							<p className="text-muted-foreground text-xs">
								Manage devices, design flows, and monitor WhatsApp automation.
							</p>
						</div>
						<div className="border bg-card px-3 py-2 text-right shadow-sm">
							<p className="text-[10px] text-muted-foreground">Signed in as</p>
							<p className="font-medium text-xs">{session?.user.name}</p>
						</div>
					</div>
				</div>
				<div className="p-4 md:p-6">
					<Outlet />
				</div>
			</main>
		</div>
	);
}
