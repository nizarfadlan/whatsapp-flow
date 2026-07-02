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
	AlertDialogTitle,
} from "@whatsapp-flow/ui/components/alert-dialog";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button, buttonVariants } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@whatsapp-flow/ui/components/table";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { ArrowLeft, Clock, Loader2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/flows/$flowId/sessions")({
	component: FlowSessionsPage,
});

type SessionRow = {
	id: string;
	contactNumber: string;
	status: string;
	waitingNodeId: string;
	expiresAt: string | null;
	createdAt: string;
	variables: unknown;
	nodeResults: unknown;
};

const statusVariants: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	waiting: "secondary",
	running: "default",
};

function resolveNodeLabel(
	nodeId: string,
	nodes: { id: string; type?: string; data?: Record<string, unknown> }[],
) {
	const node = nodes.find((n) => n.id === nodeId);
	if (!node) return nodeId;
	const data = node.data ?? {};
	const label =
		(typeof data.label === "string" && data.label) ||
		(typeof data.nodeType === "string" && data.nodeType) ||
		node.type;
	return label ?? nodeId;
}

function SessionDetails({
	session,
	nodeLabel,
	onCancel,
	isCancelling,
}: {
	session: SessionRow;
	nodeLabel: string;
	onCancel: () => void;
	isCancelling: boolean;
}) {
	const variables = useMemo(() => {
		if (!session.variables || typeof session.variables !== "object") return {};
		return session.variables as Record<string, string>;
	}, [session.variables]);

	const nodeResults = useMemo(() => {
		if (!Array.isArray(session.nodeResults)) return [];
		return session.nodeResults as {
			nodeId: string;
			status: string;
			output?: string;
			error?: string;
		}[];
	}, [session.nodeResults]);

	return (
		<Card className="h-full rounded-none border-0 border-l bg-card/80 py-0 ring-0">
			<CardHeader className="border-b px-4 py-4">
				<CardTitle className="text-sm">Session details</CardTitle>
				<CardDescription className="font-mono text-xs">
					{session.contactNumber}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 p-4">
				<div className="space-y-2">
					<div className="flex items-center justify-between rounded-lg border bg-background p-3">
						<span className="text-muted-foreground text-xs">Status</span>
						<Badge variant={statusVariants[session.status] ?? "outline"}>
							{session.status}
						</Badge>
					</div>
					<div className="rounded-lg border bg-background p-3">
						<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
							Current node
						</p>
						<p className="mt-1 font-medium text-sm">{nodeLabel}</p>
						<p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
							{session.waitingNodeId}
						</p>
					</div>
					<div className="rounded-lg border bg-background p-3">
						<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
							Started
						</p>
						<p className="mt-1 text-xs">
							{new Date(session.createdAt).toLocaleString()}
						</p>
					</div>
					{session.expiresAt && (
						<div className="rounded-lg border bg-background p-3">
							<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
								Expires
							</p>
							<p className="mt-1 text-xs">
								{new Date(session.expiresAt).toLocaleString()}
							</p>
						</div>
					)}
				</div>

				{Object.keys(variables).length > 0 && (
					<div>
						<p className="mb-2 font-medium text-xs">Variables</p>
						<div className="space-y-1 rounded-lg border bg-background p-3">
							{Object.entries(variables).map(([key, value]) => (
								<div key={key} className="flex gap-2 text-xs">
									<span className="font-mono text-muted-foreground">{key}</span>
									<span className="truncate">{value}</span>
								</div>
							))}
						</div>
					</div>
				)}

				{nodeResults.length > 0 && (
					<div>
						<p className="mb-2 font-medium text-xs">Node progress</p>
						<div className="space-y-1.5">
							{nodeResults.map((result) => (
								<div
									key={result.nodeId}
									className="rounded-lg border bg-background p-2.5 text-xs"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="truncate font-mono">{result.nodeId}</span>
										<Badge
											variant={
												result.status === "success" ? "default" : "destructive"
											}
											className="h-4 px-1.5 text-[9px]"
										>
											{result.status}
										</Badge>
									</div>
									{result.output && (
										<p className="mt-1 truncate text-muted-foreground">
											{result.output}
										</p>
									)}
									{result.error && (
										<p className="mt-1 truncate text-destructive">
											{result.error}
										</p>
									)}
								</div>
							))}
						</div>
					</div>
				)}

				<Button
					variant="destructive"
					size="sm"
					className="w-full text-xs"
					onClick={onCancel}
					disabled={isCancelling}
				>
					<XCircle className="size-3.5" />
					{isCancelling ? "Cancelling..." : "Cancel session"}
				</Button>
			</CardContent>
		</Card>
	);
}

