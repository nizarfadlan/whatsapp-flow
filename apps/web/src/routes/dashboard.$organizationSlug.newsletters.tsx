import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@whatsapp-flow/ui/components/dropdown-menu";
import { Input } from "@whatsapp-flow/ui/components/input";
import { Megaphone, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useActiveOrganization } from "@/components/active-organization";
import { DataTable } from "@/components/data-table";
import {
	ResourceSyncControls,
	useResourceSyncCompletion,
} from "@/components/resource-sync-controls";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute(
	"/dashboard/$organizationSlug/newsletters",
)({
	component: NewslettersPage,
});

function NewslettersPage() {
	const organization = useActiveOrganization();
	const trpc = useTRPC();
	const trackSyncCompletion = useResourceSyncCompletion("newsletters");
	const [search, setSearch] = useState("");
	const { data: newsletters = [] } = useSuspenseQuery(
		trpc.channel.list.queryOptions({ search: search || undefined, limit: 100 }),
	);
	const { data: devices = [] } = useSuspenseQuery(
		trpc.device.list.queryOptions({ tenantId: organization.id }),
	);
	const devicesById = new Map(devices.map((device) => [device.id, device]));
	const syncOneMut = useMutation(
		trpc.channel.syncOne.mutationOptions({
			onSuccess: (result) => {
				trackSyncCompletion(result);
				toast.success("Newsletter sync queued");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const columns = [
		{
			key: "name",
			header: "Newsletter Name",
			cell: (row: (typeof newsletters)[0]) => (
				<div className="flex flex-col">
					<span className="font-medium text-xs">{row.name}</span>
					{row.description && (
						<span className="max-w-xs truncate text-[10px] text-muted-foreground">
							{row.description}
						</span>
					)}
				</div>
			),
		},
		{
			key: "subscribers",
			header: "Subscribers",
			cell: (row: (typeof newsletters)[0]) => (
				<span className="text-xs">{row.subscribersCount}</span>
			),
		},
		{
			key: "jid",
			header: "JID",
			cell: (row: (typeof newsletters)[0]) => (
				<span className="font-mono text-[10px] text-muted-foreground">
					{row.jid}
				</span>
			),
		},
		{
			key: "verification",
			header: "Verification",
			cell: (row: (typeof newsletters)[0]) => (
				<Badge variant="outline" className="h-4 px-1 text-[9px]">
					{row.verificationStatus ?? "UNVERIFIED"}
				</Badge>
			),
		},
		{
			key: "isSubscribed",
			header: "Subscribed",
			cell: (row: (typeof newsletters)[0]) => (
				<Badge
					variant={row.isSubscribed ? "default" : "secondary"}
					className="h-4 px-1 text-[9px]"
				>
					{row.isSubscribed ? "✓" : "Left"}
				</Badge>
			),
		},
		{
			key: "actions",
			header: "",
			cell: (row: (typeof newsletters)[0]) => {
				const device = devicesById.get(row.deviceId);
				const canSync =
					device?.provider !== "meta_cloud" && device?.status === "connected";
				return (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button variant="ghost" size="icon-xs" className="size-6" />
							}
						>
							<MoreHorizontal className="size-3.5" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								disabled={!canSync || syncOneMut.isPending}
								onClick={() => syncOneMut.mutate({ id: row.id })}
							>
								<RefreshCw className="size-3.5" />
								Refresh from WhatsApp
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				);
			},
		},
	];

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h1 className="font-semibold text-base">Newsletters</h1>
					<p className="text-muted-foreground text-xs">
						{newsletters.length} newsletters · synced from your WhatsApp devices
					</p>
				</div>
				<ResourceSyncControls devices={devices} resource="newsletters" />
			</div>

			<div className="relative max-w-xs">
				<Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="h-8 pl-8 text-xs"
					placeholder="Search newsletters..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			</div>

			{newsletters.length === 0 ? (
				<div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
					<Megaphone className="size-8 opacity-30" />
					<p className="text-xs">
						{search
							? "No newsletters found"
							: "No newsletters yet — connect a device to sync"}
					</p>
				</div>
			) : (
				<DataTable
					data={newsletters}
					columns={columns}
					getRowKey={(row) => row.id}
				/>
			)}
		</div>
	);
}
