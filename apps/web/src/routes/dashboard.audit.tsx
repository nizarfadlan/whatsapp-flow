import { useMutation, useQuery } from "@tanstack/react-query";
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
import { ClipboardList, Download, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const filters = useMemo(
		() => ({
			query: query.trim() || undefined,
			action: action.trim() || undefined,
			targetType: targetType.trim() || undefined,
			from: from || undefined,
			to: to || undefined,
		}),
		[query, action, targetType, from, to],
	);
	const listInput = useMemo(
		() => ({
			...filters,
			limit: 50,
			offset: 0,
		}),
		[filters],
	);
	const auditQuery = useQuery(trpc.audit.list.queryOptions(listInput));
	const permissionsQuery = useQuery(trpc.rbac.me.queryOptions());
	const canExport =
		permissionsQuery.data?.permissions.includes("audit.export") ?? false;
	const canVerify =
		permissionsQuery.data?.permissions.includes("audit.verify") ?? false;
	const exportsQuery = useQuery({
		...trpc.audit.listExports.queryOptions(),
		enabled: canExport,
	});
	const verifyRange = useMutation(
		trpc.audit.verifyRange.mutationOptions({
			onSuccess: (result) => {
				if (result.valid) {
					toast.success(`Audit chain verified (${result.rowCount} rows)`);
				} else {
					toast.error(
						`Audit verification failed (${result.failures.length} issues)`,
					);
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const exportJson = useMutation(
		trpc.audit.exportJson.mutationOptions({
			onSuccess: (result) => {
				const blob = new Blob([JSON.stringify(result, null, 2)], {
					type: "application/json",
				});
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = `audit-export-${result.manifest.generatedAt}.json`;
				link.click();
				URL.revokeObjectURL(url);
				void exportsQuery.refetch();
				toast.success("Audit export generated");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const detailQuery = useQuery({
		...trpc.audit.get.queryOptions({ id: selectedId ?? "" }),
		enabled: Boolean(selectedId),
	});
	const logs = auditQuery.data?.logs ?? [];
	const selected = detailQuery.data;
	const rangeInput = {
		...filters,
		limit: 500,
	};

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
					<div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_160px_160px]">
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
						<Input
							aria-label="From date"
							type="date"
							value={from}
							onChange={(event) => setFrom(event.target.value)}
						/>
						<Input
							aria-label="To date"
							type="date"
							value={to}
							onChange={(event) => setTo(event.target.value)}
						/>
					</div>

					{(canVerify || canExport) && (
						<div className="flex flex-wrap gap-2">
							{canVerify && (
								<Button
									type="button"
									variant="outline"
									disabled={verifyRange.isPending}
									onClick={() => verifyRange.mutate(rangeInput)}
								>
									<ShieldCheck className="size-4" />
									Verify current range
								</Button>
							)}
							{canExport && (
								<Button
									type="button"
									variant="outline"
									disabled={exportJson.isPending}
									onClick={() => exportJson.mutate(rangeInput)}
								>
									<Download className="size-4" />
									Export JSON
								</Button>
							)}
						</div>
					)}

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

			{canExport && (
				<Card>
					<CardHeader>
						<CardTitle>Export history</CardTitle>
						<CardDescription>
							Recent bounded JSON exports with manifest hashes for evidence
							tracking.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Generated</TableHead>
										<TableHead>Rows</TableHead>
										<TableHead>Sequence range</TableHead>
										<TableHead>Manifest hash</TableHead>
										<TableHead>Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{(exportsQuery.data ?? []).map((item) => (
										<TableRow key={item.id}>
											<TableCell className="whitespace-nowrap text-sm">
												{formatTimestamp(item.createdAt)}
											</TableCell>
											<TableCell>{item.rowCount}</TableCell>
											<TableCell>
												{item.fromSequence ?? "—"} → {item.toSequence ?? "—"}
											</TableCell>
											<TableCell className="max-w-xs truncate font-mono text-xs">
												{item.manifestHash ?? "—"}
											</TableCell>
											<TableCell>
												<Badge variant="outline">{item.status}</Badge>
											</TableCell>
										</TableRow>
									))}
									{!exportsQuery.isPending &&
										(exportsQuery.data ?? []).length === 0 && (
											<TableRow>
												<TableCell colSpan={5}>
													<div className="py-8 text-center text-muted-foreground text-sm">
														No audit exports have been generated yet.
													</div>
												</TableCell>
											</TableRow>
										)}
								</TableBody>
							</Table>
						</div>
					</CardContent>
				</Card>
			)}

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
