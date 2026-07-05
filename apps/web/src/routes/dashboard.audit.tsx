import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@whatsapp-flow/ui/components/dialog";
import { Input } from "@whatsapp-flow/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@whatsapp-flow/ui/components/table";
import { ClipboardList, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/audit")({
	component: AuditPage,
});

type AuditLogSummary = {
	id: string;
	actorEmail?: string | null;
	action: string;
	targetType: string;
	targetId?: string | null;
	targetDisplay?: string | null;
	requestIp?: string | null;
	createdAt: Date | string;
};

function prettyJson(value: unknown) {
	if (value == null) return "null";
	return JSON.stringify(value, null, 2);
}

function formatTimestamp(value: Date | string) {
	return new Date(value).toLocaleString();
}

function targetLabel(log: AuditLogSummary) {
	if (log.targetDisplay) return log.targetDisplay;
	if (log.targetId) return log.targetId;
	return "—";
}

function AuditPage() {
	const trpc = useTRPC();
	const [query, setQuery] = useState("");
	const [action, setAction] = useState("");
	const [targetType, setTargetType] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const listInput = useMemo(
		() => ({
			query: query.trim() || undefined,
			action: action.trim() || undefined,
			targetType: targetType.trim() || undefined,
			limit: 50,
			offset: 0,
		}),
		[query, action, targetType],
	);
	const auditQuery = useQuery(trpc.audit.list.queryOptions(listInput));
	const detailQuery = useQuery({
		...trpc.audit.get.queryOptions({ id: selectedId ?? "" }),
		enabled: Boolean(selectedId),
	});
	const logs = auditQuery.data?.logs ?? [];
	const selected = detailQuery.data;

	if (auditQuery.error) {
		return (
			<div className="space-y-2">
				<h2 className="font-semibold text-xl">Audit log unavailable</h2>
				<p className="text-muted-foreground text-sm">
					{auditQuery.error.message === "Admin access required"
						? "You do not have access to audit logs."
						: auditQuery.error.message}
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="space-y-1">
				<h2 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
					<ClipboardList className="size-6 text-primary" />
					Audit log
				</h2>
				<p className="text-muted-foreground text-sm">
					Review sensitive admin, user, settings, auth-provider, and device
					actions.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Security activity</CardTitle>
					<CardDescription>
						Audit events are append-only and redact known secret-bearing keys
						before persistence.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
						<div className="relative">
							<Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								className="pl-9"
								placeholder="Search actor, action, target"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
						</div>
						<Input
							placeholder="Action filter"
							value={action}
							onChange={(event) => setAction(event.target.value)}
						/>
						<Input
							placeholder="Target type"
							value={targetType}
							onChange={(event) => setTargetType(event.target.value)}
						/>
					</div>

					<div className="rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Timestamp</TableHead>
									<TableHead>Actor</TableHead>
									<TableHead>Action</TableHead>
									<TableHead>Target</TableHead>
									<TableHead>IP</TableHead>
									<TableHead className="text-right">Details</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{auditQuery.isPending ? (
									<TableRow>
										<TableCell colSpan={6}>
											<div className="py-8 text-center text-muted-foreground text-sm">
												Loading audit logs...
											</div>
										</TableCell>
									</TableRow>
								) : (
									logs.map((log) => (
										<TableRow key={log.id}>
											<TableCell className="whitespace-nowrap text-sm">
												{formatTimestamp(log.createdAt)}
											</TableCell>
											<TableCell>{log.actorEmail ?? "System"}</TableCell>
											<TableCell>
												<Badge variant="outline">{log.action}</Badge>
											</TableCell>
											<TableCell>
												<div className="space-y-1">
													<p className="font-medium text-sm">
														{targetLabel(log)}
													</p>
													<p className="text-muted-foreground text-xs">
														{log.targetType}
													</p>
												</div>
											</TableCell>
											<TableCell>{log.requestIp ?? "—"}</TableCell>
											<TableCell className="text-right">
												<Button
													variant="outline"
													size="sm"
													onClick={() => setSelectedId(log.id)}
												>
													View
												</Button>
											</TableCell>
										</TableRow>
									))
								)}
								{!auditQuery.isPending && logs.length === 0 && (
									<TableRow>
										<TableCell colSpan={6}>
											<div className="py-8 text-center text-muted-foreground text-sm">
												No audit logs match the current filters.
											</div>
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>

					<div className="flex items-center justify-between text-muted-foreground text-xs">
						<span>{auditQuery.data?.total ?? 0} total events</span>
						<span>Showing newest 50 events</span>
					</div>
				</CardContent>
			</Card>

			<Dialog
				open={Boolean(selectedId)}
				onOpenChange={(open) => {
					if (!open) setSelectedId(null);
				}}
			>
				<DialogContent className="max-w-3xl">
					<DialogHeader>
						<DialogTitle>Audit event details</DialogTitle>
						<DialogDescription>
							{selected
								? `${selected.action} · ${formatTimestamp(selected.createdAt)}`
								: "Loading event details..."}
						</DialogDescription>
					</DialogHeader>
					{selected && (
						<div className="max-h-[70vh] space-y-4 overflow-auto pr-1">
							<div className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
								<div>
									<p className="text-muted-foreground text-xs">Actor</p>
									<p>{selected.actorEmail ?? "System"}</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Request IP</p>
									<p>{selected.requestIp ?? "—"}</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Target</p>
									<p>{selected.targetDisplay ?? selected.targetId ?? "—"}</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Target type</p>
									<p>{selected.targetType}</p>
								</div>
								<div className="sm:col-span-2">
									<p className="text-muted-foreground text-xs">User agent</p>
									<p className="break-words">
										{selected.requestUserAgent ?? "—"}
									</p>
								</div>
								<div className="sm:col-span-2">
									<p className="text-muted-foreground text-xs">Reason</p>
									<p>{selected.reason ?? "—"}</p>
								</div>
							</div>

							{[
								["Before", selected.before],
								["After", selected.after],
								["Metadata", selected.metadata],
							].map(([label, value]) => (
								<div key={label as string} className="space-y-2">
									<h3 className="font-medium text-sm">{label as string}</h3>
									<pre className="overflow-auto rounded-lg border bg-muted p-3 text-xs">
										{prettyJson(value)}
									</pre>
								</div>
							))}
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
