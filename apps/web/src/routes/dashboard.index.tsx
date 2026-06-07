import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/")({
	component: DashboardOverview,
});

function DashboardOverview() {
	const trpc = useTRPC();
	const { data } = useSuspenseQuery(trpc.healthCheck.queryOptions());

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			<Card>
				<CardHeader>
					<CardTitle>Server Status</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">{data}</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Quick Start</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">
						Add a WhatsApp device from the Devices page, then create a flow to
						automate your messaging.
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
