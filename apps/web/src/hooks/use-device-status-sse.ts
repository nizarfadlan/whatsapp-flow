import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTRPC } from "@/utils/trpc";

export function useDeviceStatusSSE() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	useEffect(() => {
		const es = new EventSource("/api/events");

		es.addEventListener("message", (event) => {
			const data = JSON.parse(event.data);

			if (data.type === "status") {
				queryClient.setQueryData(trpc.device.list.queryKey(), (old: any) => {
					if (!old) return old;
					return old.map((d: any) =>
						d.id === data.deviceId
							? {
									...d,
									status: data.status,
									phoneNumber: data.phoneNumber ?? d.phoneNumber,
								}
							: d,
					);
				});
			}
		});

		return () => {
			es.close();
		};
	}, [queryClient, trpc]);
}
