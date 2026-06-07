import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/flows")({
	component: FlowsLayout,
});

function FlowsLayout() {
	return <Outlet />;
}
