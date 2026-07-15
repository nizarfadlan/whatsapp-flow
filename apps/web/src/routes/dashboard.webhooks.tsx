import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import { Checkbox } from "@whatsapp-flow/ui/components/checkbox";
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
import {
	Edit3,
	Globe,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Trash2,
	Webhook as WebhookIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/webhooks")({
	component: WebhooksPage,
});

const webhookEventOptions = [
	{
		value: "message.received",
		label: "Message received",
		description: "Incoming WhatsApp messages from selected devices.",
	},
	{
		value: "device.status_changed",
		label: "Device status changed",
		description: "Connect, disconnect, and status changes.",
	},
	{
		value: "flow.execution.started",
		label: "Flow execution started",
		description: "A flow starts processing a contact.",
	},
	{
		value: "flow.execution.completed",
		label: "Flow execution completed",
		description: "A flow finishes successfully.",
	},
	{
		value: "flow.execution.failed",
		label: "Flow execution failed",
		description: "A flow execution fails.",
	},
	{
		value: "flow.session.waiting",
		label: "Flow session waiting",
		description: "A flow waits for a user reply.",
	},
	{
		value: "flow.session.resumed",
		label: "Flow session resumed",
		description: "A waiting flow resumes after a reply.",
	},
	{
		value: "flow.session.expired",
		label: "Flow session expired",
		description: "A waiting session expires.",
	},
] as const;

type WebhookEvent = (typeof webhookEventOptions)[number]["value"];
type WebhookEventSelection = "*" | WebhookEvent;

type WebhookFormState = {
	id: string | null;
	name: string;
	url: string;
	isActive: boolean;
	subscribedEvents: WebhookEventSelection[];
	deviceIds: string[];
	flowIds: string[];
};

const emptyForm: WebhookFormState = {
	id: null,
	name: "",
	url: "",
	isActive: true,
	subscribedEvents: ["*"],
	deviceIds: [],
	flowIds: [],
};

const eventValues = new Set<string>(
	webhookEventOptions.map((option) => option.value),
);
const eventLabels = Object.fromEntries(
	webhookEventOptions.map((option) => [option.value, option.label]),
) as Record<WebhookEvent, string>;

function getStringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function normalizeEventSelection(value: unknown): WebhookEventSelection[] {
	const events = getStringArray(value);
	if (events.length === 0 || events.includes("*")) return ["*"];
	const valid = events.filter((event): event is WebhookEvent =>
		eventValues.has(event),
	);
	return valid.length > 0 ? valid : ["*"];
}

function summarizeEvents(value: unknown) {
	const events = normalizeEventSelection(value);
	if (events.includes("*")) return "All events";
	if (events.length === 1) return eventLabels[events[0] as WebhookEvent];
	return `${events.length} events`;
}

function summarizeSelection(
	ids: string[],
	labels: Map<string, string>,
	allLabel: string,
) {
	if (ids.length === 0) return allLabel;
	if (ids.length === 1) return labels.get(ids[0] ?? "") ?? ids[0];
	return `${ids.length} selected`;
}

