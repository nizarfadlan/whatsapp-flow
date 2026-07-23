import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useActiveOrganization } from "@/components/active-organization";
import { useTRPC } from "@/utils/trpc";

export function useFlowLogSSE() {
	const organization = useActiveOrganization();
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	useEffect(() => {
		const es = new EventSource(
			`${import.meta.env.VITE_SERVER_URL}/api/events?tenantId=${encodeURIComponent(organization.id)}`,
			{
				withCredentials: true,
			},
		);

		es.addEventListener("message", (event) => {
			const data = JSON.parse(event.data);
			if (data.type === "flow:log:updated") {
				queryClient.invalidateQueries({
					queryKey: trpc.flowLog.list.queryKey({ tenantId: organization.id }),
				});
				if (data.logId) {
					queryClient.invalidateQueries({
						queryKey: trpc.flowLog.getById.queryKey({
							id: data.logId,
							tenantId: organization.id,
						}),
					});
					queryClient.invalidateQueries({
						queryKey: trpc.flowLog.timeline.queryKey({
							id: data.logId,
							tenantId: organization.id,
						}),
					});
				}
			}
			if (data.type === "flow:session:updated") {
				queryClient.invalidateQueries({
					queryKey: trpc.flowLog.list.queryKey({ tenantId: organization.id }),
				});
				if (data.executionLogId) {
					queryClient.invalidateQueries({
						queryKey: trpc.flowLog.getById.queryKey({
							id: data.executionLogId,
							tenantId: organization.id,
						}),
					});
					queryClient.invalidateQueries({
						queryKey: trpc.flowLog.timeline.queryKey({
							id: data.executionLogId,
							tenantId: organization.id,
						}),
					});
				}
			}
		});

		return () => es.close();
	}, [organization.id, queryClient, trpc]);
}
