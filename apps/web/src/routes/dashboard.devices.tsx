import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
import { Label } from "@whatsapp-flow/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@whatsapp-flow/ui/components/native-select";
import { Skeleton } from "@whatsapp-flow/ui/components/skeleton";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	AlertTriangle,
	Cloud,
	LogOut,
	MoreHorizontal,
	Plus,
	Power,
	PowerOff,
	QrCode,
	RefreshCw,
	Settings,
	Smartphone,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import {
	initialMetaConfigFormState,
	MetaConfigFields,
	MetaDeviceConfigDialog,
	toMetaConfigPayload,
} from "@/components/meta-device-config-dialog";
import { useDeviceStatusSSE } from "@/hooks/use-device-status-sse";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/devices")({
	component: DevicesPage,
});

type FacebookLoginResponse = {
	authResponse?: { code?: string; state?: string };
	status?: string;
};

type PendingEmbeddedSignupAuth = {
	code: string;
	state: string;
};

type FacebookSdk = {
	init: (options: {
		appId: string;
		version: string;
		xfbml?: boolean;
		cookie?: boolean;
	}) => void;
	login: (
		callback: (response: FacebookLoginResponse) => void,
		options: Record<string, unknown>,
	) => void;
};

type MetaEmbeddedSignupSelection = {
	phoneNumberId?: string;
	businessAccountId?: string;
};

declare global {
	interface Window {
		FB?: FacebookSdk;
		fbAsyncInit?: () => void;
	}
}

const statusColors: Record<string, string> = {
	connected: "bg-green-500",
	connecting: "bg-yellow-500",
	disconnected: "bg-gray-400",
	banned: "bg-red-500",
};

