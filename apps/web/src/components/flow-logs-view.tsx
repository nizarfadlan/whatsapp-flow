import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { buttonVariants } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
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
import {
	CheckCircle,
	Clock,
	Inbox,
	Loader2,
	MessageSquare,
	Smartphone,
	User,
	XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useFlowLogSSE } from "@/hooks/use-flow-log-sse";
import { useTRPC } from "@/utils/trpc";

export type FlowLogRow = {
	id: string;
	flowId: string;
	flowName: string;
	deviceId: string;
	deviceName: string;
	contactNumber: string;
	triggerSource: string;
	status: string;
	error: string | null;
	nodeResults: unknown;
	startedAt: string;
	completedAt: string | null;
	contactId: string | null;
	contactName: string | null;
	contactPushName: string | null;
	inboxThreadId: string | null;
	sessionId: string | null;
	sessionStatus: string | null;
	waitingNodeId: string | null;
	sessionExpiresAt: string | null;
};

type TimelineEvent = {
	id: string;
	type: string;
	nodeId: string | null;
	message: string | null;
	payload: unknown;
	createdAt: string;
};

const statusConfig: Record<
	string,
	{ icon: typeof CheckCircle; color: string }
> = {
	completed: { icon: CheckCircle, color: "text-green-500" },
	failed: { icon: XCircle, color: "text-destructive" },
	running: { icon: Loader2, color: "text-primary" },
	waiting: { icon: Clock, color: "text-yellow-500" },
};

const statusVariants: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	completed: "default",
	failed: "destructive",
	running: "secondary",
	waiting: "outline",
};

function resolveNodeLabel(
	nodeId: string,
	nodes: { id: string; type?: string; data?: Record<string, unknown> }[],
) {
	const node = nodes.find((n) => n.id === nodeId);
	if (!node) return nodeId;
	const data = node.data ?? {};
	return (
		(typeof data.label === "string" && data.label) ||
		(typeof data.nodeType === "string" && data.nodeType) ||
		node.type ||
		nodeId
	);
}