function FlowSessionsPage() {
	const { flowId } = Route.useParams();
	const trpc = useTRPC();
	const { data: flow } = useSuspenseQuery(
		trpc.flow.getById.queryOptions({ id: flowId }),
	);
	const { data: sessions, refetch } = useSuspenseQuery(
		trpc.flowSession.list.queryOptions({ flowId }),
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [cancelId, setCancelId] = useState<string | null>(null);

	const cancelMut = useMutation(
		trpc.flowSession.cancel.mutationOptions({
			onSuccess: () => {
				toast.success("Session cancelled");
				setCancelId(null);
				setSelectedId(null);
				refetch();
			},
			onError: (err) => toast.error(err.message),
		}),
	);

	const flowNodes = (flow.nodes ?? []) as {
		id: string;
		type?: string;
		data?: Record<string, unknown>;
	}[];
	const typedSessions = sessions as SessionRow[];
	const selectedSession = selectedId
		? typedSessions.find((s) => s.id === selectedId)
		: null;

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-5">
				<div>
					<h1 className="font-semibold text-sm">
						{flow.name} · Active Sessions
					</h1>
					<p className="text-muted-foreground text-xs">
						Contacts currently waiting for a reply or running through this flow.
					</p>
				</div>
				<Link
					to="/dashboard/flows/$flowId"
					params={{ flowId }}
					className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
				>
					<ArrowLeft className="size-3.5" />
					Back to Editor
				</Link>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] overflow-hidden bg-muted/30">
				<Card className="rounded-none border-0 bg-card/80 py-0 ring-0">
					<CardContent className="p-0">
						{typedSessions.length === 0 ? (
							<div className="flex flex-col items-center gap-3 py-16">
								<Clock className="size-10 text-muted-foreground/50" />
								<div className="space-y-1 text-center">
									<p className="font-medium text-sm">No active sessions</p>
									<p className="text-muted-foreground text-xs">
										Sessions appear when a contact reaches a wait-for-reply
										node.
									</p>
								</div>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Contact</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Current node</TableHead>
										<TableHead>Started</TableHead>
										<TableHead>Expires</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{typedSessions.map((session) => (
										<TableRow
											key={session.id}
											className={cn(
												"cursor-pointer",
												selectedId === session.id && "bg-muted/50",
											)}
											onClick={() => setSelectedId(session.id)}
										>
											<TableCell className="font-medium font-mono">
												{session.contactNumber}
											</TableCell>
											<TableCell>
												<Badge
													variant={statusVariants[session.status] ?? "outline"}
												>
													{session.status === "running" && (
														<Loader2 className="size-3 animate-spin" />
													)}
													{session.status}
												</Badge>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{resolveNodeLabel(session.waitingNodeId, flowNodes)}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{new Date(session.createdAt).toLocaleString()}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{session.expiresAt
													? new Date(session.expiresAt).toLocaleString()
													: "—"}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				<div className="min-h-0 overflow-y-auto">
					{selectedSession ? (
						<SessionDetails
							session={selectedSession}
							nodeLabel={resolveNodeLabel(
								selectedSession.waitingNodeId,
								flowNodes,
							)}
							onCancel={() => setCancelId(selectedSession.id)}
							isCancelling={cancelMut.isPending}
						/>
					) : (
						<div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-xs">
							Select a session to view variables and node progress.
						</div>
					)}
				</div>
			</div>

			<AlertDialog
				open={!!cancelId}
				onOpenChange={(open) => {
					if (!open) setCancelId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel session?</AlertDialogTitle>
						<AlertDialogDescription>
							This will expire the active session. The contact will no longer be
							waiting for a reply in this flow.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep session</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (cancelId) cancelMut.mutate({ id: cancelId });
							}}
						>
							Cancel session
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
