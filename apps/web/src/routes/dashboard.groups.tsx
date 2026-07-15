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
import { MoreHorizontal, RefreshCw, Search, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import {
	ResourceSyncControls,
	useResourceSyncCompletion,
} from "@/components/resource-sync-controls";
import { TagBadges, TagPicker } from "@/components/tag-picker";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/groups")({
	component: GroupsPage,
});

function GroupsPage() {
	const trpc = useTRPC();
	const trackSyncCompletion = useResourceSyncCompletion("groups");
	const [search, setSearch] = useState("");
	const { data: groups = [], refetch } = useSuspenseQuery(
		trpc.group.list.queryOptions({ search: search || undefined, limit: 100 }),
	);
	const { data: devices = [] } = useSuspenseQuery(
		trpc.device.list.queryOptions(),
	);
	const devicesById = new Map(devices.map((device) => [device.id, device]));
	const syncOneMut = useMutation(
		trpc.group.syncOne.mutationOptions({
			onSuccess: (result) => {
				trackSyncCompletion(result);
				toast.success("Group sync queued");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const columns = [
		{
			key: "subject",
			header: "Group Name",
			cell: (row: (typeof groups)[0]) => (
				<div className="flex flex-col">
					<span className="font-medium text-xs">{row.subject}</span>
					{row.description && (
						<span className="max-w-xs truncate text-[10px] text-muted-foreground">
							{row.description}
						</span>
					)}
				</div>
			),
		},
		{
			key: "participants",
			header: "Members",
			cell: (row: (typeof groups)[0]) => (
				<span className="text-xs">{row.participantCount}</span>
			),
		},
		{
			key: "jid",
			header: "JID",
			cell: (row: (typeof groups)[0]) => (
				<span className="font-mono text-[10px] text-muted-foreground">
					{row.jid}
				</span>
			),
		},
		{
			key: "source",
			header: "Source",
			cell: (row: (typeof groups)[0]) => (
				<Badge variant="outline" className="h-4 px-1 text-[9px]">
					{row.source}
				</Badge>
			),
		},
		{
			key: "isMember",
			header: "Member",
			cell: (row: (typeof groups)[0]) => (
				<Badge
					variant={row.isMember ? "default" : "secondary"}
					className="h-4 px-1 text-[9px]"
				>
					{row.isMember ? "✓" : "Left"}
				</Badge>
			),
		},
		{
			key: "tags",
			header: "Tags",
			cell: (row: (typeof groups)[0]) => (
				<div className="flex items-center gap-1">
					<TagBadges tags={row.tags} />
					<TagPicker
						resource="group"
						resourceId={row.id}
						tags={row.tags}
						onSaved={refetch}
					/>
				</div>
			),
		},
		{
			key: "actions",
			header: "",
			cell: (row: (typeof groups)[0]) => {
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
					<h1 className="font-semibold text-base">Groups</h1>
					<p className="text-muted-foreground text-xs">
						{groups.length} groups · synced from your WhatsApp devices
					</p>
				</div>
				<ResourceSyncControls devices={devices} resource="groups" />
			</div>

			<div className="relative max-w-xs">
				<Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="h-8 pl-8 text-xs"
					placeholder="Search groups..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			</div>

			{groups.length === 0 ? (
				<div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
					<UsersRound className="size-8 opacity-30" />
					<p className="text-xs">
						{search
							? "No groups found"
							: "No groups yet — connect a device to sync"}
					</p>
				</div>
			) : (
				<DataTable
					data={groups}
					columns={columns}
					getRowKey={(row) => row.id}
				/>
			)}
		</div>
	);
}
