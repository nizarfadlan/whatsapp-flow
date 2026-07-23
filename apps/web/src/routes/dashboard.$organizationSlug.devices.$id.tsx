import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button, buttonVariants } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
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
import { Separator } from "@whatsapp-flow/ui/components/separator";
import { Skeleton } from "@whatsapp-flow/ui/components/skeleton";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	AlertTriangle,
	ArrowLeft,
	Cloud,
	LoaderCircle,
	LogOut,
	Power,
	PowerOff,
	QrCode,
	RefreshCw,
	Settings,
	ShieldCheck,
	Smartphone,
	UserMinus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useActiveOrganization } from "@/components/active-organization";
import { MetaDeviceConfigDialog } from "@/components/meta-device-config-dialog";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute(
	"/dashboard/$organizationSlug/devices/$id",
)({
	component: DeviceDetailPage,
});

const statusColors: Record<string, string> = {
	connected: "bg-green-500",
	connecting: "bg-yellow-500",
	disconnected: "bg-gray-400",
	banned: "bg-red-500",
};

const statusVariants: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	connected: "default",
	connecting: "secondary",
	disconnected: "secondary",
	banned: "destructive",
};

function DeviceStatusBadge({ status }: { status: string }) {
	return (
		<Badge variant={statusVariants[status] ?? "secondary"}>
			<span
				className={cn(
					"mr-1.5 inline-block size-1.5 rounded-full",
					statusColors[status] ?? "bg-gray-400",
				)}
			/>
			{status}
		</Badge>
	);
}

function ProviderBadge({ provider }: { provider?: string }) {
	return provider === "meta_cloud" ? (
		<Badge variant="secondary" className="gap-1 text-xs">
			<Cloud className="size-3" />
			Meta Cloud
		</Badge>
	) : (
		<Badge variant="outline" className="gap-1 text-xs">
			<Smartphone className="size-3" />
			Baileys
		</Badge>
	);
}

function formatDate(value: string | Date | null) {
	return value ? new Date(value).toLocaleString() : "—";
}

function getMetaWarnings(device: {
	provider?: string;
	status: string;
	lastWebhookAt?: Date | string | null;
	lastError?: string | null;
}) {
	if (device.provider !== "meta_cloud") return [];
	return [
		device.status === "disconnected" ? "Validation needed" : null,
		!device.lastWebhookAt ? "No webhook received yet" : null,
		device.lastError ? `Last error: ${device.lastError}` : null,
	].filter(Boolean) as string[];
}

const activeSyncStatuses = new Set(["queued", "running"]);

function SyncStatusBadge({ status }: { status: string }) {
	const variant =
		status === "succeeded"
			? "default"
			: status === "failed"
				? "destructive"
				: "secondary";
	return <Badge variant={variant}>{status}</Badge>;
}

function syncRunSummary(status: string) {
	switch (status) {
		case "queued":
			return "Queued";
		case "running":
			return "In progress (indeterminate)";
		case "succeeded":
			return "Completed";
		case "partial":
			return "Completed with errors";
		case "failed":
			return "Failed";
		case "cancelled":
			return "Cancelled";
		default:
			return status;
	}
}

