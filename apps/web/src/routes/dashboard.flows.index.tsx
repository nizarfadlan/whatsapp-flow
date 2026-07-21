import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from "@whatsapp-flow/ui/components/alert-dialog";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button, buttonVariants } from "@whatsapp-flow/ui/components/button";
import { Card, CardContent } from "@whatsapp-flow/ui/components/card";
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
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	AlertTriangle,
	Copy,
	MessageSquare,
	MoreHorizontal,
	Pause,
	Play,
	Plus,
	Smartphone,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { useDeviceStatusSSE } from "@/hooks/use-device-status-sse";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/flows/")({
	component: FlowsPage,
});

const statusColors: Record<string, string> = {
	active: "bg-green-500",
	draft: "bg-gray-400",
	paused: "bg-yellow-500",
};

function FlowStatusBadge({ status }: { status: string }) {
	return (
		<span className="inline-flex items-center gap-1.5 text-xs">
			<span
				className={cn(
					"size-2 rounded-full",
					statusColors[status] ?? "bg-gray-400",
				)}
			/>
			{status}
		</span>
	);
}

function FlowAccessBadge({
	capability,
	owner,
}: {
	capability: "owner" | "editor" | "viewer";
	owner: { name: string; email: string };
}) {
	if (capability === "owner") {
		return <Badge variant="secondary">Owned</Badge>;
	}

	return (
		<div className="space-y-1">
			<Badge variant="outline">Shared · {capability}</Badge>
			<p className="max-w-48 truncate text-muted-foreground text-xs">
				Shared by {owner.name} · {owner.email}
			</p>
		</div>
	);
}

function DeviceBadge({
	deviceId,
	deviceName,
}: {
	deviceId: string | null;
	deviceName: string | null;
}) {
	if (!deviceId)
		return <span className="text-muted-foreground text-xs">—</span>;
	return (
		<span className="inline-flex items-center gap-1 text-xs">
			<Smartphone className="size-3 text-muted-foreground" />
			{deviceName ?? deviceId.slice(0, 8)}
		</span>
	);
}