function DeviceStatusBadge({ status }: { status: string }) {
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

function getMetaWarnings(device: {
	provider?: string;
	status: string;
	lastWebhookAt?: Date | string | null;
	lastError?: string | null;
}) {
	if (device.provider !== "meta_cloud") return [];
	return [
		device.status === "disconnected" ? "Validation needed" : null,
		!device.lastWebhookAt ? "No webhook received" : null,
		device.lastError ? "Last error present" : null,
	].filter(Boolean) as string[];
}

function parseEmbeddedSignupSelection(
	value: unknown,
): MetaEmbeddedSignupSelection {
	if (!value || typeof value !== "object") return {};
	const record = value as Record<string, unknown>;
	const phoneNumberId = firstString(
		record.phone_number_id,
		record.phoneNumberId,
		nestedString(record.phone_number, "id"),
		nestedString(record.phoneNumber, "id"),
	);
	const businessAccountId = firstString(
		record.waba_id,
		record.wabaId,
		record.business_account_id,
		record.businessAccountId,
		nestedString(record.business, "id"),
	);
	return { phoneNumberId, businessAccountId };
}

function firstString(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function nestedString(value: unknown, key: string) {
	if (!value || typeof value !== "object") return undefined;
	const nested = (value as Record<string, unknown>)[key];
	return typeof nested === "string" ? nested : undefined;
}

function safeJsonParse(value: string) {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

function isTrustedFacebookOrigin(origin: string) {
	try {
		const hostname = new URL(origin).hostname;
		return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
	} catch {
		return false;
	}
}

function loadFacebookSdk(appId: string, graphApiVersion: string) {
	if (window.FB) return Promise.resolve(window.FB);

	return new Promise<FacebookSdk>((resolve, reject) => {
		const existing = document.getElementById("facebook-jssdk");
		const timeout = window.setTimeout(
			() => reject(new Error("Facebook SDK failed to load")),
			15_000,
		);

		window.fbAsyncInit = () => {
			if (!window.FB) {
				window.clearTimeout(timeout);
				reject(new Error("Facebook SDK is unavailable"));
				return;
			}
			window.FB.init({
				appId,
				version: graphApiVersion,
				cookie: true,
				xfbml: false,
			});
			window.clearTimeout(timeout);
			resolve(window.FB);
		};

		if (existing) return;

		const script = document.createElement("script");
		script.id = "facebook-jssdk";
		script.async = true;
		script.defer = true;
		script.crossOrigin = "anonymous";
		script.src = "https://connect.facebook.net/en_US/sdk.js";
		script.onerror = () => {
			window.clearTimeout(timeout);
			reject(new Error("Facebook SDK failed to load"));
		};
		document.body.appendChild(script);
	});
}

function AddDeviceDialog({ onAdded }: { onAdded: () => void }) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [provider, setProvider] = useState<"baileys" | "meta_cloud">("baileys");
	const [name, setName] = useState("");
	const [metaForm, setMetaForm] = useState(initialMetaConfigFormState);
	const [embeddedSelection, setEmbeddedSelection] =
		useState<MetaEmbeddedSignupSelection>({});
	const embeddedSelectionRef = useRef<MetaEmbeddedSignupSelection>({});
	const pendingEmbeddedAuthRef = useRef<PendingEmbeddedSignupAuth | null>(null);
	const pendingEmbeddedTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		if (!open || provider !== "meta_cloud") return;
		const handleMessage = (event: MessageEvent) => {
			if (!isTrustedFacebookOrigin(event.origin)) return;
			const payload =
				typeof event.data === "string" ? safeJsonParse(event.data) : event.data;
			const data =
				payload && typeof payload === "object"
					? ((payload as Record<string, unknown>).data ?? payload)
					: payload;
			const selection = parseEmbeddedSignupSelection(data);
			if (selection.phoneNumberId || selection.businessAccountId) {
				embeddedSelectionRef.current = selection;
				setEmbeddedSelection(selection);
			}
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [open, provider]);

	const reset = () => {
		setProvider("baileys");
		setName("");
		setMetaForm(initialMetaConfigFormState);
		embeddedSelectionRef.current = {};
		setEmbeddedSelection({});
		pendingEmbeddedAuthRef.current = null;
		if (pendingEmbeddedTimeoutRef.current) {
			window.clearTimeout(pendingEmbeddedTimeoutRef.current);
			pendingEmbeddedTimeoutRef.current = null;
		}
	};

	const handleOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) reset();
	};

	const create = useMutation(
		trpc.device.create.mutationOptions({
			onSuccess: () => {
				toast.success("Device added");
				reset();
				setOpen(false);
				onAdded();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const createMeta = useMutation(
		trpc.device.createMeta.mutationOptions({
			onSuccess: () => {
				toast.success("Meta WhatsApp connection added");
				reset();
				setOpen(false);
				onAdded();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const createMetaEmbedded = useMutation(
		trpc.device.createMetaEmbedded.mutationOptions({
			onSuccess: () => {
				toast.success("Meta WhatsApp connection added");
				reset();
				setOpen(false);
				onAdded();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const embeddedSignupConfig = useQuery({
		...trpc.device.getMetaEmbeddedSignupConfig.queryOptions(),
		enabled: open && provider === "meta_cloud",
	});

	const isMeta = provider === "meta_cloud";
	const canSubmit =
		name.trim() &&
		(!isMeta || (metaForm.phoneNumberId.trim() && metaForm.accessToken.trim()));
	const isPending =
		create.isPending || createMeta.isPending || createMetaEmbedded.isPending;
	const embeddedSignupConfigured = Boolean(
		embeddedSignupConfig.data?.configured,
	);

	const submitEmbeddedSignup = useCallback(
		(auth: PendingEmbeddedSignupAuth) => {
			const selection = embeddedSelectionRef.current;
			const phoneNumberId =
				selection.phoneNumberId ?? metaForm.phoneNumberId.trim();
			if (!phoneNumberId) return false;

			const businessAccountId =
				selection.businessAccountId ?? metaForm.businessAccountId.trim();
			createMetaEmbedded.mutate({
				name: name.trim(),
				code: auth.code,
				state: auth.state,
				phoneNumberId,
				businessAccountId: businessAccountId || undefined,
				displayPhoneNumber: metaForm.displayPhoneNumber.trim() || undefined,
				graphApiVersion: metaForm.graphApiVersion.trim() || undefined,
			});
			return true;
		},
		[createMetaEmbedded, metaForm, name],
	);

	const startEmbeddedSignup = async () => {
		const config = embeddedSignupConfig.data;
		if (!name.trim()) {
			toast.error("Name is required");
			return;
		}
		if (!config?.configured || !config.appId || !config.configId) {
			toast.error("Meta Embedded Signup is not configured");
			return;
		}

		try {
			const fb = await loadFacebookSdk(config.appId, config.graphApiVersion);
			fb.login(
				(response) => {
					const code = response.authResponse?.code;
					if (!code) {
						toast.error("Meta Embedded Signup did not return an auth code");
						return;
					}

					const returnedState = response.authResponse?.state;
					if (!returnedState || returnedState !== config.state) {
						toast.error("Meta Embedded Signup state mismatch");
						return;
					}

					const auth = { code, state: returnedState };
					if (submitEmbeddedSignup(auth)) return;

					pendingEmbeddedAuthRef.current = auth;
					if (pendingEmbeddedTimeoutRef.current) {
						window.clearTimeout(pendingEmbeddedTimeoutRef.current);
					}
					pendingEmbeddedTimeoutRef.current = window.setTimeout(() => {
						pendingEmbeddedAuthRef.current = null;
						pendingEmbeddedTimeoutRef.current = null;
						toast.error(
							"Meta Embedded Signup did not return a phone number ID",
						);
					}, 5000);
				},
				{
					config_id: config.configId,
					response_type: "code",
					override_default_response_type: true,
					state: config.state,
					extras: {
						feature: "whatsapp_embedded_signup",
						sessionInfoVersion: "3",
					},
				},
			);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to start Meta Embedded Signup",
			);
		}
	};

	useEffect(() => {
		const pendingAuth = pendingEmbeddedAuthRef.current;
		if (!pendingAuth || !embeddedSelection.phoneNumberId) return;
		pendingEmbeddedAuthRef.current = null;
		if (pendingEmbeddedTimeoutRef.current) {
			window.clearTimeout(pendingEmbeddedTimeoutRef.current);
			pendingEmbeddedTimeoutRef.current = null;
		}
		submitEmbeddedSignup(pendingAuth);
	}, [embeddedSelection, submitEmbeddedSignup]);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger className={cn(buttonVariants({ size: "sm" }), "text-xs")}>
				<Plus className="size-3.5" />
				Add Connection
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Add WhatsApp connection</DialogTitle>
					<DialogDescription>
						Choose unofficial linked-device access or the official Meta Cloud
						API.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="provider">Provider</Label>
						<NativeSelect
							id="provider"
							className="w-full"
							value={provider}
							onChange={(event) =>
								setProvider(event.target.value as "baileys" | "meta_cloud")
							}
						>
							<NativeSelectOption value="baileys">
								WhatsApp Web / Baileys
							</NativeSelectOption>
							<NativeSelectOption value="meta_cloud">
								Official Meta Cloud API
							</NativeSelectOption>
						</NativeSelect>
					</div>
					<div className="space-y-2">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							placeholder={isMeta ? "Business WhatsApp" : "My Phone"}
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					{isMeta && (
						<div className="space-y-3">
							<div className="rounded-lg border bg-muted/30 p-3">
								<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
									<div className="space-y-1">
										<p className="font-medium text-sm">Connect with Meta</p>
										<p className="text-muted-foreground text-xs">
											Recommended for production. Manual setup remains available
											below.
										</p>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={
											!embeddedSignupConfigured ||
											embeddedSignupConfig.isLoading ||
											createMetaEmbedded.isPending
										}
										onClick={startEmbeddedSignup}
									>
										<Cloud className="size-3.5" />
										Connect with Meta
									</Button>
								</div>
								{!embeddedSignupConfigured && (
									<p className="mt-2 text-muted-foreground text-xs">
										Set META_APP_ID, META_APP_SECRET, and
										META_EMBEDDED_SIGNUP_CONFIG_ID on the server to enable this
										path.
									</p>
								)}
							</div>
							<MetaConfigFields
								form={metaForm}
								onChange={setMetaForm}
								mode="create"
							/>
						</div>
					)}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={!canSubmit || isPending}
						onClick={() => {
							if (isMeta) {
								createMeta.mutate({
									name: name.trim(),
									...toMetaConfigPayload(metaForm),
								});
								return;
							}
							create.mutate({ name: name.trim(), provider });
						}}
					>
						{isPending ? "Creating..." : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
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
			`${import.meta.env.VITE_SERVER_URL}/api/devices/${deviceId}/events`,
			{ withCredentials: true },
		);
		eventSourceRef.current = es;

		es.addEventListener("message", (e) => {
			const data = JSON.parse(e.data);
			if (data.type === "qr") {
				setQrCode(data.qr);
			}
			if (data.type === "status") {
				setStatus(data.status);
				if (data.phoneNumber) setPhoneNumber(data.phoneNumber);
				onStatusChange?.();
			}
		});

		es.onerror = () => {
			es.close();
		};

		return () => es.close();
	}, [deviceId, onStatusChange, open]);

	useEffect(() => {
		if (status === "connected") {
			toast.success(
				phoneNumber
					? `WhatsApp connected (${phoneNumber})`
					: "WhatsApp connected",
			);
			onStatusChange?.();
			onOpenChange(false);
		}
	}, [status, phoneNumber, onOpenChange, onStatusChange]);

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
						<p className="font-medium text-xs">Pairing code</p>
						<Input
							placeholder="6281234567890"
							value={phoneNumber}
							onChange={(e) => setPhoneNumber(e.target.value)}
						/>
						<Button
							size="sm"
							className="h-8 text-xs"
							disabled={
								phoneNumber.trim().length < 6 || pairingCodeMut.isPending
							}
							onClick={() =>
								pairingCodeMut.mutate({
									id: deviceId,
									phoneNumber,
								})
							}
						>
							{pairingCodeMut.isPending ? "Requesting..." : "Get code"}
						</Button>
						{pairingCode && (
							<div className="border bg-muted px-3 py-2 text-center font-mono text-lg tracking-widest">
								{pairingCode}
							</div>
						)}
						<p className="text-[10px] text-muted-foreground">
							Use WhatsApp Linked Devices, choose link with phone number, then
							enter this code.
						</p>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function DevicesPage() {
	const trpc = useTRPC();
	const { data: devices, refetch } = useSuspenseQuery(
		trpc.device.list.queryOptions(),
	);
	const [qrDeviceId, setQrDeviceId] = useState<string | null>(null);
	const [editingMetaDeviceId, setEditingMetaDeviceId] = useState<string | null>(
		null,
	);
	useDeviceStatusSSE();

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
				toast.success("Session reset");
			},
		}),
	);

	const deleteMut = useMutation(
		trpc.device.delete.mutationOptions({
			onSuccess: () => {
				refetch();
				toast.success("Device deleted");
			},
		}),
	);
	const syncAllMut = useMutation(
		trpc.device.startSync.mutationOptions({
			onSuccess: () => toast.success("Resource sync queued"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const handleConnect = (deviceId: string, provider?: string) => {
		connectMut.mutate({ id: deviceId });
		if (provider !== "meta_cloud") setQrDeviceId(deviceId);
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">
					Manage your WhatsApp devices
				</p>
				<AddDeviceDialog onAdded={() => refetch()} />
			</div>

			<Card>
				<CardContent className="p-0">
					{devices.length === 0 ? (
						<div className="flex flex-col items-center gap-3 py-12">
							<Smartphone className="size-10 text-muted-foreground/50" />
							<p className="text-muted-foreground text-sm">No devices yet</p>
							<AddDeviceDialog onAdded={() => refetch()} />
						</div>
					) : (
						<DataTable
							data={devices}
							getRowKey={(device) => device.id}
							columns={[
								{
									key: "name",
									header: "Name",
									className: "font-medium",
									cell: (d) => d.name,
								},
								{
									key: "provider",
									header: "Provider",
									cell: (d) => <ProviderBadge provider={d.provider} />,
								},
								{
									key: "phone",
									header: "Phone",
									className: "text-muted-foreground",
									cell: (d) => d.displayPhoneNumber ?? d.phoneNumber ?? "—",
								},
								{
									key: "status",
									header: "Status",
									cell: (d) => {
										const warnings = getMetaWarnings(d);
										return (
											<div className="space-y-1">
												<DeviceStatusBadge status={d.status} />
												{warnings.map((warning) => (
													<p
														key={warning}
														className="flex items-center gap-1 text-[10px] text-amber-600"
													>
														<AlertTriangle className="size-3" />
														{warning}
													</p>
												))}
											</div>
										);
									},
								},
								{
									key: "added",
									header: "Added",
									className: "text-muted-foreground",
									cell: (d) => new Date(d.createdAt).toLocaleDateString(),
								},
								{
									key: "actions",
									header: null,
									headClassName: "w-10",
									className: "w-10",
									cell: (d) => (
										<DropdownMenu>
											<DropdownMenuTrigger
												render={<Button variant="ghost" size="icon-sm" />}
											>
												<MoreHorizontal className="size-4" />
											</DropdownMenuTrigger>
											<DropdownMenuContent>
												{d.provider !== "meta_cloud" &&
													d.status === "connected" && (
														<DropdownMenuItem
															disabled={syncAllMut.isPending}
															onClick={() =>
																syncAllMut.mutate({
																	id: d.id,
																	resource: "all",
																	mode: "normal",
																})
															}
														>
															<RefreshCw className="size-3.5" />
															Sync All
														</DropdownMenuItem>
													)}
												{d.status === "disconnected" && (
													<DropdownMenuItem
														onClick={() => handleConnect(d.id, d.provider)}
													>
														{d.provider === "meta_cloud" ? (
															<Settings className="size-3.5" />
														) : (
															<Power className="size-3.5" />
														)}
														{d.provider === "meta_cloud"
															? "Validate"
															: "Connect"}
													</DropdownMenuItem>
												)}
												{d.status !== "disconnected" && (
													<DropdownMenuItem
														onClick={() => disconnectMut.mutate({ id: d.id })}
													>
														<PowerOff className="size-3.5" />
														Disconnect
													</DropdownMenuItem>
												)}
												{d.status === "connecting" &&
													d.provider !== "meta_cloud" && (
														<DropdownMenuItem
															onClick={() => setQrDeviceId(d.id)}
														>
															<QrCode className="size-3.5" />
															Show QR
														</DropdownMenuItem>
													)}
												{d.provider === "meta_cloud" && (
													<DropdownMenuItem
														onClick={() => setEditingMetaDeviceId(d.id)}
													>
														<Settings className="size-3.5" />
														Configure
													</DropdownMenuItem>
												)}
												<DropdownMenuItem
													variant="destructive"
													onClick={() => logoutMut.mutate({ id: d.id })}
												>
													<LogOut className="size-3.5" />
													{d.provider === "meta_cloud"
														? "Remove credentials"
														: "Reset session"}
												</DropdownMenuItem>
												<DropdownMenuItem
													variant="destructive"
													onClick={() => deleteMut.mutate({ id: d.id })}
												>
													<Trash2 className="size-3.5" />
													Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									),
								},
							]}
						/>
					)}
				</CardContent>
			</Card>

			<MetaDeviceConfigDialog
				deviceId={editingMetaDeviceId}
				open={Boolean(editingMetaDeviceId)}
				onOpenChange={(v) => {
					if (!v) setEditingMetaDeviceId(null);
				}}
				onSaved={() => refetch()}
			/>

			{qrDeviceId && (
				<QrModal
					deviceId={qrDeviceId}
					open
					onOpenChange={(v) => {
						if (!v) setQrDeviceId(null);
					}}
					onStatusChange={() => refetch()}
				/>
			)}
		</div>
	);
}