function formatDuration(startedAt: string, completedAt: string | null) {
	if (!completedAt) return "—";
	const seconds =
		(new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000;
	return `${seconds.toFixed(1)}s`;
}

function normalizePayload(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function formatEventType(type: string) {
	return type.replaceAll(".", " ");
}

function ContactCell({ log }: { log: FlowLogRow }) {
	const displayName =
		log.contactName ?? log.contactPushName ?? log.contactNumber;

	if (log.inboxThreadId) {
		return (
			<Link
				to="/dashboard/inbox"
				search={{ thread: log.inboxThreadId }}
				className="group inline-flex flex-col hover:text-primary"
			>
				<span className="font-medium">{displayName}</span>
				<span className="font-mono text-[10px] text-muted-foreground group-hover:text-primary/70">
					{log.contactNumber}
				</span>
			</Link>
		);
	}

	if (log.contactId) {
		return (
			<Link
				to="/dashboard/contacts"
				search={{ search: log.contactNumber }}
				className="group inline-flex flex-col hover:text-primary"
			>
				<span className="font-medium">{displayName}</span>
				<span className="font-mono text-[10px] text-muted-foreground group-hover:text-primary/70">
					{log.contactNumber}
				</span>
			</Link>
		);
	}

	return (
		<div className="flex flex-col">
			<span className="font-medium">{displayName}</span>
			<span className="font-mono text-[10px] text-muted-foreground">
				{log.contactNumber}
			</span>
		</div>
	);
}

function LogDetailPanel({
	logId,
	flowNodes,
}: {
	logId: string;
	flowNodes?: { id: string; type?: string; data?: Record<string, unknown> }[];
}) {
	const trpc = useTRPC();
	const { data: log } = useSuspenseQuery(
		trpc.flowLog.getById.queryOptions({ id: logId }),
	);
	const { data: timeline } = useSuspenseQuery(
		trpc.flowLog.timeline.queryOptions({ id: logId }),
	);

	const events = timeline as TimelineEvent[];
	const nodes =
		flowNodes ??
		((log?.flowNodes ?? []) as {
			id: string;
			type?: string;
			data?: Record<string, unknown>;
		}[]);

	const nodeResults = useMemo(() => {
		if (!log || !Array.isArray(log.nodeResults)) return [];
		return log.nodeResults as {
			nodeId: string;
			status: string;
			output?: string;
			error?: string;
		}[];
	}, [log]);

	if (!log) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-muted-foreground text-xs">
				Log not found.
			</div>
		);
	}

	return (
		<Card className="h-full rounded-none border-0 border-l bg-card/80 py-0 ring-0">
			<CardHeader className="border-b px-4 py-4">
				<CardTitle className="text-sm">Execution detail</CardTitle>
				<p className="font-mono text-muted-foreground text-xs">
					{log.contactNumber}
				</p>
			</CardHeader>
			<CardContent className="space-y-4 p-4">
				<div className="space-y-2">
					<div className="flex items-center justify-between rounded-lg border bg-background p-3">
						<span className="text-muted-foreground text-xs">Status</span>
						<Badge variant={statusVariants[log.status] ?? "secondary"}>
							{log.status}
						</Badge>
					</div>
					<div className="rounded-lg border bg-background p-3 text-xs">
						<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
							Flow
						</p>
						<Link
							to="/dashboard/flows/$flowId"
							params={{ flowId: log.flowId }}
							className="mt-1 block font-medium hover:text-primary"
						>
							{log.flowName}
						</Link>
					</div>
					<div className="rounded-lg border bg-background p-3 text-xs">
						<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
							Device
						</p>
						<p className="mt-1 flex items-center gap-1.5 font-medium">
							<Smartphone className="size-3 text-muted-foreground" />
							{log.deviceName}
						</p>
					</div>
					<div className="rounded-lg border bg-background p-3 text-xs">
						<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
							Trigger
						</p>
						<p className="mt-1 font-medium">{log.triggerSource}</p>
					</div>
				</div>

				{log.sessionId && (
					<div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs">
						<p className="font-medium text-yellow-700 dark:text-yellow-400">
							Session · {log.sessionStatus}
						</p>
						{log.waitingNodeId && (
							<p className="mt-1 text-muted-foreground">
								Waiting at: {resolveNodeLabel(log.waitingNodeId, nodes)}
							</p>
						)}
						{log.sessionExpiresAt && (
							<p className="mt-1 text-muted-foreground">
								Expires: {new Date(log.sessionExpiresAt).toLocaleString()}
							</p>
						)}
						<Link
							to="/dashboard/flows/$flowId/sessions"
							params={{ flowId: log.flowId }}
							className={cn(
								buttonVariants({ variant: "outline", size: "sm" }),
								"mt-2 h-7 w-full text-xs",
							)}
						>
							View sessions
						</Link>
					</div>
				)}

				{log.error && (
					<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-xs">
						{log.error}
					</div>
				)}

				{events.length > 0 && (
					<div>
						<p className="mb-2 font-medium text-xs">Execution timeline</p>
						<div className="space-y-1.5">
							{events.map((event) => {
								const payload = normalizePayload(event.payload);
								const maskedPreview =
									typeof payload.maskedPreview === "string"
										? payload.maskedPreview
										: null;
								return (
									<div
										key={event.id}
										className="rounded-lg border bg-background p-2.5 text-xs"
									>
										<div className="flex items-center justify-between gap-2">
											<span className="font-medium capitalize">
												{formatEventType(event.type)}
											</span>
											<span className="text-[10px] text-muted-foreground">
												{new Date(event.createdAt).toLocaleTimeString()}
											</span>
										</div>
										{event.nodeId && (
											<p className="mt-0.5 text-muted-foreground">
												{resolveNodeLabel(event.nodeId, nodes)}
											</p>
										)}
										{event.message && (
											<p className="mt-1 text-muted-foreground">
												{event.message}
											</p>
										)}
										{maskedPreview && (
											<p className="mt-1 font-mono text-muted-foreground">
												Reply: {maskedPreview}
											</p>
										)}
									</div>
								);
							})}
						</div>
					</div>
				)}

				{nodeResults.length > 0 && (
					<div>
						<p className="mb-2 font-medium text-xs">Node progress</p>
						<div className="space-y-1.5">
							{nodeResults.map((result, index) => (
								<div
									key={`${result.nodeId}-${index}`}
									className="rounded-lg border bg-background p-2.5 text-xs"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="truncate font-medium">
											{resolveNodeLabel(result.nodeId, nodes)}
										</span>
										<Badge
											variant={
												result.status === "success" ? "default" : "destructive"
											}
											className="h-4 px-1.5 text-[9px]"
										>
											{result.status}
										</Badge>
									</div>
									<p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
										{result.nodeId}
									</p>
									{result.output && (
										<p className="mt-1 text-muted-foreground">
											{result.output}
										</p>
									)}
									{result.error && (
										<p className="mt-1 text-destructive">{result.error}</p>
									)}
								</div>
							))}
						</div>
					</div>
				)}

				<div className="space-y-1.5">
					{log.inboxThreadId && (
						<Link
							to="/dashboard/inbox"
							search={{ thread: log.inboxThreadId }}
							className={cn(
								buttonVariants({ variant: "outline", size: "sm" }),
								"h-8 w-full justify-start text-xs",
							)}
						>
							<Inbox className="size-3.5" />
							Open conversation
						</Link>
					)}
					{log.contactId && (
						<Link
							to="/dashboard/contacts"
							search={{ search: log.contactNumber }}
							className={cn(
								buttonVariants({ variant: "outline", size: "sm" }),
								"h-8 w-full justify-start text-xs",
							)}
						>
							<User className="size-3.5" />
							View contact
						</Link>
					)}
					<Link
						to="/dashboard/flows/$flowId"
						params={{ flowId: log.flowId }}
						className={cn(
							buttonVariants({ variant: "outline", size: "sm" }),
							"h-8 w-full justify-start text-xs",
						)}
					>
						<MessageSquare className="size-3.5" />
						Open flow
					</Link>
				</div>
			</CardContent>
		</Card>
	);
}

