import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
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
		<div className="flex h-full">
			<Sidebar />
			<main className="flex-1 overflow-y-auto p-6">
				<div className="mb-4 flex items-center justify-between">
					<h1 className="font-semibold text-lg">Dashboard</h1>
					<span className="text-muted-foreground text-xs">
						{session?.user.name}
					</span>
				</div>
				<Outlet />
			</main>
		</div>
	);
}
