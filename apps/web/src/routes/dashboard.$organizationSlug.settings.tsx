import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@whatsapp-flow/env/web";
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
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import { ColorPicker } from "@whatsapp-flow/ui/components/color-picker";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@whatsapp-flow/ui/components/sheet";
import { Switch } from "@whatsapp-flow/ui/components/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@whatsapp-flow/ui/components/table";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@whatsapp-flow/ui/components/tabs";
import {
	Bot,
	Edit3,
	KeyRound,
	Mail,
	MoreHorizontal,
	Plus,
	Save,
	ShieldAlert,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { MediaUpload } from "@/components/media-upload";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/$organizationSlug/settings")({
	component: SettingsPage,
});

type ProviderType = "social" | "oidc";
type ProviderTab = "oauth" | "oidc";
const oauthProviderIds = [
	"google",
	"github",
	"discord",
	"facebook",
	"microsoft",
	"gitlab",
	"slack",
	"linkedin",
	"notion",
] as const;
type OAuthProviderId = (typeof oauthProviderIds)[number];

const THE_SVG_CDN =
	"https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons";
const theSvgDefaults: Record<
	OAuthProviderId,
	{ slug: string; variant: string }
> = {
	google: { slug: "google", variant: "color.svg" },
	github: { slug: "github", variant: "dark.svg" },
	discord: { slug: "discord", variant: "default.svg" },
	facebook: { slug: "facebook", variant: "default.svg" },
	microsoft: { slug: "microsoft", variant: "color.svg" },
	gitlab: { slug: "gitlab", variant: "default.svg" },
	slack: { slug: "slack", variant: "default.svg" },
	linkedin: { slug: "linkedin", variant: "default.svg" },
	notion: { slug: "notion", variant: "default.svg" },
};

function defaultProviderIconUrl(providerId: string) {
	if (!isOAuthProviderId(providerId)) return null;
	const icon = theSvgDefaults[providerId];
	return `${THE_SVG_CDN}/${icon.slug}/${icon.variant}`;
}

type BrandingForm = {
	appName: string;
	appTagline: string;
	logoUrl: string;
	faviconUrl: string;
	primaryColor: string;
	supportEmail: string;
};

type SmtpForm = {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	password: string;
	clearPassword: boolean;
	fromAddress: string;
	testTo: string;
};

type ProviderForm = {
	type: ProviderType;
	providerId: string;
	displayName: string;
	iconUrl: string;
	enabled: boolean;
	clientId: string;
	clientSecret: string;
	discoveryUrl: string;
	issuerUrl: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	userinfoEndpoint: string;
	jwksEndpoint: string;
	scopes: string;
	allowSignUp: boolean;
	overrideUserInfoOnSignIn: boolean;
	sortOrder: number;
};

const emptyBrandingForm: BrandingForm = {
	appName: "WhatsApp Flow",
	appTagline: "Automation builder",
	logoUrl: "",
	faviconUrl: "",
	primaryColor: "",
	supportEmail: "",
};

const emptySmtpForm: SmtpForm = {
	host: "",
	port: 587,
	secure: false,
	user: "",
	password: "",
	clearPassword: false,
	fromAddress: "",
	testTo: "",
};

const defaultProviderForms: Record<OAuthProviderId, ProviderForm> = {
	google: oauthProviderForm("google", "Google", "openid, email, profile", 0),
	github: oauthProviderForm("github", "GitHub", "user:email", 1),
	discord: oauthProviderForm("discord", "Discord", "identify, email", 2),
	facebook: oauthProviderForm(
		"facebook",
		"Facebook",
		"email, public_profile",
		3,
	),
	microsoft: oauthProviderForm(
		"microsoft",
		"Microsoft",
		"openid, email, profile",
		4,
	),
	gitlab: oauthProviderForm("gitlab", "GitLab", "read_user", 5),
	slack: oauthProviderForm("slack", "Slack", "openid, email, profile", 6),
	linkedin: oauthProviderForm(
		"linkedin",
		"LinkedIn",
		"openid, profile, email",
		7,
	),
	notion: oauthProviderForm("notion", "Notion", "", 8),
};

function oauthProviderForm(
	providerId: OAuthProviderId,
	displayName: string,
	scopes: string,
	sortOrder: number,
): ProviderForm {
	return {
		type: "social",
		providerId,
		displayName,
		iconUrl: "",
		enabled: false,
		clientId: "",
		clientSecret: "",
		discoveryUrl: "",
		issuerUrl: "",
		authorizationEndpoint: "",
		tokenEndpoint: "",
		userinfoEndpoint: "",
		jwksEndpoint: "",
		scopes,
		allowSignUp: true,
		overrideUserInfoOnSignIn: false,
		sortOrder,
	};
}

function oidcProviderForm(
	providerId: string,
	displayName: string,
	sortOrder: number,
): ProviderForm {
	return {
		type: "oidc",
		providerId,
		displayName,
		iconUrl: "",
		enabled: false,
		clientId: "",
		clientSecret: "",
		discoveryUrl: "",
		issuerUrl: "",
		authorizationEndpoint: "",
		tokenEndpoint: "",
		userinfoEndpoint: "",
		jwksEndpoint: "",
		scopes: "openid, email, profile",
		allowSignUp: true,
		overrideUserInfoOnSignIn: false,
		sortOrder,
	};
}

function isOAuthProviderId(providerId: string): providerId is OAuthProviderId {
	return oauthProviderIds.includes(providerId as OAuthProviderId);
}

