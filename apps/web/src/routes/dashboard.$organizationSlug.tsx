import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@whatsapp-flow/ui/components/sidebar";
import { cn } from "@whatsapp-flow/ui/lib/utils";

import { ActiveOrganizationProvider } from "@/components/active-organization";
import { DashboardSidebar } from "@/components/sidebar";
import UserMenu from "@/components/user-menu";

export const Route = createFileRoute("/dashboard/$organizationSlug")({
	loader: async ({ context, params }) => {
		const organization = await context.queryClient.ensureQueryData(
			context.trpc.organization.getBySlug.queryOptions({
				slug: params.organizationSlug,
			}),
		);

		const slug = organization.slug;
		if (!slug) {
			throw new Error("Verified organization is missing a slug");
		}

		return {
			organization: { id: organization.id, name: organization.name, slug },
		};
	},
	component: OrganizationDashboardLayout,
});

function OrganizationDashboardLayout() {
	const location = useLocation();
	const { organization } = Route.useLoaderData();
	const dashboardPath = `/dashboard/${organization.slug}`;
	const isFlowWorkspace = new RegExp(
		`^${dashboardPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/flows/[^/]+$`,
	).test(location.pathname);
	const isInboxWorkspace = location.pathname === `${dashboardPath}/inbox`;
	const isLogsWorkspace =
		location.pathname === `${dashboardPath}/logs` ||
		location.pathname.endsWith("/logs") ||
		location.pathname.endsWith("/sessions");
	const isFixedWorkspace =
		isFlowWorkspace || isInboxWorkspace || isLogsWorkspace;

	return (
		<ActiveOrganizationProvider organization={organization}>
			<SidebarProvider className="h-svh min-h-0 overflow-hidden bg-sidebar">
				<DashboardSidebar />
				<SidebarInset className="h-[calc(100svh-1rem)] min-h-0 min-w-0 overflow-hidden border bg-background md:m-2 md:rounded-xl md:shadow-xs">
					<header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 md:px-5">
						<SidebarTrigger />
						<div className="min-w-0 flex-1">
							<h1 className="truncate font-semibold text-sm">
								{organization.name}
							</h1>
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
		</ActiveOrganizationProvider>
	);
}
