import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import { Bot, GitBranch, MessageSquare, Smartphone } from "lucide-react";
import { useState } from "react";

import Header from "@/components/header";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/login")({
	component: RouteComponent,
});

const steps = [
	{ icon: Smartphone, label: "Pair device" },
	{ icon: GitBranch, label: "Build flow" },
	{ icon: MessageSquare, label: "Reply safely" },
] as const;

function RouteComponent() {
	const trpc = useTRPC();
	const { data: publicSettings } = useQuery(
		trpc.settings.public.queryOptions(),
	);
	const inviteToken =
		typeof window === "undefined"
			? null
			: new URLSearchParams(window.location.search).get("invite");
	const [showSignIn, setShowSignIn] = useState(!inviteToken);
	const globalSignupEnabled = publicSettings?.auth.globalSignupEnabled ?? true;
	const emailPasswordEnabled =
		publicSettings?.auth.emailPasswordEnabled ?? true;
	const registrationAvailable =
		(emailPasswordEnabled && globalSignupEnabled) || Boolean(inviteToken);
	const showSignUp = !showSignIn && registrationAvailable;
	const branding = publicSettings?.branding;
	const appName = branding?.appName ?? "WhatsApp Flow";
	const logoUrl = branding?.logoUrl;

	return (
		<div className="min-h-svh bg-background">
			<Header />
			<main className="mx-auto grid min-h-[calc(100svh-3.5rem)] max-w-6xl gap-8 px-4 py-10 md:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
				<section className="hidden space-y-6 lg:block">
					{logoUrl ? (
						<img
							src={logoUrl}
							alt={`${appName} logo`}
							className="size-11 border bg-muted object-contain shadow-sm"
						/>
					) : (
						<span className="flex size-11 items-center justify-center border bg-primary text-primary-foreground shadow-sm">
							<Bot className="size-5" />
						</span>
					)}
					<div className="space-y-3">
						<h1 className="font-semibold text-4xl tracking-tight">
							Access your {appName} workspace.
						</h1>
						<p className="max-w-md text-muted-foreground text-sm leading-6">
							Sign in to manage devices, deploy flow automations, and monitor
							conversation runs from the dashboard shell.
						</p>
					</div>
					<div className="grid max-w-md gap-2">
						{steps.map(({ icon: Icon, label }) => (
							<div
								key={label}
								className="flex items-center gap-3 border bg-card/70 p-3"
							>
								<span className="flex size-8 items-center justify-center border bg-muted text-primary">
									<Icon className="size-4" />
								</span>
								<p className="font-medium text-sm">{label}</p>
							</div>
						))}
					</div>
				</section>

				<Card className="mx-auto w-full max-w-md border-primary/15 bg-card/90 shadow-sm">
					<CardHeader className="text-center">
						<CardTitle>
							{showSignUp ? "Create workspace account" : "Welcome back"}
						</CardTitle>
						<CardDescription>
							{showSignUp
								? "Create an account to start building WhatsApp flows."
								: "Sign in to continue to your dashboard."}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{showSignUp ? (
							<SignUpForm
								inviteToken={inviteToken ?? undefined}
								onSwitchToSignIn={() => setShowSignIn(true)}
							/>
						) : (
							<SignInForm
								showSignup={registrationAvailable}
								onSwitchToSignUp={() => setShowSignIn(false)}
							/>
						)}
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
