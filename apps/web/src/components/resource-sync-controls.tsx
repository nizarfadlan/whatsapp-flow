import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	NativeSelect,
	NativeSelectOption,
} from "@whatsapp-flow/ui/components/native-select";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";

type SyncResource = "contacts" | "groups" | "newsletters";

type SyncDevice = {
	id: string;
	name: string;
	provider?: string;
	status: string;
};

type SyncStartResult = {
	runs: Array<{ id: string; deviceId: string }>;
};

const activeStatuses = new Set(["queued", "running"]);

export function useResourceSyncCompletion(resource: SyncResource) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [tracked, setTracked] = useState<{
		deviceId: string;
		runIds: string[];
	} | null>(null);
	const status = useQuery({
		...trpc.device.syncStatus.queryOptions({
			id: tracked?.deviceId ?? "",
			limit: 30,
		}),
		enabled: Boolean(tracked),
		refetchInterval: (query) => {
			if (!tracked) return false;
			const runs = query.state.data ?? [];
			const trackedRuns = runs.filter((run) => tracked.runIds.includes(run.id));
			return trackedRuns.length < tracked.runIds.length ||
				trackedRuns.some((run) => activeStatuses.has(run.status))
				? 2_000
				: false;
		},
	});

	useEffect(() => {
		if (!tracked || !status.data) return;
		const runs = status.data.filter((run) => tracked.runIds.includes(run.id));
		if (
			runs.length < tracked.runIds.length ||
			runs.some((run) => activeStatuses.has(run.status))
		) {
			return;
		}

		const queryKey =
			resource === "contacts"
				? trpc.contact.list.queryKey()
				: resource === "groups"
					? trpc.group.list.queryKey()
					: trpc.channel.list.queryKey();
		void queryClient.invalidateQueries({ queryKey });

		if (runs.some((run) => run.status === "failed")) {
			toast.error(`${resourceLabel(resource)} sync failed`);
		} else if (runs.some((run) => run.status === "partial")) {
			toast.warning(`${resourceLabel(resource)} sync completed with errors`);
		} else if (runs.some((run) => run.status === "cancelled")) {
			toast.warning(`${resourceLabel(resource)} sync was cancelled`);
		} else {
			toast.success(`${resourceLabel(resource)} sync completed`);
		}
		setTracked(null);
	}, [queryClient, resource, status.data, tracked, trpc]);

	return (result: SyncStartResult) => {
		const deviceId = result.runs[0]?.deviceId;
		if (!deviceId) return;
		setTracked({ deviceId, runIds: result.runs.map((run) => run.id) });
	};
}

export function ResourceSyncControls({
	devices,
	resource,
}: {
	devices: SyncDevice[];
	resource: SyncResource;
}) {
	const trpc = useTRPC();
	const trackCompletion = useResourceSyncCompletion(resource);
	const [deviceId, setDeviceId] = useState("");
	const eligibleDevices = useMemo(
		() =>
			devices.filter(
				(device) =>
					device.provider !== "meta_cloud" && device.status === "connected",
			),
		[devices],
	);

	useEffect(() => {
		if (eligibleDevices.some((device) => device.id === deviceId)) return;
		setDeviceId(eligibleDevices.length === 1 ? eligibleDevices[0].id : "");
	}, [deviceId, eligibleDevices]);

	const startSync = useMutation(
		trpc.device.startSync.mutationOptions({
			onSuccess: (result) => {
				trackCompletion(result);
				toast.success(`${resourceLabel(resource)} sync queued`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const hasMultipleDevices = eligibleDevices.length > 1;
	const canSync = Boolean(deviceId);

	return (
		<div className="flex flex-wrap items-center gap-2">
			<NativeSelect
				aria-label={`Device to sync ${resource}`}
				className="h-8 min-w-44 text-xs"
				value={deviceId}
				onChange={(event) => setDeviceId(event.target.value)}
				disabled={eligibleDevices.length === 0}
			>
				<NativeSelectOption value="">
					{hasMultipleDevices
						? "Select connected device"
						: "No connected device"}
				</NativeSelectOption>
				{eligibleDevices.map((device) => (
					<NativeSelectOption key={device.id} value={device.id}>
						{device.name}
					</NativeSelectOption>
				))}
			</NativeSelect>
			<Button
				size="sm"
				variant="outline"
				className="h-8 text-xs"
				disabled={!canSync || startSync.isPending}
				onClick={() => {
					if (!deviceId) return;
					startSync.mutate({ id: deviceId, resource, mode: "normal" });
				}}
			>
				<RefreshCw className="size-3.5" />
				{startSync.isPending
					? "Queueing..."
					: `Sync ${resourceLabel(resource)}`}
			</Button>
			{eligibleDevices.length === 0 && (
				<p className="text-muted-foreground text-xs">
					A connected Baileys device is required.
				</p>
			)}
		</div>
	);
}

function resourceLabel(resource: SyncResource) {
	return resource === "newsletters"
		? "Newsletters"
		: `${resource.slice(0, 1).toUpperCase()}${resource.slice(1)}`;
}
