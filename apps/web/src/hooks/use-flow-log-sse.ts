import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTRPC } from "@/utils/trpc";

export function useFlowLogSSE() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	useEffect(() => {
		const es = new EventSource("/api/events");

		es.addEventListener("message", (event) => {
			const data = JSON.parse(event.data);
			if (data.type === "flow:log:updated") {
				queryClient.invalidateQueries({
					queryKey: trpc.flowLog.list.queryKey(),
				});
				if (data.logId) {
					queryClient.invalidateQueries({
						queryKey: trpc.flowLog.getById.queryKey({ id: data.logId }),
					});
				}
			}
		});

		return () => es.close();
	}, [queryClient, trpc]);
}
