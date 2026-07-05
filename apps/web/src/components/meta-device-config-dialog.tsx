import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@whatsapp-flow/ui/components/dialog";
import { Input } from "@whatsapp-flow/ui/components/input";
import { Label } from "@whatsapp-flow/ui/components/label";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";

type MetaTokenMetadata = {
	source?: string | null;
	type?: string | null;
	receivedAt?: string | null;
	expiresAt?: string | null;
	lastValidatedAt?: string | null;
};

export type MetaConfigFormState = {
	phoneNumberId: string;
	businessAccountId: string;
	displayPhoneNumber: string;
	graphApiVersion: string;
	accessToken: string;
	appSecret: string;
};

export const initialMetaConfigFormState: MetaConfigFormState = {
	phoneNumberId: "",
	businessAccountId: "",
	displayPhoneNumber: "",
	graphApiVersion: "v23.0",
	accessToken: "",
	appSecret: "",
};

export function toMetaConfigPayload(form: MetaConfigFormState) {
	return {
		phoneNumberId: form.phoneNumberId.trim(),
		businessAccountId: form.businessAccountId.trim() || undefined,
		displayPhoneNumber: form.displayPhoneNumber.trim() || undefined,
		accessToken: form.accessToken.trim() || undefined,
		appSecret: form.appSecret.trim() || undefined,
		graphApiVersion: form.graphApiVersion.trim() || undefined,
	};
}

function formatMetaTokenDate(value?: string | null) {
	return value ? new Date(value).toLocaleString() : "—";
}

function MetaTokenInfo({
	label,
	value,
}: {
	label: string;
	value?: string | null;
}) {
	return (
		<div className="min-w-0">
			<p className="text-muted-foreground uppercase tracking-wide">{label}</p>
			<p className="truncate font-medium">{value || "—"}</p>
		</div>
	);
}

export function MetaConfigFields({
	form,
	onChange,
	mode,
	hasAccessToken,
	hasAppSecret,
	tokenMetadata,
}: {
	form: MetaConfigFormState;
	onChange: (form: MetaConfigFormState) => void;
	mode: "create" | "edit";
	hasAccessToken?: boolean;
	hasAppSecret?: boolean;
	tokenMetadata?: MetaTokenMetadata | null;
}) {
	const webhookUrl = `${import.meta.env.VITE_SERVER_URL}/api/whatsapp/meta/webhook`;
	const update = (patch: Partial<MetaConfigFormState>) =>
		onChange({ ...form, ...patch });

	return (
		<div className="space-y-4 rounded-lg border bg-muted/30 p-3">
			<div className="space-y-1 text-xs">
				<p className="font-medium">Webhook callback URL</p>
				<p className="break-all font-mono text-muted-foreground">
					{webhookUrl}
				</p>
				<p className="text-muted-foreground">
					Use the server{" "}
					<span className="font-mono">META_WEBHOOK_VERIFY_TOKEN</span> as the
					Meta verify token.
				</p>
			</div>

			{mode === "edit" && (
				<div className="space-y-2 text-xs">
					<div className="flex flex-wrap gap-2">
						<Badge variant={hasAccessToken ? "secondary" : "destructive"}>
							{hasAccessToken ? "Access token saved" : "Access token missing"}
						</Badge>
						<Badge variant={hasAppSecret ? "secondary" : "outline"}>
							{hasAppSecret ? "App secret saved" : "Using server app secret"}
						</Badge>
					</div>
					{tokenMetadata && (
						<div className="grid gap-1 rounded-md border bg-background p-2 text-[10px] md:grid-cols-2">
							<MetaTokenInfo
								label="Token source"
								value={tokenMetadata.source}
							/>
							<MetaTokenInfo label="Token type" value={tokenMetadata.type} />
							<MetaTokenInfo
								label="Received"
								value={formatMetaTokenDate(tokenMetadata.receivedAt)}
							/>
							<MetaTokenInfo
								label="Expires"
								value={formatMetaTokenDate(tokenMetadata.expiresAt)}
							/>
							<MetaTokenInfo
								label="Last validated"
								value={formatMetaTokenDate(tokenMetadata.lastValidatedAt)}
							/>
						</div>
					)}
				</div>
			)}

			<div className="grid gap-3 md:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="meta-phone-number-id">Phone Number ID</Label>
					<Input
						id="meta-phone-number-id"
						value={form.phoneNumberId}
						onChange={(e) => update({ phoneNumberId: e.target.value })}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="meta-business-account-id">WABA ID</Label>
					<Input
						id="meta-business-account-id"
						value={form.businessAccountId}
						onChange={(e) => update({ businessAccountId: e.target.value })}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="meta-display-phone-number">Display phone</Label>
					<Input
						id="meta-display-phone-number"
						value={form.displayPhoneNumber}
						onChange={(e) => update({ displayPhoneNumber: e.target.value })}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="meta-graph-api-version">Graph API version</Label>
					<Input
						id="meta-graph-api-version"
						value={form.graphApiVersion}
						onChange={(e) => update({ graphApiVersion: e.target.value })}
					/>
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor="meta-access-token">Access token</Label>
				<Input
					id="meta-access-token"
					type="password"
					placeholder={
						mode === "edit" ? "Leave blank to keep existing token" : undefined
					}
					value={form.accessToken}
					onChange={(e) => update({ accessToken: e.target.value })}
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="meta-app-secret">App secret</Label>
				<Input
					id="meta-app-secret"
					type="password"
					placeholder={
						mode === "edit" ? "Leave blank to keep existing secret" : undefined
					}
					value={form.appSecret}
					onChange={(e) => update({ appSecret: e.target.value })}
				/>
				<p className="text-muted-foreground text-xs">
					Leave blank only when the server has a global Meta app secret or an
					existing secret is already saved.
				</p>
			</div>
		</div>
	);
}

