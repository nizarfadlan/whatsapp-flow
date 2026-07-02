import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
import { Skeleton } from "@whatsapp-flow/ui/components/skeleton";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	LogOut,
	MoreHorizontal,
	Plus,
	Power,
	PowerOff,
	QrCode,
	Smartphone,
	Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { useDeviceStatusSSE } from "@/hooks/use-device-status-sse";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/devices")({
	component: DevicesPage,
});

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

function AddDeviceDialog({ onAdded }: { onAdded: () => void }) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");

	const create = useMutation(
		trpc.device.create.mutationOptions({
			onSuccess: () => {
				setName("");
				setOpen(false);
				onAdded();
				toast.success("Device added");
			},
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger className={cn(buttonVariants({ size: "sm" }), "text-xs")}>
				<Plus className="size-3.5" />
				Add Device
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Device</DialogTitle>
					<DialogDescription>
						Give your WhatsApp device a name to identify it.
					</DialogDescription>
				</DialogHeader>
				<Input
					placeholder="My Phone"
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

	const handleConnect = (deviceId: string) => {
		connectMut.mutate({ id: deviceId });
		setQrDeviceId(deviceId);
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
									key: "phone",
									header: "Phone",
									className: "text-muted-foreground",
									cell: (d) => d.phoneNumber ?? "—",
								},
								{
									key: "status",
									header: "Status",
									cell: (d) => <DeviceStatusBadge status={d.status} />,
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
												{d.status === "disconnected" && (
													<DropdownMenuItem onClick={() => handleConnect(d.id)}>
														<Power className="size-3.5" />
														Connect
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
												{d.status === "connecting" && (
													<DropdownMenuItem onClick={() => setQrDeviceId(d.id)}>
														<QrCode className="size-3.5" />
														Show QR
													</DropdownMenuItem>
												)}
												<DropdownMenuItem
													variant="destructive"
													onClick={() => logoutMut.mutate({ id: d.id })}
												>
													<LogOut className="size-3.5" />
													Reset session
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
