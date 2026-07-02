import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTRPC } from "@/utils/trpc";

type DeviceListItem = {
	id: string;
	name: string;
	phoneNumber: string | null;
	status: string;
	createdAt: Date;
	updatedAt: Date;
};

type DeviceStatusEvent = {
	type: "status";
	deviceId: string;
	status: DeviceListItem["status"];
	phoneNumber?: string | null;
};

export function useDeviceStatusSSE() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	useEffect(() => {
		const es = new EventSource("/api/events");

		es.addEventListener("message", (event) => {
			const data = JSON.parse(event.data) as DeviceStatusEvent;

			if (data.type === "status") {
				queryClient.setQueryData<DeviceListItem[]>(
					trpc.device.list.queryKey(),
					(old) => {
						if (!old) return old;
						return old.map((device) =>
							device.id === data.deviceId
								? {
										...device,
										status: data.status,
										phoneNumber: data.phoneNumber ?? device.phoneNumber,
									}
								: device,
						);
					},
				);
			}
		});

		return () => {
			es.close();
		};
	}, [queryClient, trpc]);
}
