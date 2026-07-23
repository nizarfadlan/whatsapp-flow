import { createFileRoute } from "@tanstack/react-router";
import { FlowLogsView } from "@/components/flow-logs-view";

export const Route = createFileRoute("/dashboard/$organizationSlug/logs")({
	component: LogsPage,
});

function LogsPage() {
	return (
		<FlowLogsView
			title="Execution Logs"
			description="Execution history across your flows."
		/>
	);
}
