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
	Bot,
	GitBranch,
	MessageSquare,
	Smartphone,
} from "lucide-react";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

function HomeComponent() {
	const trpc = useTRPC();
	const healthCheck = useQuery(trpc.healthCheck.queryOptions());
	const isConnected = Boolean(healthCheck.data);

	return (
		<main className="min-h-full bg-muted/20">
			<section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 md:px-6 md:py-16">
				<div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
					<div className="space-y-5">
						<Badge variant="secondary" className="gap-1.5 text-[10px]">
							<Bot className="size-3" />
							Baileys-powered flow builder
						</Badge>
						<div className="space-y-3">
							<h1 className="max-w-3xl font-semibold text-4xl tracking-tight md:text-5xl">
								Build WhatsApp bots from visual flow nodes.
							</h1>
							<p className="max-w-2xl text-muted-foreground text-sm leading-6 md:text-base">
								Connect a WhatsApp device, compose triggers and actions, then
								deploy the automation without writing bot code.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<Link
								to="/dashboard"
								className={cn(buttonVariants({ size: "lg" }))}
							>
								Open Dashboard
							</Link>
							<Link
								to="/dashboard/flows"
								className={cn(
									buttonVariants({ variant: "outline", size: "lg" }),
								)}
							>
								View Flows
							</Link>
						</div>
					</div>

					<Card className="border-primary/20 bg-card/80 shadow-sm">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Activity className="size-4 text-primary" />
								System status
							</CardTitle>
							<CardDescription>
								Live API health from the backend.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center justify-between border bg-muted/40 px-3 py-2">
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
							<div className="grid gap-2 sm:grid-cols-3">
								<StatusStep icon={Smartphone} label="Connect" />
								<StatusStep icon={GitBranch} label="Design" />
								<StatusStep icon={MessageSquare} label="Deploy" />
							</div>
						</CardContent>
					</Card>
				</div>
			</section>
		</main>
	);
}

function StatusStep({
	icon: Icon,
	label,
}: {
	icon: typeof Smartphone;
	label: string;
}) {
	return (
		<div className="flex items-center gap-2 border bg-background px-3 py-2 text-xs">
			<Icon className="size-3.5 text-primary" />
			{label}
		</div>
	);
}
