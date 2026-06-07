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
import { Activity, Bot, MessageSquare, Plus, Smartphone } from "lucide-react";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/")({
	component: DashboardOverview,
});

function DashboardOverview() {
	const trpc = useTRPC();
	const { data } = useSuspenseQuery(trpc.healthCheck.queryOptions());

	return (
		<div className="space-y-4">
			<div className="grid gap-4 md:grid-cols-3">
				<Card className="border-primary/20 bg-primary/5 md:col-span-2">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<Bot className="size-4 text-primary" />
							Build WhatsApp automations visually
						</CardTitle>
						<CardDescription>
							Connect a Baileys device, design the flow with nodes, then deploy
							it to handle incoming messages.
						</CardDescription>
						<CardAction>
							<Badge variant="secondary" className="text-[10px]">
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

				<Card>
					<CardHeader>
						<CardTitle>Server Status</CardTitle>
						<CardDescription>Current API health response.</CardDescription>
						<CardAction>
							<span className="flex size-8 items-center justify-center border bg-green-500/10 text-green-600">
								<Activity className="size-4" />
							</span>
						</CardAction>
					</CardHeader>
					<CardContent>
						<p className="font-medium text-sm">{data}</p>
					</CardContent>
				</Card>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<Card size="sm">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Smartphone className="size-4 text-primary" />
							Devices
						</CardTitle>
						<CardDescription>
							Register WhatsApp sessions and monitor QR status.
						</CardDescription>
					</CardHeader>
				</Card>
				<Card size="sm">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<MessageSquare className="size-4 text-primary" />
							Flows
						</CardTitle>
						<CardDescription>
							Compose triggers, messages, logic, and actions.
						</CardDescription>
					</CardHeader>
				</Card>
				<Card size="sm">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Activity className="size-4 text-primary" />
							Logs
						</CardTitle>
						<CardDescription>
							Review executions and delivery behavior.
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		</div>
	);
}
