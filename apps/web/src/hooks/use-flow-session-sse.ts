import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTRPC } from "@/utils/trpc";

export function useFlowSessionSSE(flowId: string) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	useEffect(() => {
		const es = new EventSource("/api/events");

		es.addEventListener("message", (event) => {
			const data = JSON.parse(event.data);
			if (data.type !== "flow:session:updated" || data.flowId !== flowId)
				return;

			queryClient.invalidateQueries({
				queryKey: trpc.flowSession.list.queryKey({ flowId, status: "all" }),
			});
			queryClient.invalidateQueries({
				queryKey: trpc.flowSession.list.queryKey({ flowId, status: "active" }),
			});
			queryClient.invalidateQueries({
				queryKey: trpc.flowSession.list.queryKey({ flowId, status: "history" }),
			});
			if (data.sessionId) {
				queryClient.invalidateQueries({
					queryKey: trpc.flowSession.get.queryKey({ id: data.sessionId }),
				});
				queryClient.invalidateQueries({
					queryKey: trpc.flowSession.timeline.queryKey({ id: data.sessionId }),
				});
			}
		});

		return () => es.close();
	}, [flowId, queryClient, trpc]);
}