export function FlowLogsView({
	flowId,
	title,
	description,
	limit = 50,
	flowNodes,
}: {
	flowId?: string;
	title?: string;
	description?: string;
	limit?: number;
	flowNodes?: { id: string; type?: string; data?: Record<string, unknown> }[];
}) {
	const trpc = useTRPC();
	const { data: logs } = useSuspenseQuery(
		trpc.flowLog.list.queryOptions({ flowId, limit }),
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	useFlowLogSSE();

	const typedLogs = logs as FlowLogRow[];
	const selectedLog = selectedId
		? typedLogs.find((log) => log.id === selectedId)
		: null;

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			{(title || description) && (
				<div className="shrink-0 border-b bg-background px-4 py-4 md:px-5">
					{title && <h1 className="font-semibold text-sm">{title}</h1>}
					{description && (
						<p className="text-muted-foreground text-xs">{description}</p>
					)}
				</div>
			)}

			<div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] overflow-hidden bg-muted/30">
				<Card className="rounded-none border-0 bg-card/80 py-0 ring-0">
					<CardContent className="p-0">
						{typedLogs.length === 0 ? (
							<div className="flex flex-col items-center gap-3 py-16">
								<Clock className="size-10 text-muted-foreground/50" />
								<div className="space-y-1 text-center">
									<p className="font-medium text-sm">No execution logs yet</p>
									<p className="text-muted-foreground text-xs">
										Logs appear when a flow processes a WhatsApp message.
									</p>
								</div>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Status</TableHead>
										{!flowId && <TableHead>Flow</TableHead>}
										<TableHead>Contact</TableHead>
										<TableHead>Trigger</TableHead>
										<TableHead>Progress</TableHead>
										<TableHead>Started</TableHead>
										<TableHead>Duration</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{typedLogs.map((log) => {
										const sc = statusConfig[log.status] ?? statusConfig.running;
										const Icon = sc.icon;
										const progress = Array.isArray(log.nodeResults)
											? log.nodeResults.length
											: 0;

										return (
											<TableRow
												key={log.id}
												className={cn(
													"cursor-pointer",
													selectedId === log.id && "bg-muted/50",
												)}
												onClick={() => setSelectedId(log.id)}
											>
												<TableCell>
													<Badge
														variant={statusVariants[log.status] ?? "secondary"}
													>
														<Icon
															className={cn(
																"size-3",
																sc.color,
																(log.status === "running" ||
																	log.status === "waiting") &&
																	"animate-spin",
															)}
														/>
														{log.status}
													</Badge>
												</TableCell>
												{!flowId && (
													<TableCell>
														<Link
															to="/dashboard/flows/$flowId"
															params={{ flowId: log.flowId }}
															className="hover:text-primary hover:underline"
															onClick={(e) => e.stopPropagation()}
														>
															{log.flowName}
														</Link>
													</TableCell>
												)}
												<TableCell>
													<ContactCell log={log} />
												</TableCell>
												<TableCell className="text-muted-foreground text-xs">
													{log.triggerSource}
												</TableCell>
												<TableCell className="text-muted-foreground text-xs">
													{progress > 0 ? `${progress} nodes` : "—"}
													{log.sessionId && (
														<Badge
															variant="outline"
															className="ml-1.5 h-4 px-1 text-[9px]"
														>
															session
														</Badge>
													)}
												</TableCell>
												<TableCell className="text-muted-foreground text-xs">
													{new Date(log.startedAt).toLocaleString()}
												</TableCell>
												<TableCell className="text-muted-foreground text-xs">
													{formatDuration(log.startedAt, log.completedAt)}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				<div className="min-h-0 overflow-y-auto">
					{selectedLog ? (
						<LogDetailPanel logId={selectedLog.id} flowNodes={flowNodes} />
					) : (
						<div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-xs">
							Select a log to see node progress, active session, and links to
							contact or inbox.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
