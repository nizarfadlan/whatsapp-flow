import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FlowLogsView } from "@/components/flow-logs-view";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/flows/$flowId/logs")({
	component: FlowLogsPage,
});

function FlowLogsPage() {
	const { flowId } = Route.useParams();
	const trpc = useTRPC();
	const { data: flow } = useSuspenseQuery(
		trpc.flow.getById.queryOptions({ id: flowId }),
	);
	const flowNodes = (flow.nodes ?? []) as {
		id: string;
		type?: string;
		data?: Record<string, unknown>;
	}[];

	return (
		<FlowLogsView
			flowId={flowId}
			title={`${flow.name} · Flow Logs`}
			description="Execution history and realtime flow activity."
			flowNodes={flowNodes}
		/>
	);
}