function providerToForm(
	provider: {
		providerId: string;
		type: "social" | "oidc" | "sso";
		displayName: string;
		iconUrl: string | null;
		customIconUrl: string | null;
		enabled: boolean;
		clientId: string;
		discoveryUrl: string | null;
		issuerUrl: string | null;
		authorizationEndpoint: string | null;
		tokenEndpoint: string | null;
		userinfoEndpoint: string | null;
		jwksEndpoint: string | null;
		scopes: string[];
		allowSignUp: boolean;
		overrideUserInfoOnSignIn: boolean;
		sortOrder: number;
	} | null,
	providerId: string,
): ProviderForm {
	if (!provider) {
		return isOAuthProviderId(providerId)
			? defaultProviderForms[providerId]
			: oidcProviderForm(providerId, "OIDC Connection", 10);
	}

	const fallback = isOAuthProviderId(provider.providerId)
		? defaultProviderForms[provider.providerId]
		: oidcProviderForm(
				provider.providerId,
				provider.displayName,
				provider.sortOrder,
			);

	return {
		...fallback,
		type: provider.type === "oidc" ? "oidc" : "social",
		providerId: provider.providerId,
		displayName: provider.displayName,
		iconUrl: provider.customIconUrl ?? "",
		enabled: provider.enabled,
		clientId: provider.clientId,
		clientSecret: "",
		discoveryUrl: provider.discoveryUrl ?? "",
		issuerUrl: provider.issuerUrl ?? "",
		authorizationEndpoint: provider.authorizationEndpoint ?? "",
		tokenEndpoint: provider.tokenEndpoint ?? "",
		userinfoEndpoint: provider.userinfoEndpoint ?? "",
		jwksEndpoint: provider.jwksEndpoint ?? "",
		scopes: provider.scopes.join(", "),
		allowSignUp: provider.allowSignUp,
		overrideUserInfoOnSignIn: provider.overrideUserInfoOnSignIn,
		sortOrder: provider.sortOrder,
	};
}

function splitScopes(value: string) {
	return value
		.split(",")
		.map((scope) => scope.trim())
		.filter(Boolean);
}

function providerCallbackUrl(form: ProviderForm) {
	if (!form.providerId) return "Create an OIDC connection first";
	return form.type === "oidc"
		? `/api/auth/oauth2/callback/${form.providerId}`
		: `/api/auth/callback/${form.providerId}`;
}

function providerTypeLabel(type: string) {
	return type === "oidc" ? "OIDC" : "OAuth";
}

function providerStatusLabel(
	provider: { enabled: boolean } | undefined,
	configured: boolean,
) {
	if (!configured) return "Not configured";
	return provider?.enabled ? "Enabled" : "Disabled";
}

function providerStatusVariant(
	provider: { enabled: boolean } | undefined,
	configured: boolean,
) {
	if (!configured) return "outline" as const;
	return provider?.enabled ? "default" : "secondary";
}

function smtpSourceLabel(source?: string) {
	if (source === "database") return "Database";
	if (source === "environment") return "Environment fallback";
	return "Not configured";
}

function smtpSourceVariant(source?: string) {
	if (source === "database") return "default" as const;
	if (source === "environment") return "secondary" as const;
	return "outline" as const;
}

function ProviderIcon({ iconUrl }: { iconUrl?: string | null }) {
	if (iconUrl) {
		return (
			<img
				src={iconUrl}
				alt=""
				aria-hidden="true"
				className="size-8 rounded-md border bg-background object-contain p-1"
			/>
		);
	}

	return (
		<span className="flex size-8 items-center justify-center rounded-md border bg-muted text-muted-foreground">
			<KeyRound className="size-4" />
		</span>
	);
}

type EnterpriseAuditCheck = {
	id: string;
	category: "security" | "reliability" | "operations" | "data" | "auth";
	title: string;
	status: "pass" | "warn" | "fail" | "manual";
	evidence: string;
	recommendation: string;
};

const auditCategories: EnterpriseAuditCheck["category"][] = [
	"security",
	"auth",
	"data",
	"reliability",
	"operations",
];

function auditStatusVariant(status: EnterpriseAuditCheck["status"]) {
	if (status === "pass") return "default" as const;
	if (status === "fail") return "destructive" as const;
	if (status === "manual") return "outline" as const;
	return "secondary" as const;
}