function WebhooksPage() {
	const trpc = useTRPC();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [form, setForm] = useState<WebhookFormState>(emptyForm);

	const { data: webhooks = [], refetch } = useSuspenseQuery(
		trpc.webhook.listEndpoints.queryOptions(),
	);
	const { data: devices = [] } = useSuspenseQuery(
		trpc.device.list.queryOptions(),
	);
	const { data: flows = [] } = useSuspenseQuery(trpc.flow.list.queryOptions());

	const deviceLabels = useMemo(
		() =>
			new Map(
				devices.map((device) => [
					device.id,
					device.phoneNumber
						? `${device.name} · ${device.phoneNumber}`
						: device.name,
				]),
			),
		[devices],
	);
	const flowLabels = useMemo(
		() => new Map(flows.map((flow) => [flow.id, flow.name])),
		[flows],
	);

	const resetForm = () => setForm(emptyForm);
	const openCreateDialog = () => {
		resetForm();
		setDialogOpen(true);
	};
	const openEditDialog = (row: (typeof webhooks)[0]) => {
		setForm({
			id: row.id,
			name: row.name,
			url: row.url,
			isActive: row.isActive,
			subscribedEvents: normalizeEventSelection(row.subscribedEvents),
			deviceIds: getStringArray(row.deviceIds),
			flowIds: getStringArray(row.flowIds),
		});
		setDialogOpen(true);
	};

	const createMut = useMutation(
		trpc.webhook.createEndpoint.mutationOptions({
			onSuccess: () => {
				setDialogOpen(false);
				resetForm();
				toast.success("Webhook saved. Start listening to events!");
				refetch();
			},
			onError: (e) => toast.error(e.message ?? "Failed to add webhook"),
		}),
	);

	const updateMut = useMutation(
		trpc.webhook.updateEndpoint.mutationOptions({
			onSuccess: () => {
				setDialogOpen(false);
				resetForm();
				toast.success("Webhook updated");
				refetch();
			},
			onError: (e) => toast.error(e.message ?? "Failed to update webhook"),
		}),
	);

	const deleteMut = useMutation(
		trpc.webhook.deleteEndpoint.mutationOptions({
			onSuccess: () => {
				toast.success("Webhook deleted");
				refetch();
			},
			onError: (e) => toast.error(e.message ?? "Failed to delete webhook"),
		}),
	);

	const rollSecretMut = useMutation(
		trpc.webhook.regenerateSecret.mutationOptions({
			onSuccess: (data) => {
				toast.success("Secret regenerated!");
				refetch();
				alert(
					`New secret generated:\n\n${data.secret}\n\nPlease update your server config.`,
				);
			},
			onError: (e) => toast.error(e.message ?? "Failed to regenerate secret"),
		}),
	);

	const isSaving = createMut.isPending || updateMut.isPending;
	const canSave = !!form.url.trim() && form.subscribedEvents.length > 0;

	const toggleEvent = (value: WebhookEvent) => {
		setForm((current) => {
			const selected = current.subscribedEvents.includes(value);
			const next = selected
				? current.subscribedEvents.filter(
						(event) => event !== value && event !== "*",
					)
				: [...current.subscribedEvents.filter((event) => event !== "*"), value];
			return { ...current, subscribedEvents: next };
		});
	};

	const toggleId = (field: "deviceIds" | "flowIds", id: string) => {
		setForm((current) => {
			const selected = current[field].includes(id);
			return {
				...current,
				[field]: selected
					? current[field].filter((item) => item !== id)
					: [...current[field], id],
			};
		});
	};

	const saveWebhook = () => {
		const payload = {
			name: form.name.trim() || `Endpoint ${webhooks.length + 1}`,
			url: form.url.trim(),
			isActive: form.isActive,
			subscribedEvents: form.subscribedEvents,
			deviceIds: form.deviceIds,
			flowIds: form.flowIds,
		};

		if (form.id) {
			updateMut.mutate({ id: form.id, ...payload });
			return;
		}

		createMut.mutate(payload);
	};

	const columns = [
		{
			key: "name",
			header: "Name",
			cell: (row: (typeof webhooks)[0]) => (
				<span className="cursor-pointer truncate font-medium text-foreground text-xs underline decoration-border decoration-dotted underline-offset-4">
					{row.name}
				</span>
			),
		},
		{
			key: "url",
			header: "Target URL",
			cell: (row: (typeof webhooks)[0]) => (
				<span className="block max-w-xs truncate font-mono text-xs">
					{row.url}
				</span>
			),
		},
		{
			key: "events",
			header: "Events",
			cell: (row: (typeof webhooks)[0]) => (
				<Badge variant="outline" className="h-4 px-1 text-[9px]">
					{summarizeEvents(row.subscribedEvents)}
				</Badge>
			),
		},
		{
			key: "devices",
			header: "Devices",
			cell: (row: (typeof webhooks)[0]) => (
				<Badge variant="outline" className="h-4 gap-1 px-1 text-[9px]">
					<Globe className="mr-0.5 h-2.5 w-2.5 text-muted-foreground" />
					{summarizeSelection(
						getStringArray(row.deviceIds),
						deviceLabels,
						"All devices",
					)}
				</Badge>
			),
		},
		{
			key: "flows",
			header: "Flows",
			cell: (row: (typeof webhooks)[0]) => (
				<Badge variant="outline" className="h-4 px-1 text-[9px]">
					{summarizeSelection(
						getStringArray(row.flowIds),
						flowLabels,
						"All flows",
					)}
				</Badge>
			),
		},
		{
			key: "isActive",
			header: "Status",
			cell: (row: (typeof webhooks)[0]) => (
				<Badge
					variant={row.isActive ? "default" : "secondary"}
					className="h-4 px-1 text-[9px]"
				>
					{row.isActive ? "Active" : "Disabled"}
				</Badge>
			),
		},
		{
			key: "actions",
			header: "",
			cell: (row: (typeof webhooks)[0]) => (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="ghost" size="icon-xs" className="size-6" />
						}
					>
						<MoreHorizontal className="size-3.5" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => openEditDialog(row)}>
							<Edit3 className="mr-2 size-3.5" />
							Edit
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => rollSecretMut.mutate({ id: row.id })}
						>
							<RefreshCw className="mr-2 size-3.5" />
							Roll Secret
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-destructive"
							onClick={() => {
								if (
									confirm(
										"Are you sure you want to delete this webhook endpoint?",
									)
								) {
									deleteMut.mutate({ id: row.id });
								}
							}}
						>
							<Trash2 className="mr-2 size-3.5" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	];

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-base">Outbound Webhooks</h1>
					<p className="text-muted-foreground text-xs">
						{webhooks.length} endpoints · Send WhatsApp and flow events directly
						to your backend
					</p>
				</div>
				<Dialog
					open={dialogOpen}
					onOpenChange={(open) => {
						setDialogOpen(open);
						if (!open) resetForm();
					}}
				>
					<DialogTrigger
						render={<Button size="sm" className="h-7 gap-1.5 text-xs" />}
						onClick={openCreateDialog}
					>
						<Plus className="size-3.5" />
						New Endpoint
					</DialogTrigger>
					<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
						<DialogHeader>
							<DialogTitle>
								{form.id ? "Edit Webhook" : "Create Webhook"}
							</DialogTitle>
							<DialogDescription>
								Configure an HTTP or HTTPS endpoint and choose which devices,
								events, and flows should deliver POST requests.
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-4">
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="flex flex-col gap-1">
									<label className="font-medium text-xs" htmlFor="wh-name">
										Endpoint Name
									</label>
									<Input
										id="wh-name"
										placeholder="Production Backend"
										value={form.name}
										onChange={(e) =>
											setForm((current) => ({
												...current,
												name: e.target.value,
											}))
										}
									/>
								</div>
								<div className="flex flex-col gap-1">
									<label className="font-medium text-xs" htmlFor="wh-url">
										Payload URL *
									</label>
									<Input
										id="wh-url"
										placeholder="https://api.yourdomain.com/webhook/wa"
										value={form.url}
										onChange={(e) =>
											setForm((current) => ({
												...current,
												url: e.target.value,
											}))
										}
									/>
								</div>
							</div>

							<div className="flex items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs">
								<Checkbox
									checked={form.isActive}
									onCheckedChange={(checked) =>
										setForm((current) => ({
											...current,
											isActive: checked === true,
										}))
									}
								/>
								<span>Endpoint is active</span>
							</div>

							<div className="space-y-2">
								<div>
									<p className="font-medium text-xs">Events</p>
									<p className="text-[10px] text-muted-foreground">
										Choose which event types this endpoint receives.
									</p>
								</div>
								<div className="grid gap-2 rounded-md border p-2 sm:grid-cols-2">
									<div className="flex items-start gap-2 rounded-md p-1.5 text-xs hover:bg-muted/50">
										<Checkbox
											aria-label="All events"
											checked={form.subscribedEvents.includes("*")}
											onCheckedChange={(checked) =>
												setForm((current) => ({
													...current,
													subscribedEvents: checked === true ? ["*"] : [],
												}))
											}
										/>
										<span>
											<span className="block font-medium">All events</span>
											<span className="text-[10px] text-muted-foreground">
												Receive every supported webhook event.
											</span>
										</span>
									</div>
									{webhookEventOptions.map((option) => (
										<div
											key={option.value}
											className="flex items-start gap-2 rounded-md p-1.5 text-xs hover:bg-muted/50"
										>
											<Checkbox
												aria-label={option.label}
												checked={form.subscribedEvents.includes(option.value)}
												onCheckedChange={() => toggleEvent(option.value)}
											/>
											<span>
												<span className="block font-medium">
													{option.label}
												</span>
												<span className="text-[10px] text-muted-foreground">
													{option.description}
												</span>
											</span>
										</div>
									))}
								</div>
							</div>

							<div className="grid gap-4 sm:grid-cols-2">
								<div className="space-y-2">
									<div>
										<p className="font-medium text-xs">Devices</p>
										<p className="text-[10px] text-muted-foreground">
											No selection means all devices.
										</p>
									</div>
									<div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
										{devices.length === 0 ? (
											<p className="p-2 text-muted-foreground text-xs">
												No devices yet.
											</p>
										) : (
											devices.map((device) => (
												<div
													key={device.id}
													className="flex items-start gap-2 rounded-md p-1.5 text-xs hover:bg-muted/50"
												>
													<Checkbox
														aria-label={`Select device ${device.name}`}
														checked={form.deviceIds.includes(device.id)}
														onCheckedChange={() =>
															toggleId("deviceIds", device.id)
														}
													/>
													<span className="min-w-0">
														<span className="block truncate font-medium">
															{device.name}
														</span>
														<span className="block truncate text-[10px] text-muted-foreground">
															{device.phoneNumber ?? device.status}
														</span>
													</span>
												</div>
											))
										)}
									</div>
								</div>

								<div className="space-y-2">
									<div>
										<p className="font-medium text-xs">Flows</p>
										<p className="text-[10px] text-muted-foreground">
											No selection means all flows. Flow selection only applies
											to flow events.
										</p>
									</div>
									<div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
										{flows.length === 0 ? (
											<p className="p-2 text-muted-foreground text-xs">
												No flows yet.
											</p>
										) : (
											flows.map((flow) => (
												<div
													key={flow.id}
													className="flex items-start gap-2 rounded-md p-1.5 text-xs hover:bg-muted/50"
												>
													<Checkbox
														aria-label={`Select flow ${flow.name}`}
														checked={form.flowIds.includes(flow.id)}
														onCheckedChange={() => toggleId("flowIds", flow.id)}
													/>
													<span className="min-w-0">
														<span className="block truncate font-medium">
															{flow.name}
														</span>
														<span className="block truncate text-[10px] text-muted-foreground">
															{flow.deviceName ?? flow.status}
														</span>
													</span>
												</div>
											))
										)}
									</div>
								</div>
							</div>

							<div className="mt-1 rounded-md border bg-muted/20 p-2">
								<p className="text-[10px] text-muted-foreground leading-relaxed">
									Requests are secured using an HMAC-SHA256 signature generated
									with a unique secret. Delivery uses exponential backoff and
									fails after maximum retries.
								</p>
							</div>
						</div>
						<DialogFooter>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setDialogOpen(false)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								disabled={!canSave || isSaving}
								onClick={saveWebhook}
							>
								{isSaving
									? "Saving..."
									: form.id
										? "Save changes"
										: "Create Webhook"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			{webhooks.length === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/10 py-16 text-muted-foreground">
					<WebhookIcon className="size-8 opacity-30" />
					<div className="text-center">
						<p className="mb-1 font-medium text-foreground/80 text-sm">
							Listen to events
						</p>
						<p className="mx-auto max-w-sm text-xs">
							Webhooks are HTTP endpoints that receive events when things
							happen, like incoming messages, device changes, or flow lifecycle
							updates.
						</p>
					</div>
					<Button
						size="sm"
						variant="secondary"
						className="mt-2 text-xs"
						onClick={openCreateDialog}
					>
						Add your first URL
					</Button>
				</div>
			) : (
				<div className="max-w-full overflow-x-auto rounded-md border text-sm">
					<DataTable
						data={webhooks}
						columns={columns}
						getRowKey={(row) => row.id}
					/>
				</div>
			)}
		</div>
	);
}
