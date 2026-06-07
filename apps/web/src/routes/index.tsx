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
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	Activity,
	ArrowRight,
	Bot,
	CheckCircle2,
	GitBranch,
	Play,
	Smartphone,
	Zap,
} from "lucide-react";

import Header from "@/components/header";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

const features = [
	{
		icon: Smartphone,
		title: "Connect WhatsApp devices",
		description:
			"Pair a number with QR auth and keep sessions restored from storage.",
	},
	{
		icon: GitBranch,
		title: "Design visual flows",
		description:
			"Compose triggers, replies, waits, and actions in a node builder.",
	},
	{
		icon: Activity,
		title: "Monitor every run",
		description:
			"Trace executions, statuses, trigger sources, and runtime output.",
	},
] as const;

const workflow = ["Trigger", "Match contact", "Run nodes", "Wait or reply"];

function HomeComponent() {
	const trpc = useTRPC();
	const healthCheck = useQuery(trpc.healthCheck.queryOptions());
	const isConnected = Boolean(healthCheck.data);

	return (
		<div className="min-h-svh bg-background">
			<Header />
			<main>
				<section className="relative overflow-hidden border-border/70 border-b">
					<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_34%),linear-gradient(180deg,hsl(var(--muted)/0.7),transparent)]" />
					<div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
						<div className="space-y-6">
							<Badge variant="secondary" className="gap-1.5 text-[10px]">
								<Bot className="size-3" />
								Baileys-powered automation builder
							</Badge>
							<div className="space-y-4">
								<h1 className="max-w-3xl font-semibold text-4xl tracking-tight md:text-6xl">
									Build WhatsApp bot flows without wiring runtime code.
								</h1>
								<p className="max-w-2xl text-muted-foreground text-sm leading-6 md:text-base">
									Connect a WhatsApp device, drag flow nodes, deploy triggers,
									and monitor conversations from one clean workspace.
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Link
									to="/dashboard"
									className={cn(buttonVariants({ size: "lg" }))}
								>
									Open Dashboard
									<ArrowRight className="size-4" />
								</Link>
								<Link
									to="/login"
									className={cn(
										buttonVariants({ variant: "outline", size: "lg" }),
									)}
								>
									Sign In
								</Link>
							</div>
							<div className="grid max-w-xl gap-2 text-muted-foreground text-xs sm:grid-cols-3">
								<Proof label="Session-safe replies" />
								<Proof label="Visual node editor" />
								<Proof label="Execution logs" />
							</div>
						</div>

						<Card className="border-primary/20 bg-card/80 shadow-sm backdrop-blur">
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Play className="size-4 text-primary" />
									Live runtime preview
								</CardTitle>
								<CardDescription>
									A simple flow from incoming message to WhatsApp response.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-2">
									{workflow.map((step, index) => (
										<div
											key={step}
											className="flex items-center gap-3 border bg-muted/35 p-3"
										>
											<span className="flex size-7 items-center justify-center border bg-background font-medium text-[10px]">
												{index + 1}
											</span>
											<div className="min-w-0 flex-1">
												<p className="font-medium text-xs">{step}</p>
												<p className="text-[10px] text-muted-foreground">
													{index === 0
														? "Any message or keyword starts the automation."
														: "Runtime keeps contact context isolated per device."}
												</p>
											</div>
											<CheckCircle2 className="size-4 text-primary" />
										</div>
									))}
								</div>
								<div className="flex items-center justify-between border bg-background px-3 py-2">
									<div>
										<p className="font-medium text-xs">API connection</p>
										<p className="text-[10px] text-muted-foreground">
											{healthCheck.isLoading
												? "Checking backend availability"
												: healthCheck.data || "No response"}
										</p>
									</div>
									<span
										className={cn(
											"size-2.5 rounded-full",
											isConnected ? "bg-green-500" : "bg-red-500",
										)}
									/>
								</div>
							</CardContent>
						</Card>
					</div>
				</section>

				<section id="features" className="mx-auto max-w-6xl px-4 py-14 md:px-6">
					<div className="mb-8 max-w-2xl space-y-2">
						<Badge variant="outline" className="text-[10px]">
							Features
						</Badge>
						<h2 className="font-semibold text-2xl tracking-tight md:text-3xl">
							Everything needed for a bot workspace.
						</h2>
					</div>
					<div className="grid gap-4 md:grid-cols-3">
						{features.map(({ icon: Icon, title, description }) => (
							<Card key={title} className="bg-card/70">
								<CardHeader>
									<span className="flex size-9 items-center justify-center border bg-primary/10 text-primary">
										<Icon className="size-4" />
									</span>
									<CardTitle className="text-base">{title}</CardTitle>
									<CardDescription>{description}</CardDescription>
								</CardHeader>
							</Card>
						))}
					</div>
				</section>

				<section
					id="workflow"
					className="border-border/70 border-y bg-muted/20"
				>
					<div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-[0.8fr_1.2fr] md:items-center md:px-6">
						<div className="space-y-2">
							<Badge variant="outline" className="text-[10px]">
								Workflow
							</Badge>
							<h2 className="font-semibold text-2xl tracking-tight md:text-3xl">
								From message to response.
							</h2>
							<p className="text-muted-foreground text-sm leading-6">
								Flows start from a trigger, can wait for a specific user's
								reply, and finish by sending WhatsApp messages from the
								connected device.
							</p>
						</div>
						<div className="grid gap-2 sm:grid-cols-4">
							{workflow.map((step) => (
								<div key={step} className="border bg-background p-4">
									<Zap className="mb-4 size-4 text-primary" />
									<p className="font-medium text-sm">{step}</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section id="runtime" className="mx-auto max-w-6xl px-4 py-14 md:px-6">
					<Card className="bg-card/70">
						<CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
							<div className="space-y-1">
								<h2 className="font-semibold text-xl tracking-tight">
									Ready to manage your automation?
								</h2>
								<p className="text-muted-foreground text-sm">
									Open the dashboard to connect devices, create flows, and
									review logs.
								</p>
							</div>
							<Link to="/dashboard" className={cn(buttonVariants())}>
								Launch workspace
								<ArrowRight className="size-4" />
							</Link>
						</CardContent>
					</Card>
				</section>
			</main>
		</div>
	);
}

function Proof({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-2">
			<CheckCircle2 className="size-3.5 text-primary" />
			{label}
		</div>
	);
}
