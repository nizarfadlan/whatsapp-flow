import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Input } from "@whatsapp-flow/ui/components/input";
import { Megaphone, Search } from "lucide-react";
import { useState } from "react";
import { DataTable } from "@/components/data-table";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/newsletters")({
	component: NewslettersPage,
});

function NewslettersPage() {
	const trpc = useTRPC();
	const [search, setSearch] = useState("");

	const { data: newsletters = [] } = useSuspenseQuery(
		trpc.channel.list.queryOptions({ search: search || undefined, limit: 100 }),
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
	];

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-base">Newsletters</h1>
					<p className="text-muted-foreground text-xs">
						{newsletters.length} newsletters · synced from your WhatsApp devices
					</p>
				</div>
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
