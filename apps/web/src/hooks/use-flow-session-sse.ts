import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useActiveOrganization } from "@/components/active-organization";
import { useTRPC } from "@/utils/trpc";

export function useFlowSessionSSE(flowId: string) {
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
			if (data.type !== "flow:session:updated" || data.flowId !== flowId)
				return;

			queryClient.invalidateQueries({
				queryKey: trpc.flowSession.list.queryKey({
					flowId,
					tenantId: organization.id,
					status: "all",
				}),
			});
			queryClient.invalidateQueries({
				queryKey: trpc.flowSession.list.queryKey({
					flowId,
					tenantId: organization.id,
					status: "active",
				}),
			});
			queryClient.invalidateQueries({
				queryKey: trpc.flowSession.list.queryKey({
					flowId,
					tenantId: organization.id,
					status: "history",
				}),
			});
			if (data.sessionId) {
				queryClient.invalidateQueries({
					queryKey: trpc.flowSession.get.queryKey({
						id: data.sessionId,
						tenantId: organization.id,
					}),
				});
				queryClient.invalidateQueries({
					queryKey: trpc.flowSession.timeline.queryKey({
						id: data.sessionId,
						tenantId: organization.id,
					}),
				});
			}
		});

		return () => es.close();
	}, [flowId, organization.id, queryClient, trpc]);
}