function ResourceSyncCard({ deviceId }: { deviceId: string }) {
	const organization = useActiveOrganization();
	const trpc = useTRPC();
	const syncStatus = useQuery({
		...trpc.device.syncStatus.queryOptions({
			id: deviceId,
			tenantId: organization.id,
			limit: 12,
		}),
		refetchInterval: (query) =>
			query.state.data?.some((run) => activeSyncStatuses.has(run.status))
				? 3_000
				: 15_000,
	});
	const startSync = useMutation(
		trpc.device.startSync.mutationOptions({
			onSuccess: () => {
				toast.success("Resource sync queued");
				syncStatus.refetch();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const queueSync = (
		resource: "contacts" | "groups" | "newsletters" | "all",
		mode: "normal" | "repair" = "normal",
	) =>
		startSync.mutate({
			id: deviceId,
			resource,
			mode,
			tenantId: organization.id,
		});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">Resource synchronization</CardTitle>
				<p className="text-muted-foreground text-xs">
					Queue a durable sync for resources already available to this linked
					device. Discovery is not authoritative for every contact or
					newsletter.
				</p>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						disabled={startSync.isPending}
						onClick={() => queueSync("all")}
					>
						<RefreshCw className="size-3.5" />
						Sync All
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={startSync.isPending}
						onClick={() => queueSync("contacts")}
					>
						Contacts
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={startSync.isPending}
						onClick={() => queueSync("groups")}
					>
						Groups
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={startSync.isPending}
						onClick={() => queueSync("newsletters")}
					>
						Newsletters
					</Button>
				</div>

				<div className="rounded-md border border-amber-200 bg-amber-50 p-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<p className="font-medium text-amber-950 text-xs">
								Repair Contacts
							</p>
							<p className="mt-1 text-amber-900 text-xs">
								Triggers an app-state resync before refreshing contacts.
							</p>
						</div>
						<Button
							size="sm"
							variant="outline"
							className="border-amber-300 bg-background text-amber-950 hover:bg-amber-100"
							disabled={startSync.isPending}
							onClick={() => queueSync("contacts", "repair")}
						>
							Repair Contacts
						</Button>
					</div>
				</div>

				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<p className="font-medium text-xs">Recent durable runs</p>
						{syncStatus.isFetching && (
							<LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
						)}
					</div>
					{syncStatus.data?.length === 0 && (
						<p className="text-muted-foreground text-xs">No sync runs yet.</p>
					)}
					{syncStatus.data?.map((run) => {
						return (
							<div key={run.id} className="rounded-md border p-3 text-xs">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="flex items-center gap-2">
										{run.status === "running" && (
											<LoaderCircle className="size-3.5 animate-spin" />
										)}
										<p className="font-medium">
											{run.resource} · {run.scopeKey === "all" ? "all" : "one"}
											{run.mode === "repair" ? " · repair" : ""}
										</p>
										<SyncStatusBadge status={run.status} />
									</div>
									<p className="text-muted-foreground">
										{syncRunSummary(run.status)}
									</p>
								</div>
								<p className="mt-2 text-muted-foreground">
									Processed {run.processedCount} · Created {run.createdCount} ·
									Updated {run.updatedCount} · Skipped {run.skippedCount} ·
									Failed {run.failedCount}
								</p>
								<p className="mt-1 text-muted-foreground">
									Queued {formatDate(run.createdAt)} · Started{" "}
									{formatDate(run.startedAt)} · Finished{" "}
									{formatDate(run.completedAt)}
								</p>
								{run.lastError && (
									<p className="mt-1 text-destructive">
										Last error: {run.lastError}
									</p>
								)}
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}

function DeviceDeploymentAccessCard({
	deviceId,
	tenantId,
	ownerUserId,
}: {
	deviceId: string;
	tenantId: string;
	ownerUserId: string;
}) {
	const trpc = useTRPC();
	const members = useQuery(trpc.tenant.listMembers.queryOptions({ tenantId }));
	const grants = useQuery(
		trpc.tenant.listDeviceGrants.queryOptions({ tenantId, deviceId }),
	);
	const grantAccess = useMutation(
		trpc.tenant.grantDeviceAccess.mutationOptions({
			onSuccess: () => {
				toast.success("Deployment access granted");
				grants.refetch();
			},
			onError: (error) =>
				toast.error(error.message || "Failed to grant access"),
		}),
	);
	const revokeAccess = useMutation(
		trpc.tenant.revokeDeviceAccess.mutationOptions({
			onSuccess: () => {
				toast.success("Deployment access revoked");
				grants.refetch();
			},
			onError: (error) => {
				grants.refetch();
				toast.error(
					error.message ||
						"The deployment grant could not be revoked. Refresh and try again.",
				);
			},
		}),
	);
	const grantedUserIds = new Set(grants.data?.map((grant) => grant.userId));
	const eligibleMembers = members.data?.filter(
		(member) => member.id !== ownerUserId,
	);
	const isPending = grantAccess.isPending || revokeAccess.isPending;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<ShieldCheck className="size-4" />
					<CardTitle className="text-sm">Deployment access</CardTitle>
				</div>
				<p className="text-muted-foreground text-xs">
					Grant active tenant members permission to deploy flows to this
					connection. They cannot view, configure, or manage this device.
				</p>
			</CardHeader>
			<CardContent className="space-y-2">
				{members.isLoading || grants.isLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground text-xs">
						<LoaderCircle className="size-3.5 animate-spin" />
						Loading members and deployment grants…
					</div>
				) : eligibleMembers && eligibleMembers.length > 0 ? (
					eligibleMembers.map((member) => {
						const hasGrant = grantedUserIds.has(member.id);
						return (
							<div
								key={member.id}
								className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
							>
								<div className="min-w-0">
									<p className="truncate font-medium text-sm">
										{member.name || member.email}
									</p>
									<p className="truncate text-muted-foreground text-xs">
										{member.email}
										{member.role === "owner" ? " · Tenant owner" : ""}
									</p>
								</div>
								{hasGrant ? (
									<Button
										type="button"
										size="sm"
										variant="outline"
										className="text-destructive"
										disabled={isPending}
										onClick={() =>
											revokeAccess.mutate({
												tenantId,
												deviceId,
												userId: member.id,
											})
										}
									>
										<UserMinus className="size-3.5" />
										Revoke deploy
									</Button>
								) : (
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={isPending}
										onClick={() =>
											grantAccess.mutate({
												tenantId,
												deviceId,
												userId: member.id,
											})
										}
									>
										Grant deploy
									</Button>
								)}
							</div>
						);
					})
				) : (
					<p className="text-muted-foreground text-xs">
						No active tenant members are eligible for deployment access.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function QrModal({
	deviceId,
	open,
	onOpenChange,
	onStatusChange,
}: {
	deviceId: string;
	open: boolean;
	onOpenChange: (v: boolean) => void;
	onStatusChange?: () => void;
}) {
	const organization = useActiveOrganization();
	const trpc = useTRPC();
	const [qrCode, setQrCode] = useState<string | null>(null);
	const [status, setStatus] = useState<string>("connecting");
	const [phoneNumber, setPhoneNumber] = useState("");
	const [pairingCode, setPairingCode] = useState<string | null>(null);
	const eventSourceRef = useRef<EventSource | null>(null);

	const pairingCodeMut = useMutation(
		trpc.device.requestPairingCode.mutationOptions({
			onSuccess: ({ code }) => setPairingCode(code),
			onError: () => toast.error("Failed to request pairing code"),
		}),
	);

	useEffect(() => {
		if (!open) {
			eventSourceRef.current?.close();
			return;
		}

		const es = new EventSource(
			`${import.meta.env.VITE_SERVER_URL}/api/devices/${deviceId}/events?tenantId=${encodeURIComponent(organization.id)}`,
			{ withCredentials: true },
		);
		eventSourceRef.current = es;

		es.addEventListener("message", (e) => {
			const data = JSON.parse(e.data);
			if (data.type === "qr") setQrCode(data.qr);
			if (data.type === "status") {
				setStatus(data.status);
				onStatusChange?.();
			}
		});

		es.onerror = () => es.close();

		return () => es.close();
	}, [deviceId, onStatusChange, open, organization.id]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Connect WhatsApp</DialogTitle>
					<DialogDescription>
						Scan the QR code or request a pairing code with your country-code
						phone number.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 md:grid-cols-[16rem_1fr]">
					<div className="flex flex-col items-center gap-3">
						{qrCode ? (
							<img src={qrCode} alt="WhatsApp QR Code" className="size-64" />
						) : (
							<Skeleton className="size-64" />
						)}
						<DeviceStatusBadge status={status} />
					</div>
					<div className="flex flex-col gap-2">
						<p className="font-medium text-sm">Pairing code</p>
						<Input
							placeholder="6281234567890"
							value={phoneNumber}
							onChange={(e) => setPhoneNumber(e.target.value)}
						/>
						<Button
							size="sm"
							disabled={
								phoneNumber.trim().length < 6 || pairingCodeMut.isPending
							}
							onClick={() =>
								pairingCodeMut.mutate({
									id: deviceId,
									tenantId: organization.id,
									phoneNumber,
								})
							}
						>
							{pairingCodeMut.isPending ? "Requesting..." : "Get code"}
						</Button>
						{pairingCode && (
							<div className="rounded-md border bg-muted px-3 py-2 text-center font-mono text-lg tracking-widest">
								{pairingCode}
							</div>
						)}
						<p className="text-muted-foreground text-xs">
							Use WhatsApp Linked Devices, choose link with phone number, then
							enter this code.
						</p>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function DeviceDetailPage() {
	const organization = useActiveOrganization();
	const { id } = Route.useParams();
	const trpc = useTRPC();
	const { data: devices, refetch } = useSuspenseQuery(
		trpc.device.list.queryOptions({ tenantId: organization.id }),
	);
	const device = devices.find((d) => d.id === id);

	const [qrOpen, setQrOpen] = useState(false);
	const [configureOpen, setConfigureOpen] = useState(false);

	const connectMut = useMutation(
		trpc.device.connect.mutationOptions({
			onSuccess: () => {
				refetch();
				toast.success("Connecting...");
			},
		}),
	);

	const disconnectMut = useMutation(
		trpc.device.disconnect.mutationOptions({
			onSuccess: () => {
				refetch();
				toast.success("Disconnected");
			},
		}),
	);

	const logoutMut = useMutation(
		trpc.device.logout.mutationOptions({
			onSuccess: () => {
				refetch();
				toast.success("Logged out");
			},
		}),
	);

	if (!device?.isOwner) {
		return (
			<div className="flex flex-col items-center gap-3 py-12">
				<Smartphone className="size-10 text-muted-foreground/50" />
				<p className="text-muted-foreground text-sm">Device not found</p>
				<Link
					to="/dashboard/$organizationSlug/devices"
					params={{ organizationSlug: organization.slug }}
					className="text-primary text-xs hover:underline"
				>
					Back to devices
				</Link>
			</div>
		);
	}

	const isMeta = device.provider === "meta_cloud";
	const metaWarnings = getMetaWarnings(device);
	const handleConnect = () => {
		connectMut.mutate({ id, tenantId: organization.id });
		if (!isMeta) setQrOpen(true);
	};

	return (
		<div className="space-y-4">
			<Link
				to="/dashboard/$organizationSlug/devices"
				params={{ organizationSlug: organization.slug }}
				className={cn(
					buttonVariants({ variant: "ghost", size: "sm" }),
					"w-fit",
				)}
			>
				<ArrowLeft className="size-3.5" />
				Devices
			</Link>

			<div className="flex items-start justify-between">
				<div className="flex items-center gap-3">
					<div className="flex size-10 items-center justify-center border bg-muted">
						{isMeta ? (
							<Cloud className="size-5 text-muted-foreground" />
						) : (
							<Smartphone className="size-5 text-muted-foreground" />
						)}
					</div>
					<div>
						<h2 className="font-semibold text-lg">{device.name}</h2>
						<p className="text-muted-foreground text-xs">
							{device.displayPhoneNumber ??
								device.phoneNumber ??
								"No phone number"}
						</p>
						<div className="mt-1">
							<ProviderBadge provider={device.provider} />
						</div>
					</div>
				</div>
				<DeviceStatusBadge status={device.status} />
			</div>

			{metaWarnings.length > 0 && (
				<div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-xs">
					{metaWarnings.map((warning) => (
						<p key={warning} className="flex items-center gap-2">
							<AlertTriangle className="size-3.5" />
							{warning}
						</p>
					))}
				</div>
			)}

			<div className="flex items-center gap-2">
				{device.status === "disconnected" && (
					<Button
						size="sm"
						className="h-7 text-xs"
						onClick={handleConnect}
						disabled={connectMut.isPending}
					>
						{isMeta ? (
							<Settings className="size-3.5" />
						) : (
							<Power className="size-3.5" />
						)}
						{isMeta ? "Validate credentials" : "Connect"}
					</Button>
				)}
				{device.status !== "disconnected" && (
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-xs"
						onClick={() =>
							disconnectMut.mutate({ id, tenantId: organization.id })
						}
						disabled={disconnectMut.isPending}
					>
						<PowerOff className="size-3.5" />
						Disconnect
					</Button>
				)}
				{isMeta ? (
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-xs"
						onClick={() => setConfigureOpen(true)}
					>
						<Settings className="size-3.5" />
						Configure
					</Button>
				) : (
					device.status === "connecting" && (
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-xs"
							onClick={() => setQrOpen(true)}
						>
							<QrCode className="size-3.5" />
							Show QR
						</Button>
					)
				)}
				<Button
					size="sm"
					variant="outline"
					className="h-7 text-destructive text-xs"
					onClick={() => logoutMut.mutate({ id, tenantId: organization.id })}
					disabled={logoutMut.isPending}
				>
					<LogOut className="size-3.5" />
					{isMeta ? "Remove credentials" : "Reset session"}
				</Button>
			</div>

			{!isMeta && device.status === "connected" && (
				<ResourceSyncCard deviceId={id} />
			)}

			<DeviceDeploymentAccessCard
				deviceId={device.id}
				tenantId={device.tenantId}
				ownerUserId={device.ownerUserId}
			/>

			<Separator />

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Device Info</CardTitle>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-2 text-xs">
						<div className="flex justify-between">
							<dt className="text-muted-foreground">ID</dt>
							<dd className="font-mono">{device.id}</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-muted-foreground">Provider</dt>
							<dd>
								<ProviderBadge provider={device.provider} />
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-muted-foreground">Phone</dt>
							<dd>{device.displayPhoneNumber ?? device.phoneNumber ?? "—"}</dd>
						</div>
						{isMeta && (
							<>
								<div className="flex justify-between gap-4">
									<dt className="text-muted-foreground">Phone Number ID</dt>
									<dd className="font-mono">{device.externalId ?? "—"}</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-muted-foreground">WABA ID</dt>
									<dd className="font-mono">
										{device.businessAccountId ?? "—"}
									</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-muted-foreground">Last connected</dt>
									<dd>{formatDate(device.lastConnectedAt)}</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-muted-foreground">Last webhook</dt>
									<dd>{formatDate(device.lastWebhookAt)}</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-muted-foreground">Status reason</dt>
									<dd>{device.statusReason ?? "—"}</dd>
								</div>
								<div className="flex justify-between gap-4">
									<dt className="text-muted-foreground">Last error</dt>
									<dd className="max-w-lg text-right text-destructive">
										{device.lastError ?? "—"}
									</dd>
								</div>
							</>
						)}
						<div className="flex justify-between">
							<dt className="text-muted-foreground">Status</dt>
							<dd>
								<DeviceStatusBadge status={device.status} />
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-muted-foreground">Added</dt>
							<dd>{new Date(device.createdAt).toLocaleString()}</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-muted-foreground">Updated</dt>
							<dd>{new Date(device.updatedAt).toLocaleString()}</dd>
						</div>
					</dl>
				</CardContent>
			</Card>

			<MetaDeviceConfigDialog
				deviceId={isMeta ? id : null}
				open={configureOpen}
				onOpenChange={setConfigureOpen}
				onSaved={() => refetch()}
			/>

			{!isMeta && qrOpen && (
				<QrModal
					deviceId={id}
					open={qrOpen}
					onOpenChange={(v) => {
						if (!v) setQrOpen(false);
					}}
					onStatusChange={() => refetch()}
				/>
			)}
		</div>
	);
}
