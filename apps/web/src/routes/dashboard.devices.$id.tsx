import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import {
	Dialog,
	DialogCloseButton,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogPopup,
	DialogPortal,
	DialogTitle,
} from "@whatsapp-flow/ui/components/dialog";
import { Input } from "@whatsapp-flow/ui/components/input";
import { Separator } from "@whatsapp-flow/ui/components/separator";
import { Skeleton } from "@whatsapp-flow/ui/components/skeleton";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	ArrowLeft,
	LogOut,
	Power,
	PowerOff,
	QrCode,
	Smartphone,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/devices/$id")({
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
			if (data.type === "qr") setQrCode(data.qr);
			if (data.type === "status") {
				setStatus(data.status);
				onStatusChange?.();
			}
		});

		es.onerror = () => es.close();

		return () => es.close();
	}, [deviceId, onStatusChange, open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogPopup>
					<DialogCloseButton />
					<DialogHeader>
						<DialogTitle>Connect WhatsApp</DialogTitle>
						<DialogDescription>
							Scan the QR code or request a pairing code with your country-code
							phone number.
						</DialogDescription>
					</DialogHeader>
					<DialogContent>
						<div className="grid gap-4 md:grid-cols-[16rem_1fr]">
							<div className="flex flex-col items-center gap-3">
								{qrCode ? (
									<img
										src={qrCode}
										alt="WhatsApp QR Code"
										className="size-64"
									/>
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
									Use WhatsApp Linked Devices, choose link with phone number,
									then enter this code.
								</p>
							</div>
						</div>
					</DialogContent>
				</DialogPopup>
			</DialogPortal>
		</Dialog>
	);
}

function DeviceDetailPage() {
	const { id } = Route.useParams();
	const trpc = useTRPC();
	const { data: devices, refetch } = useSuspenseQuery(
		trpc.device.list.queryOptions(),
	);
	const device = devices.find((d) => d.id === id);

	const [qrOpen, setQrOpen] = useState(false);

	const connectMut = useMutation(
		trpc.device.connect.mutationOptions({
			onSuccess: () => {
				refetch();
				setQrOpen(true);
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

	if (!device) {
		return (
			<div className="flex flex-col items-center gap-3 py-12">
				<Smartphone className="size-10 text-muted-foreground/50" />
				<p className="text-muted-foreground text-sm">Device not found</p>
				<Link
					to="/dashboard/devices"
					className="text-primary text-xs hover:underline"
				>
					Back to devices
				</Link>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<Link
					to="/dashboard/devices"
					className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
				>
					<ArrowLeft className="size-3.5" />
					Devices
				</Link>
			</div>

			<div className="flex items-start justify-between">
				<div className="flex items-center gap-3">
					<div className="flex size-10 items-center justify-center border bg-muted">
						<Smartphone className="size-5 text-muted-foreground" />
					</div>
					<div>
						<h2 className="font-semibold text-lg">{device.name}</h2>
						<p className="text-muted-foreground text-xs">
							{device.phoneNumber ?? "No phone number"}
						</p>
					</div>
				</div>
				<DeviceStatusBadge status={device.status} />
			</div>

			<div className="flex items-center gap-2">
				{device.status === "disconnected" && (
					<>
						<Button
							size="sm"
							className="h-7 text-xs"
							onClick={() => connectMut.mutate({ id })}
							disabled={connectMut.isPending}
						>
							<Power className="size-3.5" />
							Connect
						</Button>
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-xs"
							onClick={() => {
								connectMut.mutate({ id });
								setQrOpen(true);
							}}
						>
							<QrCode className="size-3.5" />
							QR Code
						</Button>
					</>
				)}
				{device.status !== "disconnected" && (
					<>
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-xs"
							onClick={() => disconnectMut.mutate({ id })}
							disabled={disconnectMut.isPending}
						>
							<PowerOff className="size-3.5" />
							Disconnect
						</Button>
						{device.status === "connecting" && (
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs"
								onClick={() => setQrOpen(true)}
							>
								<QrCode className="size-3.5" />
								Show QR
							</Button>
						)}
					</>
				)}
				<Button
					size="sm"
					variant="outline"
					className="h-7 text-destructive text-xs"
					onClick={() => logoutMut.mutate({ id })}
					disabled={logoutMut.isPending}
				>
					<LogOut className="size-3.5" />
					Reset session
				</Button>
			</div>

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
							<dt className="text-muted-foreground">Phone</dt>
							<dd>{device.phoneNumber ?? "—"}</dd>
						</div>
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

			{qrOpen && (
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
