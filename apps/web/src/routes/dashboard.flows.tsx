import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@whatsapp-flow/ui/components/button";
import { Card, CardContent } from "@whatsapp-flow/ui/components/card";
import {
	Dialog,
	DialogCloseButton,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPopup,
	DialogPortal,
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
import { Copy, MoreHorizontal, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/flows")({
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
			<DialogTrigger className="inline-flex items-center gap-1.5 rounded-none bg-primary px-2.5 py-1.5 font-medium text-primary-foreground text-xs hover:bg-primary/80">
				<Plus className="size-3.5" />
				New Flow
			</DialogTrigger>
			<DialogPortal>
				<DialogPopup>
					<DialogCloseButton />
					<DialogHeader>
						<DialogTitle>Create Flow</DialogTitle>
						<DialogDescription>Name your automation flow.</DialogDescription>
					</DialogHeader>
					<DialogContent>
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
					</DialogContent>
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
				</DialogPopup>
			</DialogPortal>
		</Dialog>
	);
}

function FlowsPage() {
	const trpc = useTRPC();
	const { data: flows, refetch } = useSuspenseQuery(
		trpc.flow.list.queryOptions(),
	);

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
							<MessageSquareIcon className="size-10 text-muted-foreground/50" />
							<p className="text-muted-foreground text-sm">No flows yet</p>
							<CreateFlowDialog onCreated={() => refetch()} />
						</div>
					) : (
						<table className="w-full">
							<thead>
								<tr className="border-border border-b text-left text-muted-foreground text-xs">
									<th className="px-4 py-2 font-medium">Name</th>
									<th className="px-4 py-2 font-medium">Trigger</th>
									<th className="px-4 py-2 font-medium">Status</th>
									<th className="px-4 py-2 font-medium">Updated</th>
									<th className="w-10 px-4 py-2 font-medium" />
								</tr>
							</thead>
							<tbody>
								{flows.map((f) => (
									<tr
										key={f.id}
										className="border-border border-b text-xs last:border-0"
									>
										<td className="px-4 py-2.5 font-medium">
											<Link
												to="/dashboard/flows/$flowId"
												params={{ flowId: f.id }}
												className="hover:text-primary hover:underline"
											>
												{f.name}
											</Link>
										</td>
										<td className="px-4 py-2.5 text-muted-foreground">
											{f.triggerType}
										</td>
										<td className="px-4 py-2.5">
											<FlowStatusBadge status={f.status} />
										</td>
										<td className="px-4 py-2.5 text-muted-foreground">
											{new Date(f.updatedAt).toLocaleDateString()}
										</td>
										<td className="px-4 py-2.5">
											<DropdownMenu>
												<DropdownMenuTrigger className="inline-flex size-7 items-center justify-center rounded-none hover:bg-muted">
													<MoreHorizontal className="size-4" />
												</DropdownMenuTrigger>
												<DropdownMenuContent>
													<DropdownMenuItem
														onClick={() => duplicateMut.mutate({ id: f.id })}
													>
														<Copy className="size-3.5" />
														Duplicate
													</DropdownMenuItem>
													{f.status !== "active" && (
														<DropdownMenuItem
															onClick={() =>
																toggleMut.mutate({
																	id: f.id,
																	status: "active",
																})
															}
														>
															<Play className="size-3.5" />
															Activate
														</DropdownMenuItem>
													)}
													{f.status === "active" && (
														<DropdownMenuItem
															onClick={() =>
																toggleMut.mutate({
																	id: f.id,
																	status: "paused",
																})
															}
														>
															<Pause className="size-3.5" />
															Pause
														</DropdownMenuItem>
													)}
													<DropdownMenuItem
														className="text-destructive"
														onClick={() => deleteMut.mutate({ id: f.id })}
													>
														<Trash2 className="size-3.5" />
														Delete
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function MessageSquareIcon({ className }: { className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
		>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}
