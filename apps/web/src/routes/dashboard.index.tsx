import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { buttonVariants } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardAction,
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
	MessageSquare,
	Plus,
	Smartphone,
} from "lucide-react";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/")({
	component: DashboardOverview,
});

const sections = [
	{
		icon: Smartphone,
		title: "Devices",
		description: "Register WhatsApp sessions and monitor connection status.",
		to: "/dashboard/devices",
	},
	{
		icon: MessageSquare,
		title: "Flows",
		description: "Compose triggers, messages, logic, and actions.",
		to: "/dashboard/flows",
	},
	{
		icon: Activity,
		title: "Logs",
		description: "Review executions and delivery behavior.",
		to: "/dashboard/logs",
	},
] as const;

function DashboardOverview() {
	const trpc = useTRPC();
	const { data } = useSuspenseQuery(trpc.healthCheck.queryOptions());

	return (
		<div className="space-y-6">
			<div className="space-y-1">
				<h2 className="font-semibold text-2xl tracking-tight">Overview</h2>
				<p className="text-muted-foreground text-sm">
					Manage your WhatsApp automation workspace.
				</p>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				{sections.map(({ icon: Icon, title, description, to }) => (
					<Link key={title} to={to} className="group">
						<Card className="h-full border bg-card shadow-sm transition-colors group-hover:bg-muted/40">
							<CardHeader>
								<div className="mb-2 flex size-9 items-center justify-center border bg-muted">
									<Icon className="size-4 text-primary" />
								</div>
								<CardTitle>{title}</CardTitle>
								<CardDescription>{description}</CardDescription>
							</CardHeader>
						</Card>
					</Link>
				))}
			</div>

			<div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
				<Card className="border bg-card shadow-sm">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<Bot className="size-4 text-primary" />
							Build WhatsApp automations visually
						</CardTitle>
						<CardDescription>
							Connect a device, design the flow with nodes, then deploy it to
							handle incoming messages.
						</CardDescription>
						<CardAction>
							<Badge variant="secondary" className="text-xs">
								Ready
							</Badge>
						</CardAction>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-2">
						<Link
							to="/dashboard/flows/new"
							className={cn(buttonVariants({ size: "sm" }))}
						>
							<Plus className="size-3.5" />
							Create Flow
						</Link>
						<Link
							to="/dashboard/devices"
							className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
						>
							<Smartphone className="size-3.5" />
							Connect Device
						</Link>
					</CardContent>
				</Card>

				<Card className="border bg-card shadow-sm">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<Activity className="size-4 text-primary" />
							Server status
						</CardTitle>
						<CardDescription>Current API health response.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="border bg-muted/30 px-3 py-2">
							<p className="font-medium text-sm">{data}</p>
						</div>
						<Link
							to="/dashboard/logs"
							className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
						>
							View runtime logs
							<ArrowRight className="size-3.5" />
						</Link>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