function CreateFlowDialog({ onCreated }: { onCreated: () => void }) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");

	const create = useMutation(
		trpc.flow.create.mutationOptions({
			onSuccess: () => {
				setName("");
				setOpen(false);
				onCreated();
				toast.success("Flow created");
			},
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger className={cn(buttonVariants({ size: "sm" }), "text-xs")}>
				<Plus className="size-3.5" />
				New Flow
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create Flow</DialogTitle>
					<DialogDescription>Name your automation flow.</DialogDescription>
				</DialogHeader>
				<Input
					placeholder="Welcome Message"
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && name.trim()) {
							create.mutate({ name: name.trim() });
						}
					}}
				/>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						disabled={!name.trim() || create.isPending}
						onClick={() => create.mutate({ name: name.trim() })}
					>
						{create.isPending ? "Creating..." : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FlowsPage() {
	const trpc = useTRPC();
	const { data: flows, refetch } = useSuspenseQuery(
		trpc.flow.list.queryOptions(),
	);
	const { data: devices } = useSuspenseQuery(trpc.device.list.queryOptions());
	const [confirmFlowId, setConfirmFlowId] = useState<string | null>(null);
	useDeviceStatusSSE();

	const deleteMut = useMutation(
		trpc.flow.delete.mutationOptions({
			onSuccess: () => {
				refetch();
				toast.success("Flow deleted");
			},
		}),
	);

	const duplicateMut = useMutation(
		trpc.flow.duplicate.mutationOptions({
			onSuccess: () => {
				refetch();
				toast.success("Flow duplicated");
			},
		}),
	);

	const toggleMut = useMutation(
		trpc.flow.toggleStatus.mutationOptions({
			onSuccess: () => {
				refetch();
				toast.success("Status updated");
			},
		}),
	);

	/**
	 * When user tries to activate a flow, check if there's another active flow on the same device.
	 * If so, show confirmation dialog — otherwise proceed immediately.
	 */
	const requestActivate = (flowId: string) => {
		const targetFlow = flows.find((f) => f.id === flowId);
		if (!targetFlow?.deviceId) {
			// Will error with "Deploy flow to a device before activating"
			toggleMut.mutate({ id: flowId, status: "active" });
			return;
		}

		const conflicting = flows.find(
			(f) =>
				f.id !== flowId &&
				f.status === "active" &&
				f.deviceId === targetFlow.deviceId,
		);

		if (conflicting) {
			setConfirmFlowId(flowId);
		} else {
			toggleMut.mutate({ id: flowId, status: "active" });
		}
	};

	const confirmFlow = confirmFlowId
		? flows.find((f) => f.id === confirmFlowId)
		: null;
	const deviceForTarget = confirmFlow?.deviceId
		? devices?.find((d) => d.id === confirmFlow.deviceId)
		: null;
	const activeFlowOnDevice = confirmFlow?.deviceId
		? (flows.find(
				(f) =>
					f.id !== confirmFlow.id &&
					f.status === "active" &&
					f.deviceId === confirmFlow.deviceId,
			) ?? null)
		: null;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">
					Automate WhatsApp conversations
				</p>
				<CreateFlowDialog onCreated={() => refetch()} />
			</div>

			<Card>
				<CardContent className="p-0">
					{flows.length === 0 ? (
						<div className="flex flex-col items-center gap-3 py-12">
							<MessageSquare className="size-10 text-muted-foreground/50" />
							<p className="text-muted-foreground text-sm">No flows yet</p>
							<CreateFlowDialog onCreated={() => refetch()} />
						</div>
					) : (
						<DataTable
							data={flows}
							getRowKey={(flow) => flow.id}
							columns={[
								{
									key: "name",
									header: "Name",
									className: "font-medium",
									cell: (f) => (
										<Link
											to="/dashboard/flows/$flowId"
											params={{ flowId: f.id }}
											className="hover:text-primary hover:underline"
										>
											{f.name}
										</Link>
									),
								},
								{
									key: "access",
									header: "Access",
									cell: (f) => (
										<FlowAccessBadge
											capability={f.accessCapability}
											owner={f.owner}
										/>
									),
								},
								{
									key: "device",
									header: "Device",
									cell: (f) => (
										<DeviceBadge
											deviceId={f.deviceId}
											deviceName={f.deviceName ?? null}
										/>
									),
								},
								{
									key: "trigger",
									header: "Trigger",
									className: "text-muted-foreground",
									cell: (f) => f.triggerType,
								},
								{
									key: "status",
									header: "Status",
									cell: (f) => <FlowStatusBadge status={f.status} />,
								},
								{
									key: "updated",
									header: "Updated",
									className: "text-muted-foreground",
									cell: (f) => new Date(f.updatedAt).toLocaleDateString(),
								},
								{
									key: "actions",
									header: null,
									headClassName: "w-10",
									className: "w-10",
									cell: (f) => (
										<DropdownMenu>
											<DropdownMenuTrigger
												render={
													<Button
														variant="ghost"
														size="icon-sm"
														disabled={f.accessCapability === "viewer"}
														title={
															f.accessCapability === "viewer"
																? "View-only access"
																: "Flow actions"
														}
													/>
												}
											>
												<MoreHorizontal className="size-4" />
											</DropdownMenuTrigger>
											<DropdownMenuContent>
												{f.accessCapability !== "viewer" && (
													<DropdownMenuItem
														onClick={() => duplicateMut.mutate({ id: f.id })}
													>
														<Copy className="size-3.5" />
														Duplicate
													</DropdownMenuItem>
												)}
												{f.accessCapability === "owner" &&
													f.status !== "active" && (
														<DropdownMenuItem
															onClick={() => requestActivate(f.id)}
														>
															<Play className="size-3.5" />
															Activate
														</DropdownMenuItem>
													)}
												{f.accessCapability === "owner" &&
													f.status === "active" && (
														<DropdownMenuItem
															onClick={() =>
																toggleMut.mutate({ id: f.id, status: "paused" })
															}
														>
															<Pause className="size-3.5" />
															Pause
														</DropdownMenuItem>
													)}
												{f.accessCapability === "owner" && (
													<DropdownMenuItem
														variant="destructive"
														onClick={() => deleteMut.mutate({ id: f.id })}
													>
														<Trash2 className="size-3.5" />
														Delete
													</DropdownMenuItem>
												)}
											</DropdownMenuContent>
										</DropdownMenu>
									),
								},
							]}
						/>
					)}
				</CardContent>
			</Card>

			{/* Confirmation dialog when activating would pause another flow */}
			<AlertDialog
				open={!!confirmFlowId}
				onOpenChange={(open) => {
					if (!open) setConfirmFlowId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogMedia className="bg-destructive/10">
							<AlertTriangle className="size-5 text-destructive" />
						</AlertDialogMedia>
						<AlertDialogTitle>Activate and replace?</AlertDialogTitle>
						<AlertDialogDescription>
							Activating this flow will pause{" "}
							<strong>"{activeFlowOnDevice?.name}"</strong> on{" "}
							<strong>{deviceForTarget?.name ?? "device"}</strong>. Only one
							flow can be active per device at a time.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (confirmFlowId) {
									toggleMut.mutate({ id: confirmFlowId, status: "active" });
								}
								setConfirmFlowId(null);
							}}
						>
							Activate
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
