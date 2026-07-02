import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTRPC } from "@/utils/trpc";

export function useInboxSSE() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	useEffect(() => {
		const es = new EventSource("/api/events");

		es.addEventListener("message", (event) => {
			const data = JSON.parse(event.data);

			if (data.type === "inbox:message") {
				// Invalidate inbox queries to refetch
				queryClient.invalidateQueries({
					queryKey: trpc.inbox.list.queryKey(),
				});
				queryClient.invalidateQueries({
					queryKey: trpc.inbox.messages.queryKey(),
				});
			}
		});

		return () => {
			es.close();
		};
	}, [queryClient, trpc]);
}
