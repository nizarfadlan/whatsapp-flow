import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useActiveOrganization } from "@/components/active-organization";
import { FlowLogsView } from "@/components/flow-logs-view";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute(
	"/dashboard/$organizationSlug/flows/$flowId/logs",
)({
	component: FlowLogsPage,
});

function FlowLogsPage() {
	const { flowId } = Route.useParams();
	const organization = useActiveOrganization();
	const trpc = useTRPC();
	const { data: flow } = useSuspenseQuery(
		trpc.flow.getById.queryOptions({ id: flowId, tenantId: organization.id }),
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
