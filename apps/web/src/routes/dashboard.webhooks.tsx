import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@whatsapp-flow/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@whatsapp-flow/ui/components/dropdown-menu";
import { Input } from "@whatsapp-flow/ui/components/input";
import {
	Globe,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Trash2,
	Webhook as WebhookIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/webhooks")({
	component: WebhooksPage,
});

function WebhooksPage() {
	const trpc = useTRPC();
	const [addOpen, setAddOpen] = useState(false);
	const [newName, setNewName] = useState("");
	const [newUrl, setNewUrl] = useState("");

	const { data: webhooks = [], refetch } = useSuspenseQuery(
		trpc.webhook.listEndpoints.queryOptions(),
	);

	const addMut = useMutation(
		trpc.webhook.createEndpoint.mutationOptions({
			onSuccess: () => {
				setAddOpen(false);
				setNewName("");
				setNewUrl("");
				toast.success("Webhook saved. Start listening to events!");
				refetch();
			},
			onError: (e) => toast.error(e.message ?? "Failed to add webhook"),
		}),
	);

	const deleteMut = useMutation(
		trpc.webhook.deleteEndpoint.mutationOptions({
			onSuccess: () => {
				toast.success("Webhook deleted");
				refetch();
			},
			onError: (e) => toast.error(e.message ?? "Failed to delete webhook"),
		}),
	);

	const rollSecretMut = useMutation(
		trpc.webhook.regenerateSecret.mutationOptions({
			onSuccess: (data) => {
				toast.success("Secret regenerated!");
				refetch();
				alert(
					`New secret generated:\n\n${data.secret}\n\nPlease update your server config.`,
				);
			},
			onError: (e) => toast.error(e.message ?? "Failed to regenerate secret"),
		}),
	);

	const columns = [
		{
			key: "name",
			header: "Name",
			cell: (row: (typeof webhooks)[0]) => (
				<span className="cursor-pointer truncate font-medium text-foreground text-xs underline decoration-border decoration-dotted underline-offset-4">
					{row.name}
				</span>
			),
		},
		{
			key: "url",
			header: "Target URL",
			cell: (row: (typeof webhooks)[0]) => (
				<span className="block max-w-xs truncate font-mono text-xs">
					{row.url}
				</span>
			),
		},
		{
			key: "scope",
			header: "Scope",
			cell: (row: (typeof webhooks)[0]) => (
				<Badge variant="outline" className="h-4 gap-1 px-1 text-[9px]">
					<Globe className="mr-0.5 h-2.5 w-2.5 text-muted-foreground" />
					{row.deviceId ? `Device: ${row.deviceId}` : "Global (All Devices)"}
				</Badge>
			),
		},
		{
			key: "isActive",
			header: "Status",
			cell: (row: (typeof webhooks)[0]) => (
				<Badge
					variant={row.isActive ? "default" : "secondary"}
					className="h-4 px-1 text-[9px]"
				>
					{row.isActive ? "Active" : "Disabled"}
				</Badge>
			),
		},
		{
			key: "actions",
			header: "",
			cell: (row: (typeof webhooks)[0]) => (
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
							onClick={() => rollSecretMut.mutate({ id: row.id })}
						>
							<RefreshCw className="mr-2 size-3.5" />
							Roll Secret
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-destructive"
							onClick={() => {
								if (
									confirm(
										"Are you sure you want to delete this webhook endpoint?",
									)
								) {
									deleteMut.mutate({ id: row.id });
								}
							}}
						>
							<Trash2 className="mr-2 size-3.5" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	];

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-base">Outbound Webhooks</h1>
					<p className="text-muted-foreground text-xs">
						{webhooks.length} endpoints · Send WhatsApp events directly to your
						backend
					</p>
				</div>
				<Dialog open={addOpen} onOpenChange={setAddOpen}>
					<DialogTrigger
						render={<Button size="sm" className="h-7 gap-1.5 text-xs" />}
					>
						<Plus className="size-3.5" />
						New Endpoint
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Create Webhook</DialogTitle>
							<DialogDescription>
								Configure an HTTPS endpoint to receive programmatic event
								notifications via POST request.
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-1">
								<label className="font-medium text-xs" htmlFor="wh-name">
									Endpoint Name
								</label>
								<Input
									id="wh-name"
									placeholder="Production Backend"
									value={newName}
									onChange={(e) => setNewName(e.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="font-medium text-xs" htmlFor="wh-url">
									Payload URL *
								</label>
								<Input
									id="wh-url"
									placeholder="https://api.yourdomain.com/webhook/wa"
									value={newUrl}
									onChange={(e) => setNewUrl(e.target.value)}
								/>
							</div>
							<div className="mt-1 rounded-md border bg-muted/20 p-2">
								<p className="text-[10px] text-muted-foreground leading-relaxed">
									Requests are secured using an HMAC-SHA256 signature generated
									with a unique secret accessible after creation. Delivery
									guarantees use exponential backoff, failing after maximum
									retries.
								</p>
							</div>
						</div>
						<DialogFooter>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setAddOpen(false)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								disabled={!newUrl.trim() || addMut.isPending}
								onClick={() =>
									addMut.mutate({
										name: newName.trim() || `Endpoint ${webhooks.length + 1}`,
										url: newUrl.trim(),
									})
								}
							>
								{addMut.isPending ? "Creating..." : "Create Webhook"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			{webhooks.length === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/10 py-16 text-muted-foreground">
					<WebhookIcon className="size-8 opacity-30" />
					<div className="text-center">
						<p className="mb-1 font-medium text-foreground/80 text-sm">
							Listen to events
						</p>
						<p className="mx-auto max-w-sm text-xs">
							Webhooks are HTTP endpoints that receive events when things
							happen, like incoming messages or device disconnects.
						</p>
					</div>
					<Button
						size="sm"
						variant="secondary"
						className="mt-2 text-xs"
						onClick={() => setAddOpen(true)}
					>
						Add your first URL
					</Button>
				</div>
			) : (
				<div className="max-w-full overflow-x-auto rounded-md border text-sm">
					<DataTable
						data={webhooks}
						columns={columns}
						getRowKey={(row) => row.id}
					/>
				</div>
			)}
		</div>
	);
}