function auditStatusLabel(status: EnterpriseAuditCheck["status"]) {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

function auditCategoryLabel(category: EnterpriseAuditCheck["category"]) {
	return category.charAt(0).toUpperCase() + category.slice(1);
}

function EnterpriseAuditPanel({
	audit,
}: {
	audit?: {
		generatedAt: Date | string;
		summary: Record<EnterpriseAuditCheck["status"], number>;
		checks: EnterpriseAuditCheck[];
	};
}) {
	if (!audit) {
		return (
			<div className="rounded-lg border bg-muted/30 p-4 text-muted-foreground text-sm">
				Loading enterprise readiness checks...
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{(["pass", "warn", "fail", "manual"] as const).map((status) => (
					<div key={status} className="rounded-lg border bg-muted/30 p-3">
						<p className="text-muted-foreground text-xs uppercase tracking-wide">
							{auditStatusLabel(status)}
						</p>
						<p className="font-semibold text-2xl">{audit.summary[status]}</p>
					</div>
				))}
			</div>

			<div className="rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Check</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Evidence</TableHead>
							<TableHead>Recommendation</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{auditCategories.map((category) => {
							const checks = audit.checks.filter(
								(check) => check.category === category,
							);
							if (checks.length === 0) return null;
							return checks.map((check, index) => (
								<TableRow key={check.id}>
									<TableCell className="align-top">
										<div className="space-y-1">
											{index === 0 && (
												<Badge variant="outline">
													{auditCategoryLabel(category)}
												</Badge>
											)}
											<p className="font-medium">{check.title}</p>
										</div>
									</TableCell>
									<TableCell className="align-top">
										<Badge variant={auditStatusVariant(check.status)}>
											{auditStatusLabel(check.status)}
										</Badge>
									</TableCell>
									<TableCell className="max-w-md align-top text-muted-foreground text-sm">
										{check.evidence}
									</TableCell>
									<TableCell className="max-w-md align-top text-sm">
										{check.recommendation}
									</TableCell>
								</TableRow>
							));
						})}
					</TableBody>
				</Table>
			</div>

			<p className="text-muted-foreground text-xs">
				Generated {new Date(audit.generatedAt).toLocaleString()}. This is a
				runtime readiness snapshot, not an immutable compliance report.
			</p>
		</div>
	);
}

function isValidOptionalEmail(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return true;
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function normalizeBrandingAssetUrl(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return "";

	try {
		const parsed = new URL(trimmed);
		const serverOrigin = new URL(env.VITE_SERVER_URL).origin;
		const browserOrigin = window.location.origin;

		if (parsed.origin === serverOrigin || parsed.origin === browserOrigin) {
			return `${parsed.pathname}${parsed.search}${parsed.hash}`;
		}
	} catch {
		return trimmed;
	}

	return trimmed;
}

function SettingsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [brandingForm, setBrandingForm] =
		useState<BrandingForm>(emptyBrandingForm);
	const [smtpForm, setSmtpForm] = useState<SmtpForm>(emptySmtpForm);
	const [providerTab, setProviderTab] = useState<ProviderTab>("oauth");
	const [providerSheetOpen, setProviderSheetOpen] = useState(false);
	const [providerForm, setProviderForm] = useState<ProviderForm | null>(null);
	const [createOidcDialogOpen, setCreateOidcDialogOpen] = useState(false);
	const [newOidcDisplayName, setNewOidcDisplayName] = useState("");
	const [deleteProviderId, setDeleteProviderId] = useState<string | null>(null);

	const brandingQuery = useQuery(trpc.settings.getBranding.queryOptions());
	const signupSettingsQuery = useQuery(
		trpc.settings.getSignupSettings.queryOptions(),
	);
	const smtpQuery = useQuery(trpc.settings.getSmtpSettings.queryOptions());
	const providersQuery = useQuery(
		trpc.settings.listAuthProviders.queryOptions(),
	);
	const auditQuery = useQuery(trpc.settings.getEnterpriseAudit.queryOptions());

	const providerById = useMemo(
		() =>
			new Map(
				(providersQuery.data ?? []).map((provider) => [
					provider.providerId,
					provider,
				]),
			),
		[providersQuery.data],
	);
	const oauthRows = useMemo(
		() =>
			oauthProviderIds.map((providerId) => {
				const provider = providerById.get(providerId);
				return {
					providerId,
					provider,
					form: providerToForm(provider ?? null, providerId),
					configured: Boolean(provider),
				};
			}),
		[providerById],
	);
	const oidcProviders = useMemo(
		() =>
			(providersQuery.data ?? []).filter(
				(provider) => provider.type === "oidc",
			),
		[providersQuery.data],
	);
	const providerPendingDelete = deleteProviderId
		? providerById.get(deleteProviderId)
		: null;
	const supportEmailInvalid = !isValidOptionalEmail(brandingForm.supportEmail);
	const smtpFromInvalid = !isValidOptionalEmail(smtpForm.fromAddress);
	const smtpTestInvalid = !isValidOptionalEmail(smtpForm.testTo);

	const openProviderSheet = (form: ProviderForm) => {
		setProviderForm(form);
		setProviderSheetOpen(true);
	};

	const closeProviderSheet = () => {
		setProviderSheetOpen(false);
		setProviderForm(null);
	};

	const updateProviderForm = (updates: Partial<ProviderForm>) => {
		setProviderForm((current) =>
			current ? { ...current, ...updates } : current,
		);
	};

	const invalidatePublicSettings = () => {
		queryClient.invalidateQueries({
			queryKey: trpc.settings.public.queryKey(),
		});
	};

	useEffect(() => {
		if (!brandingQuery.data) return;
		setBrandingForm({
			appName: brandingQuery.data.appName,
			appTagline: brandingQuery.data.appTagline,
			logoUrl: brandingQuery.data.logoUrl ?? "",
			faviconUrl: brandingQuery.data.faviconUrl ?? "",
			primaryColor: brandingQuery.data.primaryColor ?? "",
			supportEmail: brandingQuery.data.supportEmail ?? "",
		});
	}, [brandingQuery.data]);

	useEffect(() => {
		if (!smtpQuery.data) return;
		setSmtpForm((current) => ({
			...current,
			host: smtpQuery.data.host ?? "",
			port: smtpQuery.data.port ?? 587,
			secure: smtpQuery.data.secure,
			user: smtpQuery.data.user ?? "",
			password: "",
			clearPassword: false,
			fromAddress: smtpQuery.data.fromAddress ?? "",
		}));
	}, [smtpQuery.data]);

	const saveBranding = useMutation(
		trpc.settings.updateBranding.mutationOptions({
			onSuccess: () => {
				toast.success("Branding settings saved");
				brandingQuery.refetch();
				invalidatePublicSettings();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const updateSignupSettings = useMutation(
		trpc.settings.updateSignupSettings.mutationOptions({
			onSuccess: () => {
				toast.success("Account registration settings saved");
				signupSettingsQuery.refetch();
				auditQuery.refetch();
				invalidatePublicSettings();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const saveSmtp = useMutation(
		trpc.settings.updateSmtpSettings.mutationOptions({
			onSuccess: () => {
				toast.success("SMTP settings saved");
				setSmtpForm((current) => ({
					...current,
					password: "",
					clearPassword: false,
				}));
				smtpQuery.refetch();
				auditQuery.refetch();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const testSmtp = useMutation(
		trpc.settings.sendSmtpTestEmail.mutationOptions({
			onSuccess: (result) => {
				if (result.sent) {
					toast.success(
						`SMTP test email sent via ${smtpSourceLabel(result.source)}`,
					);
				} else {
					toast.error(result.error);
				}
				auditQuery.refetch();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const createOidcProvider = useMutation(
		trpc.settings.createOidcProvider.mutationOptions({
			onSuccess: (provider) => {
				toast.success("OIDC connection created");
				setNewOidcDisplayName("");
				setCreateOidcDialogOpen(false);
				openProviderSheet(providerToForm(provider, provider.providerId));
				providersQuery.refetch();
				invalidatePublicSettings();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const saveProvider = useMutation(
		trpc.settings.upsertAuthProvider.mutationOptions({
			onSuccess: (provider) => {
				toast.success(
					provider.requiresRestart
						? "OIDC connection saved. Restart the server before sign-in uses the change."
						: "Auth provider saved",
				);
				closeProviderSheet();
				providersQuery.refetch();
				invalidatePublicSettings();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const toggleProvider = useMutation(
		trpc.settings.toggleAuthProvider.mutationOptions({
			onSuccess: (provider) => {
				toast.success(
					provider.requiresRestart
						? "OIDC connection status updated. Restart the server before sign-in uses the change."
						: "Provider status updated",
				);
				providersQuery.refetch();
				invalidatePublicSettings();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const deleteProvider = useMutation(
		trpc.settings.deleteAuthProvider.mutationOptions({
			onSuccess: (result, variables) => {
				const wasOidc =
					result.provider?.type === "oidc" ||
					providerById.get(variables.providerId)?.type === "oidc";
				toast.success(
					wasOidc
						? "OIDC connection removed. Restart the server before sign-in uses the change."
						: result.deleted
							? "Provider deleted"
							: "Provider has linked accounts, so it was disabled instead",
				);
				if (providerForm?.providerId === variables.providerId) {
					closeProviderSheet();
				}
				setDeleteProviderId(null);
				providersQuery.refetch();
				invalidatePublicSettings();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (
		brandingQuery.error ||
		signupSettingsQuery.error ||
		smtpQuery.error ||
		providersQuery.error ||
		auditQuery.error
	) {
		const message =
			brandingQuery.error?.message ??
			signupSettingsQuery.error?.message ??
			smtpQuery.error?.message ??
			providersQuery.error?.message ??
			auditQuery.error?.message;
		return (
			<div className="space-y-2">
				<h2 className="font-semibold text-xl">Settings unavailable</h2>
				<p className="text-muted-foreground text-sm">
					{message === "Admin access required"
						? "You do not have access to settings."
						: message}
				</p>
			</div>
		);
	}

	const submitBranding = () => {
		if (supportEmailInvalid) {
			toast.error("Enter a valid support email address");
			return;
		}

		saveBranding.mutate({
			appName: brandingForm.appName.trim(),
			appTagline: brandingForm.appTagline.trim(),
			logoUrl: normalizeBrandingAssetUrl(brandingForm.logoUrl),
			faviconUrl: normalizeBrandingAssetUrl(brandingForm.faviconUrl),
			primaryColor: brandingForm.primaryColor.trim(),
			supportEmail: brandingForm.supportEmail.trim(),
		});
	};

	const submitSmtp = () => {
		const host = smtpForm.host.trim();
		const fromAddress = smtpForm.fromAddress.trim();
		if ((host || fromAddress) && (!host || !fromAddress)) {
			toast.error("SMTP host and from email are required together");
			return;
		}
		if (smtpFromInvalid) {
			toast.error("Enter a valid from email address");
			return;
		}

		saveSmtp.mutate({
			host,
			port: smtpForm.port,
			secure: smtpForm.secure,
			user: smtpForm.user.trim(),
			password: smtpForm.password,
			clearPassword: smtpForm.clearPassword,
			fromAddress,
		});
	};

	const submitSmtpTest = () => {
		const to = smtpForm.testTo.trim();
		if (!to || smtpTestInvalid) {
			toast.error("Enter a valid test recipient email");
			return;
		}
		testSmtp.mutate({ to });
	};

	const submitProvider = () => {
		if (!providerForm) return;
		if (providerForm.type === "oidc" && !providerForm.providerId) {
			toast.error("Create an OIDC connection first");
			return;
		}

		saveProvider.mutate({
			type: providerForm.type,
			providerId: providerForm.providerId,
			displayName: providerForm.displayName,
			iconUrl: normalizeBrandingAssetUrl(providerForm.iconUrl),
			enabled: providerForm.enabled,
			clientId: providerForm.clientId,
			clientSecret: providerForm.clientSecret || undefined,
			discoveryUrl: providerForm.discoveryUrl,
			issuerUrl: providerForm.issuerUrl,
			authorizationEndpoint: providerForm.authorizationEndpoint,
			tokenEndpoint: providerForm.tokenEndpoint,
			userinfoEndpoint: providerForm.userinfoEndpoint,
			jwksEndpoint: providerForm.jwksEndpoint,
			scopes: splitScopes(providerForm.scopes),
			allowSignUp: providerForm.allowSignUp,
			overrideUserInfoOnSignIn: providerForm.overrideUserInfoOnSignIn,
			sortOrder: providerForm.sortOrder,
		});
	};

	const submitCreateOidcProvider = () => {
		const displayName = newOidcDisplayName.trim();
		if (!displayName) {
			toast.error("Enter an OIDC connection name");
			return;
		}

		createOidcProvider.mutate({ displayName });
	};

	const confirmDeleteProvider = () => {
		if (!deleteProviderId) return;
		deleteProvider.mutate({ providerId: deleteProviderId });
	};

	const providerActionsMenu = ({
		configured,
		enabled,
		form,
		providerId,
	}: {
		configured: boolean;
		enabled: boolean;
		form: ProviderForm;
		providerId: string;
	}) => (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button variant="ghost" size="icon-xs" className="size-6" />}
			>
				<MoreHorizontal className="size-3.5" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => openProviderSheet(form)}>
					<Edit3 className="mr-2 size-3.5" />
					{configured ? "Edit" : "Configure"}
				</DropdownMenuItem>
				{configured && (
					<DropdownMenuItem
						disabled={toggleProvider.isPending}
						onClick={() =>
							toggleProvider.mutate({
								providerId,
								enabled: !enabled,
							})
						}
					>
						{enabled ? "Disable" : "Enable"}
					</DropdownMenuItem>
				)}
				{configured && (
					<DropdownMenuItem
						variant="destructive"
						disabled={deleteProvider.isPending}
						onClick={() => setDeleteProviderId(providerId)}
					>
						<Trash2 className="mr-2 size-3.5" />
						Delete
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<div className="space-y-6">
			<div>
				<h2 className="font-semibold text-2xl tracking-tight">Settings</h2>
				<p className="text-muted-foreground text-sm">
					Configure app branding, OAuth sign-in, and OIDC SSO connections.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Bot className="size-5" />
						Branding
					</CardTitle>
					<CardDescription>
						These values are shown on login, header, and dashboard shell.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="appName">App name</Label>
							<Input
								id="appName"
								value={brandingForm.appName}
								onChange={(event) =>
									setBrandingForm((current) => ({
										...current,
										appName: event.target.value,
									}))
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="appTagline">Tagline</Label>
							<Input
								id="appTagline"
								value={brandingForm.appTagline}
								onChange={(event) =>
									setBrandingForm((current) => ({
										...current,
										appTagline: event.target.value,
									}))
								}
							/>
						</div>
						<div className="space-y-2">
							<Label>Logo image</Label>
							<MediaUpload
								label="Logo"
								accept="image/png,image/jpeg,image/webp,image/gif"
								maxSizeMb={2}
								value={brandingForm.logoUrl}
								onUploaded={(media) =>
									setBrandingForm((current) => ({
										...current,
										logoUrl: normalizeBrandingAssetUrl(media.url),
									}))
								}
								onUrlChange={(url) =>
									setBrandingForm((current) => ({
										...current,
										logoUrl: url,
									}))
								}
							/>
						</div>
						<div className="space-y-2">
							<Label>Favicon image</Label>
							<MediaUpload
								label="Favicon"
								accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon,.ico"
								maxSizeMb={1}
								value={brandingForm.faviconUrl}
								onUploaded={(media) =>
									setBrandingForm((current) => ({
										...current,
										faviconUrl: normalizeBrandingAssetUrl(media.url),
									}))
								}
								onUrlChange={(url) =>
									setBrandingForm((current) => ({
										...current,
										faviconUrl: url,
									}))
								}
							/>
						</div>
						<div className="space-y-2">
							<Label>Primary color</Label>
							<ColorPicker
								value={brandingForm.primaryColor || "#25D366"}
								showAlpha={false}
								onChange={(value) =>
									setBrandingForm((current) => ({
										...current,
										primaryColor: value,
									}))
								}
							/>
							<div className="flex items-center gap-2">
								<span className="font-mono text-muted-foreground text-xs">
									{brandingForm.primaryColor || "Not set"}
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() =>
										setBrandingForm((current) => ({
											...current,
											primaryColor: "",
										}))
									}
								>
									Clear
								</Button>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="supportEmail">Support email</Label>
							<Input
								id="supportEmail"
								type="email"
								aria-invalid={supportEmailInvalid || undefined}
								value={brandingForm.supportEmail}
								onChange={(event) =>
									setBrandingForm((current) => ({
										...current,
										supportEmail: event.target.value,
									}))
								}
							/>
							{supportEmailInvalid && (
								<p className="text-destructive text-xs">
									Enter a valid email address.
								</p>
							)}
						</div>
					</div>

					<div className="rounded-lg border bg-muted/40 p-4">
						<p className="font-medium text-sm">Preview</p>
						<div className="mt-2 flex items-center gap-3">
							{brandingForm.logoUrl ? (
								<img
									src={brandingForm.logoUrl}
									alt="Logo preview"
									className="size-10 rounded object-cover"
								/>
							) : (
								<div className="flex size-10 items-center justify-center rounded bg-primary/10">
									<Bot className="size-5" />
								</div>
							)}
							<div>
								<p className="font-semibold text-lg">{brandingForm.appName}</p>
								<p className="text-muted-foreground text-sm">
									{brandingForm.appTagline || "No tagline"}
								</p>
							</div>
						</div>
					</div>

					<Button
						onClick={submitBranding}
						disabled={saveBranding.isPending || supportEmailInvalid}
					>
						<Save />
						{saveBranding.isPending ? "Saving..." : "Save branding"}
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-1">
							<CardTitle className="flex items-center gap-2">
								<Mail className="size-5" />
								Email / SMTP
							</CardTitle>
							<CardDescription>
								Configure outbound email for user invitations and operational
								notifications.
							</CardDescription>
						</div>
						<Badge variant={smtpSourceVariant(smtpQuery.data?.source)}>
							{smtpSourceLabel(smtpQuery.data?.source)}
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="rounded-lg border bg-muted/40 p-4 text-muted-foreground text-sm">
						Database SMTP settings override environment variables when host,
						port, and from email are set. Clear host/from email to restore
						environment fallback. The password is write-only and never shown
						after saving.
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="smtpHost">SMTP host</Label>
							<Input
								id="smtpHost"
								placeholder="smtp.example.com"
								value={smtpForm.host}
								onChange={(event) =>
									setSmtpForm((current) => ({
										...current,
										host: event.target.value,
									}))
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="smtpPort">Port</Label>
							<Input
								id="smtpPort"
								type="number"
								min={1}
								max={65535}
								value={smtpForm.port}
								onChange={(event) =>
									setSmtpForm((current) => ({
										...current,
										port: Number(event.target.value) || 587,
									}))
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="smtpUser">Username</Label>
							<Input
								id="smtpUser"
								value={smtpForm.user}
								onChange={(event) =>
									setSmtpForm((current) => ({
										...current,
										user: event.target.value,
									}))
								}
							/>
						</div>
						<div className="space-y-2">
							<div className="flex items-center justify-between gap-3">
								<Label htmlFor="smtpPassword">Password</Label>
								<Badge
									variant={
										smtpQuery.data?.hasPassword ? "secondary" : "outline"
									}
								>
									{smtpQuery.data?.hasPassword ? "Stored" : "Missing"}
								</Badge>
							</div>
							<Input
								id="smtpPassword"
								type="password"
								placeholder="Leave blank to keep existing password"
								value={smtpForm.password}
								onChange={(event) =>
									setSmtpForm((current) => ({
										...current,
										password: event.target.value,
										clearPassword: false,
									}))
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="smtpFrom">From email</Label>
							<Input
								id="smtpFrom"
								type="email"
								aria-invalid={smtpFromInvalid || undefined}
								placeholder="noreply@example.com"
								value={smtpForm.fromAddress}
								onChange={(event) =>
									setSmtpForm((current) => ({
										...current,
										fromAddress: event.target.value,
									}))
								}
							/>
							{smtpFromInvalid && (
								<p className="text-destructive text-xs">
									Enter a valid email address.
								</p>
							)}
						</div>
						<div className="space-y-3 rounded-lg border p-3">
							<div className="flex items-center justify-between gap-3">
								<div className="space-y-1">
									<Label htmlFor="smtpSecure">Secure TLS</Label>
									<p className="text-muted-foreground text-xs">
										Use implicit TLS, commonly port 465.
									</p>
								</div>
								<Switch
									id="smtpSecure"
									checked={smtpForm.secure}
									onCheckedChange={(checked) =>
										setSmtpForm((current) => ({ ...current, secure: checked }))
									}
								/>
							</div>
							{smtpQuery.data?.hasPassword && (
								<div className="flex items-center justify-between gap-3 border-t pt-3">
									<div className="space-y-1">
										<Label htmlFor="smtpClearPassword">
											Clear stored password
										</Label>
										<p className="text-muted-foreground text-xs">
											Use this for unauthenticated SMTP relay.
										</p>
									</div>
									<Switch
										id="smtpClearPassword"
										checked={smtpForm.clearPassword}
										onCheckedChange={(checked) =>
											setSmtpForm((current) => ({
												...current,
												clearPassword: checked,
												password: checked ? "" : current.password,
											}))
										}
									/>
								</div>
							)}
						</div>
					</div>
					<Button
						type="button"
						onClick={submitSmtp}
						disabled={saveSmtp.isPending || smtpFromInvalid}
					>
						<Save />
						{saveSmtp.isPending ? "Saving..." : "Save SMTP"}
					</Button>
					<div className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_auto] md:items-end">
						<div className="space-y-2">
							<Label htmlFor="smtpTestTo">Test recipient</Label>
							<Input
								id="smtpTestTo"
								type="email"
								aria-invalid={smtpTestInvalid || undefined}
								placeholder="admin@example.com"
								value={smtpForm.testTo}
								onChange={(event) =>
									setSmtpForm((current) => ({
										...current,
										testTo: event.target.value,
									}))
								}
							/>
							{smtpTestInvalid && (
								<p className="text-destructive text-xs">
									Enter a valid email address.
								</p>
							)}
						</div>
						<Button
							type="button"
							variant="outline"
							disabled={
								testSmtp.isPending || smtpTestInvalid || !smtpForm.testTo
							}
							onClick={submitSmtpTest}
						>
							{testSmtp.isPending ? "Sending..." : "Send test email"}
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<ShieldAlert className="size-5" />
						Account registration
					</CardTitle>
					<CardDescription>
						Control which methods people can use to create accounts.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
						<div className="space-y-1">
							<Label htmlFor="emailPasswordSignupEnabled">
								Allow email/password signup
							</Label>
							<p className="text-muted-foreground text-xs">
								Disabling it requires a valid invitation for new password
								accounts. Existing users can still sign in.
							</p>
						</div>
						<Switch
							id="emailPasswordSignupEnabled"
							checked={
								signupSettingsQuery.data?.emailPasswordSignupEnabled ?? true
							}
							disabled={
								signupSettingsQuery.isPending || updateSignupSettings.isPending
							}
							onCheckedChange={(emailPasswordSignupEnabled) =>
								updateSignupSettings.mutate({
									globalSignupEnabled:
										signupSettingsQuery.data?.globalSignupEnabled ?? true,
									emailPasswordSignupEnabled,
								})
							}
						/>
					</div>
					<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
						<div className="space-y-1">
							<Label htmlFor="globalSignupEnabled">Allow public signup</Label>
							<p className="text-muted-foreground text-xs">
								When disabled, email, OAuth, and OIDC registration require a
								valid invitation. Existing users can still sign in.
							</p>
						</div>
						<Switch
							id="globalSignupEnabled"
							checked={signupSettingsQuery.data?.globalSignupEnabled ?? true}
							disabled={
								signupSettingsQuery.isPending || updateSignupSettings.isPending
							}
							onCheckedChange={(globalSignupEnabled) =>
								updateSignupSettings.mutate({
									globalSignupEnabled,
									emailPasswordSignupEnabled:
										signupSettingsQuery.data?.emailPasswordSignupEnabled ??
										true,
								})
							}
						/>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-1">
							<CardTitle className="flex items-center gap-2">
								<KeyRound className="size-5" />
								Auth providers
							</CardTitle>
							<CardDescription>
								Manage built-in OAuth providers and dynamic OIDC SSO
								connections.
							</CardDescription>
						</div>
						{providerTab === "oidc" && (
							<Button
								type="button"
								size="sm"
								onClick={() => setCreateOidcDialogOpen(true)}
							>
								<Plus />
								New OIDC connection
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<Tabs
						value={providerTab}
						onValueChange={(value) => setProviderTab(value as ProviderTab)}
					>
						<TabsList>
							<TabsTrigger value="oauth">OAuth providers</TabsTrigger>
							<TabsTrigger value="oidc">OIDC connections</TabsTrigger>
						</TabsList>
						<TabsContent value="oauth" className="pt-4">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Provider</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Client ID</TableHead>
										<TableHead>Secret</TableHead>
										<TableHead>Callback</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{oauthRows.map(
										({ configured, form, provider, providerId }) => (
											<TableRow key={providerId}>
												<TableCell>
													<div className="flex items-center gap-3">
														<ProviderIcon
															iconUrl={
																provider?.iconUrl ??
																defaultProviderIconUrl(providerId)
															}
														/>
														<div className="space-y-1">
															<p className="font-medium">{form.displayName}</p>
															<p className="font-mono text-muted-foreground text-xs">
																{providerId}
															</p>
														</div>
													</div>
												</TableCell>
												<TableCell>
													<Badge
														variant={providerStatusVariant(
															provider,
															configured,
														)}
													>
														{providerStatusLabel(provider, configured)}
													</Badge>
												</TableCell>
												<TableCell className="max-w-56 truncate">
													{provider?.clientId || (
														<span className="text-muted-foreground">
															Not set
														</span>
													)}
												</TableCell>
												<TableCell>
													{provider?.hasClientSecret ? "Stored" : "Missing"}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{provider?.callbackUrl ?? providerCallbackUrl(form)}
												</TableCell>
												<TableCell className="text-right">
													{providerActionsMenu({
														configured,
														enabled: Boolean(provider?.enabled),
														form,
														providerId,
													})}
												</TableCell>
											</TableRow>
										),
									)}
								</TableBody>
							</Table>
						</TabsContent>
						<TabsContent value="oidc" className="pt-4">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Connection</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Client ID</TableHead>
										<TableHead>Secret</TableHead>
										<TableHead>Callback</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{oidcProviders.map((provider) => {
										const form = providerToForm(provider, provider.providerId);
										return (
											<TableRow key={provider.providerId}>
												<TableCell>
													<div className="flex items-center gap-3">
														<ProviderIcon iconUrl={provider.iconUrl} />
														<div className="space-y-1">
															<p className="font-medium">
																{provider.displayName}
															</p>
															<p className="font-mono text-muted-foreground text-xs">
																{provider.providerId}
															</p>
														</div>
													</div>
												</TableCell>
												<TableCell>
													<Badge
														variant={provider.enabled ? "default" : "secondary"}
													>
														{provider.enabled ? "Enabled" : "Disabled"}
													</Badge>
												</TableCell>
												<TableCell className="max-w-56 truncate">
													{provider.clientId || (
														<span className="text-muted-foreground">
															Not set
														</span>
													)}
												</TableCell>
												<TableCell>
													{provider.hasClientSecret ? "Stored" : "Missing"}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{provider.callbackUrl}
												</TableCell>
												<TableCell className="text-right">
													{providerActionsMenu({
														configured: true,
														enabled: provider.enabled,
														form,
														providerId: provider.providerId,
													})}
												</TableCell>
											</TableRow>
										);
									})}
									{oidcProviders.length === 0 && (
										<TableRow>
											<TableCell colSpan={6}>
												<div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
													<div className="space-y-1">
														<p className="font-medium">
															No OIDC connections yet
														</p>
														<p className="text-muted-foreground text-sm">
															Create one to generate a stable callback URL for
															your identity provider.
														</p>
													</div>
													<Button
														type="button"
														size="sm"
														onClick={() => setCreateOidcDialogOpen(true)}
													>
														<Plus />
														New OIDC connection
													</Button>
												</div>
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<ShieldAlert className="size-5" />
						Enterprise Audit
					</CardTitle>
					<CardDescription>
						Runtime readiness checks for enterprise production hardening.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<EnterpriseAuditPanel audit={auditQuery.data} />
				</CardContent>
			</Card>

			<Dialog
				open={createOidcDialogOpen}
				onOpenChange={(open) => {
					if (!open && createOidcProvider.isPending) return;
					setCreateOidcDialogOpen(open);
					if (!open) setNewOidcDisplayName("");
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New OIDC connection</DialogTitle>
						<DialogDescription>
							Name this connection first. A stable provider ID and callback URL
							will be generated and cannot be changed later.
						</DialogDescription>
					</DialogHeader>
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							submitCreateOidcProvider();
						}}
					>
						<div className="space-y-2">
							<Label htmlFor="newOidcDisplayName">Connection name</Label>
							<Input
								id="newOidcDisplayName"
								placeholder="Company SSO"
								value={newOidcDisplayName}
								onChange={(event) => setNewOidcDisplayName(event.target.value)}
							/>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={createOidcProvider.isPending}
								onClick={() => setCreateOidcDialogOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={createOidcProvider.isPending}>
								{createOidcProvider.isPending
									? "Creating..."
									: "Create connection"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Sheet
				open={providerSheetOpen}
				onOpenChange={(open) => {
					if (!open && saveProvider.isPending) return;
					setProviderSheetOpen(open);
					if (!open) setProviderForm(null);
				}}
			>
				<SheetContent className="w-full sm:max-w-2xl">
					<SheetHeader>
						<SheetTitle>
							{providerForm
								? `Configure ${providerForm.displayName || providerTypeLabel(providerForm.type)}`
								: "Configure provider"}
						</SheetTitle>
						<SheetDescription>
							Secrets are write-only. Leave the client secret blank to keep the
							existing value.
						</SheetDescription>
					</SheetHeader>
					{providerForm && (
						<form
							className="flex min-h-0 flex-1 flex-col"
							onSubmit={(event) => {
								event.preventDefault();
								submitProvider();
							}}
						>
							<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4">
								<div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
									<div className="flex items-center justify-between gap-3">
										<span className="text-muted-foreground">Type</span>
										<Badge variant="secondary">
											{providerTypeLabel(providerForm.type)}
										</Badge>
									</div>
									<div className="flex items-center justify-between gap-3">
										<span className="text-muted-foreground">Provider ID</span>
										<code className="font-mono text-xs">
											{providerForm.providerId}
										</code>
									</div>
									<div className="space-y-1">
										<span className="text-muted-foreground">Callback URL</span>
										<p className="break-all font-mono text-xs">
											{providerCallbackUrl(providerForm)}
										</p>
									</div>
									{providerForm.type === "oidc" && (
										<p className="rounded-md border bg-background p-2 text-muted-foreground text-xs">
											Restart the server after enabling or changing an OIDC
											connection so Better Auth can reload generic OAuth config.
										</p>
									)}
								</div>

								<div className="space-y-2">
									<Label htmlFor="displayName">Display name</Label>
									<Input
										id="displayName"
										value={providerForm.displayName}
										onChange={(event) =>
											updateProviderForm({ displayName: event.target.value })
										}
									/>
								</div>
								<div className="space-y-2">
									<Label>Provider icon</Label>
									<MediaUpload
										label="Provider icon"
										accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon,.ico"
										maxSizeMb={1}
										value={providerForm.iconUrl}
										onUploaded={(media) =>
											updateProviderForm({
												iconUrl: normalizeBrandingAssetUrl(media.url),
											})
										}
										onUrlChange={(url) => updateProviderForm({ iconUrl: url })}
									/>
									<p className="text-muted-foreground text-xs">
										Default icon uses TheSVG when available. Upload a custom
										icon to override.
									</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="clientId">Client ID</Label>
									<Input
										id="clientId"
										value={providerForm.clientId}
										onChange={(event) =>
											updateProviderForm({ clientId: event.target.value })
										}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="clientSecret">Client secret</Label>
									<Input
										id="clientSecret"
										type="password"
										placeholder="Leave blank to keep existing secret"
										value={providerForm.clientSecret}
										onChange={(event) =>
											updateProviderForm({ clientSecret: event.target.value })
										}
									/>
								</div>
								{providerForm.type === "oidc" && (
									<div className="space-y-4 rounded-lg border bg-muted/30 p-3">
										<div className="space-y-2">
											<Label htmlFor="discoveryUrl">Discovery URL</Label>
											<Input
												id="discoveryUrl"
												placeholder="https://issuer/.well-known/openid-configuration"
												value={providerForm.discoveryUrl}
												onChange={(event) =>
													updateProviderForm({
														discoveryUrl: event.target.value,
													})
												}
											/>
										</div>
										<div className="space-y-2">
											<Label htmlFor="issuerUrl">Issuer URL</Label>
											<Input
												id="issuerUrl"
												placeholder="https://issuer"
												value={providerForm.issuerUrl}
												onChange={(event) =>
													updateProviderForm({ issuerUrl: event.target.value })
												}
											/>
										</div>
										<div className="grid gap-3 md:grid-cols-2">
											<div className="space-y-2">
												<Label htmlFor="authorizationEndpoint">
													Authorization URL
												</Label>
												<Input
													id="authorizationEndpoint"
													value={providerForm.authorizationEndpoint}
													onChange={(event) =>
														updateProviderForm({
															authorizationEndpoint: event.target.value,
														})
													}
												/>
											</div>
											<div className="space-y-2">
												<Label htmlFor="tokenEndpoint">Token URL</Label>
												<Input
													id="tokenEndpoint"
													value={providerForm.tokenEndpoint}
													onChange={(event) =>
														updateProviderForm({
															tokenEndpoint: event.target.value,
														})
													}
												/>
											</div>
											<div className="space-y-2">
												<Label htmlFor="userinfoEndpoint">UserInfo URL</Label>
												<Input
													id="userinfoEndpoint"
													value={providerForm.userinfoEndpoint}
													onChange={(event) =>
														updateProviderForm({
															userinfoEndpoint: event.target.value,
														})
													}
												/>
											</div>
											<div className="space-y-2">
												<Label htmlFor="jwksEndpoint">JWKS URL</Label>
												<Input
													id="jwksEndpoint"
													value={providerForm.jwksEndpoint}
													onChange={(event) =>
														updateProviderForm({
															jwksEndpoint: event.target.value,
														})
													}
												/>
											</div>
										</div>
									</div>
								)}
								<div className="space-y-2">
									<Label htmlFor="scopes">Scopes</Label>
									<Input
										id="scopes"
										value={providerForm.scopes}
										onChange={(event) =>
											updateProviderForm({ scopes: event.target.value })
										}
									/>
									<p className="text-muted-foreground text-xs">
										Comma-separated provider scopes.
									</p>
								</div>
								<div className="space-y-3 rounded-lg border p-3">
									<div className="flex items-center justify-between gap-4">
										<div className="space-y-0.5">
											<Label htmlFor="providerEnabled">Enable provider</Label>
											<p className="text-muted-foreground text-xs">
												Enabled providers appear on the sign-in page.
											</p>
										</div>
										<Switch
											id="providerEnabled"
											checked={providerForm.enabled}
											onCheckedChange={(checked) =>
												updateProviderForm({ enabled: checked })
											}
										/>
									</div>
									<div className="flex items-center justify-between gap-4">
										<div className="space-y-0.5">
											<Label htmlFor="providerAllowSignUp">Allow sign-up</Label>
											<p className="text-muted-foreground text-xs">
												Allow new users to be created from this provider.
											</p>
										</div>
										<Switch
											id="providerAllowSignUp"
											checked={providerForm.allowSignUp}
											onCheckedChange={(checked) =>
												updateProviderForm({ allowSignUp: checked })
											}
										/>
									</div>
									<div className="flex items-center justify-between gap-4">
										<div className="space-y-0.5">
											<Label htmlFor="providerOverrideUserInfo">
												Sync user profile on sign-in
											</Label>
											<p className="text-muted-foreground text-xs">
												Update user info from provider each time they sign in.
											</p>
										</div>
										<Switch
											id="providerOverrideUserInfo"
											checked={providerForm.overrideUserInfoOnSignIn}
											onCheckedChange={(checked) =>
												updateProviderForm({
													overrideUserInfoOnSignIn: checked,
												})
											}
										/>
									</div>
								</div>
							</div>
							<SheetFooter className="border-t bg-muted/30">
								<Button
									type="button"
									variant="outline"
									disabled={saveProvider.isPending}
									onClick={closeProviderSheet}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={saveProvider.isPending}>
									<Save />
									{saveProvider.isPending ? "Saving..." : "Save provider"}
								</Button>
							</SheetFooter>
						</form>
					)}
				</SheetContent>
			</Sheet>

			<AlertDialog
				open={Boolean(deleteProviderId)}
				onOpenChange={(open) => {
					if (!open) setDeleteProviderId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete auth provider?</AlertDialogTitle>
						<AlertDialogDescription>
							{providerPendingDelete?.type === "oidc"
								? "This removes the OIDC connection configuration. If it has linked accounts, it may be disabled instead. Restart the server after OIDC changes before sign-in uses the update."
								: "This removes this provider configuration. If it has linked accounts, it may be disabled instead."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteProvider.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleteProvider.isPending}
							onClick={confirmDeleteProvider}
						>
							{deleteProvider.isPending ? "Deleting..." : "Delete provider"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