export function MetaDeviceConfigDialog({
	deviceId,
	open,
	onOpenChange,
	onSaved,
}: {
	deviceId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}) {
	const trpc = useTRPC();
	const [form, setForm] = useState(initialMetaConfigFormState);
	const config = useQuery({
		...trpc.device.getMetaConfig.queryOptions({ id: deviceId ?? "" }),
		enabled: open && Boolean(deviceId),
	});
	const configure = useMutation(
		trpc.device.configureMeta.mutationOptions({
			onSuccess: () => {
				toast.success("Meta configuration updated");
				onSaved();
				onOpenChange(false);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	useEffect(() => {
		if (!open) {
			setForm(initialMetaConfigFormState);
			return;
		}
		if (!config.data) return;

		setForm({
			phoneNumberId: config.data.phoneNumberId ?? "",
			businessAccountId: config.data.businessAccountId ?? "",
			displayPhoneNumber: config.data.displayPhoneNumber ?? "",
			graphApiVersion:
				getGraphApiVersion(config.data.providerConfig) ?? "v23.0",
			accessToken: "",
			appSecret: "",
		});
	}, [config.data, open]);

	const canSubmit = Boolean(
		deviceId &&
			form.phoneNumberId.trim() &&
			(form.accessToken.trim() || config.data?.hasAccessToken),
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Configure Meta Cloud API</DialogTitle>
					<DialogDescription>
						Update the safe Meta connection fields. Secret fields stay blank
						unless you want to rotate them.
					</DialogDescription>
				</DialogHeader>

				<MetaConfigFields
					form={form}
					onChange={setForm}
					mode="edit"
					hasAccessToken={config.data?.hasAccessToken}
					hasAppSecret={config.data?.hasAppSecret}
					tokenMetadata={config.data?.tokenMetadata}
				/>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={!canSubmit || configure.isPending || config.isLoading}
						onClick={() => {
							if (!deviceId) return;
							configure.mutate({ id: deviceId, ...toMetaConfigPayload(form) });
						}}
					>
						{configure.isPending ? "Saving..." : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function getGraphApiVersion(value: unknown) {
	if (!value || typeof value !== "object") return null;
	const graphApiVersion = (value as { graphApiVersion?: unknown })
		.graphApiVersion;
	return typeof graphApiVersion === "string" ? graphApiVersion : null;
}
