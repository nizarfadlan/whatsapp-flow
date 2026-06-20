import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { buttonVariants } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import { Skeleton } from "@whatsapp-flow/ui/components/skeleton";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	Activity,
	ArrowRight,
	Bot,
	CheckCircle2,
	GitBranch,
	MessageSquare,
	Smartphone,
} from "lucide-react";

import Header from "@/components/header";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

const features = [
	{
		icon: Smartphone,
		title: "Connected devices",
		description:
			"Pair WhatsApp devices and keep sessions restored from storage.",
	},
	{
		icon: GitBranch,
		title: "Visual flow builder",
		description:
			"Compose triggers, replies, waits, and actions without runtime wiring.",
	},
	{
		icon: Activity,
		title: "Execution logs",
		description:
			"Review automation runs, trigger sources, and delivery behavior.",
	},
] as const;

const steps = ["Connect a device", "Create a flow", "Deploy triggers"];

function HomeComponent() {
	const trpc = useTRPC();
	const healthCheck = useQuery(trpc.healthCheck.queryOptions());
	const { data: session, isPending } = authClient.useSession();

	return (
		<div className="min-h-svh bg-background text-foreground">
			<Header />
			<main>
				<section className="border-b">
					<div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-[1fr_420px] lg:items-center">
						<div className="space-y-8">
							<div className="space-y-4">
								<Badge variant="outline" className="px-2 py-1">
									<Bot className="size-3" />
									WhatsApp automation builder
								</Badge>
								<div className="space-y-3">
									<h1 className="max-w-3xl font-semibold text-4xl tracking-tight md:text-6xl">
										Build and monitor WhatsApp bot flows from one dashboard.
									</h1>
									<p className="max-w-2xl text-base text-muted-foreground leading-7">
										Connect devices, design visual automations, and inspect
										runtime activity with a clean shadcn-style workspace.
									</p>
								</div>
							</div>

							<div className="flex flex-wrap items-center gap-3">
								{isPending ? (
									<Skeleton className="h-10 w-32" />
								) : session ? (
									<Link
										to="/dashboard"
										className={cn(buttonVariants({ size: "lg" }))}
									>
										Go to dashboard
										<ArrowRight className="size-4" />
									</Link>
								) : (
									<Link
										to="/login"
										className={cn(buttonVariants({ size: "lg" }))}
									>
										Sign in
										<ArrowRight className="size-4" />
									</Link>
								)}
								<a
									href="#features"
									className={cn(
										buttonVariants({ variant: "outline", size: "lg" }),
									)}
								>
									View features
								</a>
							</div>

							<div className="grid max-w-xl gap-3 text-muted-foreground text-sm sm:grid-cols-3">
								{steps.map((step) => (
									<div key={step} className="flex items-center gap-2">
										<CheckCircle2 className="size-4 text-primary" />
										{step}
									</div>
								))}
							</div>
						</div>

						<Card className="border shadow-sm">
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-base">
									<MessageSquare className="size-4 text-primary" />
									Workspace preview
								</CardTitle>
								<CardDescription>
									A compact flow from incoming message to automated response.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-2">
									{steps.map((step, index) => (
										<div
											key={step}
											className="flex items-center gap-3 border bg-muted/30 p-3"
										>
											<span className="flex size-7 items-center justify-center border bg-background font-medium text-xs">
												{index + 1}
											</span>
											<p className="font-medium text-sm">{step}</p>
										</div>
									))}
								</div>
								<div className="flex items-center justify-between border bg-background px-3 py-2">
									<div>
										<p className="font-medium text-sm">API connection</p>
										{healthCheck.isLoading ? (
											<Skeleton className="mt-2 h-3 w-36" />
										) : (
											<p className="text-muted-foreground text-xs">
												{healthCheck.data || "No response"}
											</p>
										)}
									</div>
									<span
										className={cn(
											"size-2.5 rounded-full",
											healthCheck.data ? "bg-green-500" : "bg-muted-foreground",
										)}
									/>
								</div>
							</CardContent>
						</Card>
					</div>
				</section>

				<section id="features" className="mx-auto max-w-6xl px-4 py-14 md:px-6">
					<div className="mb-8 max-w-2xl space-y-2">
						<h2 className="font-semibold text-3xl tracking-tight">
							A practical bot workspace
						</h2>
						<p className="text-muted-foreground text-sm leading-6">
							The dashboard keeps device management, flow design, and monitoring
							in one place.
						</p>
					</div>
					<div className="grid gap-4 md:grid-cols-3">
						{features.map(({ icon: Icon, title, description }) => (
							<Card key={title} className="border shadow-sm">
								<CardHeader>
									<span className="mb-2 flex size-9 items-center justify-center border bg-muted">
										<Icon className="size-4 text-primary" />
									</span>
									<CardTitle>{title}</CardTitle>
									<CardDescription>{description}</CardDescription>
								</CardHeader>
							</Card>
						))}
					</div>
				</section>

				<section id="workflow" className="border-y bg-muted/20">
					<div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-[0.8fr_1.2fr] md:items-center md:px-6">
						<div className="space-y-2">
							<h2 className="font-semibold text-3xl tracking-tight">
								From message to response
							</h2>
							<p className="text-muted-foreground text-sm leading-6">
								Flows start from a trigger, can wait for a contact reply, and
								finish by sending WhatsApp messages from the connected device.
							</p>
						</div>
						<div className="grid gap-3 sm:grid-cols-3">
							{steps.map((step) => (
								<Card key={step} className="border bg-background shadow-sm">
									<CardHeader>
										<CardTitle className="text-sm">{step}</CardTitle>
									</CardHeader>
								</Card>
							))}
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}
