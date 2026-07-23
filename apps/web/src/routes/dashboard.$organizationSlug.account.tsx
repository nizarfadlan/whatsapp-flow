import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@whatsapp-flow/ui/components/avatar";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import { Skeleton } from "@whatsapp-flow/ui/components/skeleton";
import { LogOut, Mail, ShieldCheck, UserCircle } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/$organizationSlug/account")({
	component: AccountPage,
});

function getInitials(name?: string | null, email?: string | null) {
	const value = name || email || "User";
	return value
		.split(" ")
		.slice(0, 2)
		.map((part) => part.charAt(0))
		.join("")
		.toUpperCase();
}

function getStringField(source: unknown, key: string) {
	if (!source || typeof source !== "object") return null;
	const value = (source as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getBooleanField(source: unknown, key: string) {
	if (!source || typeof source !== "object") return null;
	const value = (source as Record<string, unknown>)[key];
	return typeof value === "boolean" ? value : null;
}

function getDateField(source: unknown, key: string) {
	if (!source || typeof source !== "object") return null;
	const value = (source as Record<string, unknown>)[key];
	if (value instanceof Date) return value;
	if (typeof value !== "string") return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
	return (
		<div className="flex items-start justify-between gap-4 border-b py-3 last:border-b-0">
			<span className="text-muted-foreground text-sm">{label}</span>
			<span className="max-w-[65%] break-all text-right font-medium text-sm">
				{value || "Not available"}
			</span>
		</div>
	);
}

function AccountPage() {
	const navigate = useNavigate();
	const trpc = useTRPC();
	const { data: session, isPending } = authClient.useSession();
	const { data: publicSettings } = useQuery(
		trpc.settings.public.queryOptions(),
	);
	const user = session?.user;
	const initials = getInitials(user?.name, user?.email);
	const role = getStringField(user, "role");
	const emailVerified = getBooleanField(user, "emailVerified");
	const createdAt = getDateField(user, "createdAt");
	const supportEmail = publicSettings?.branding.supportEmail;

	if (isPending) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-8 w-48" />
				<div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
					<Skeleton className="h-72" />
					<Skeleton className="h-72" />
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1">
					<h2 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
						<UserCircle className="size-6 text-primary" />
						Account
					</h2>
					<p className="text-muted-foreground text-sm">
						Review the account currently signed in to this dashboard.
					</p>
				</div>
				<Button
					variant="outline"
					onClick={() => {
						authClient.signOut({
							fetchOptions: {
								onSuccess: () => navigate({ to: "/" }),
							},
						});
					}}
				>
					<LogOut />
					Sign out
				</Button>
			</div>

			<div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
				<Card>
					<CardHeader>
						<CardTitle>Profile</CardTitle>
						<CardDescription>
							Basic identity from the active session.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="flex items-center gap-4 rounded-lg border bg-muted/30 p-4">
							<Avatar className="size-14 border bg-background">
								<AvatarFallback>{initials}</AvatarFallback>
							</Avatar>
							<div className="min-w-0">
								<p className="truncate font-semibold text-lg">
									{user?.name || "Unnamed account"}
								</p>
								<p className="truncate text-muted-foreground text-sm">
									{user?.email || "No email on session"}
								</p>
							</div>
						</div>

						<div className="rounded-lg border px-4">
							<DetailRow label="Name" value={user?.name} />
							<DetailRow label="Email" value={user?.email} />
							<DetailRow label="User ID" value={user?.id} />
							<DetailRow label="Role" value={role} />
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<ShieldCheck className="size-5 text-primary" />
							Security
						</CardTitle>
						<CardDescription>
							Sign-in and support details for this workspace.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="rounded-lg border px-4">
							<div className="flex items-center justify-between gap-4 border-b py-3">
								<span className="text-muted-foreground text-sm">
									Email status
								</span>
								{emailVerified == null ? (
									<Badge variant="secondary">Unknown</Badge>
								) : emailVerified ? (
									<Badge>Verified</Badge>
								) : (
									<Badge variant="destructive">Unverified</Badge>
								)}
							</div>
							<DetailRow
								label="Created"
								value={createdAt?.toLocaleDateString()}
							/>
						</div>

						<p className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-sm leading-6">
							OAuth and OIDC sign-in methods are configured by workspace admins
							in Dashboard Settings.
						</p>

						{supportEmail && (
							<Button
								variant="outline"
								className="w-full justify-start"
								render={<a href={`mailto:${supportEmail}`} />}
							>
								<Mail />
								Contact support
							</Button>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
