import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/dashboard/")({
	loader: async ({ context }) => {
		const organizations = (
			await context.queryClient.ensureQueryData(
				context.trpc.organization.listMine.queryOptions(),
			)
		).map((organization) => {
			if (!organization.slug) {
				throw new Error("Organization is missing a slug");
			}

			return { ...organization, slug: organization.slug };
		});

		if (organizations.length === 1) {
			throw redirect({
				to: "/dashboard/$organizationSlug",
				params: { organizationSlug: organizations[0].slug },
			});
		}

		return { organizations };
	},
	component: OrganizationPickerPage,
});

function OrganizationPickerPage() {
	const { organizations } = Route.useLoaderData();

	return (
		<div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
			<Card className="w-full max-w-lg">
				<CardHeader>
					<div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<Building2 className="size-5" />
					</div>
					<CardTitle>Select an organization</CardTitle>
					<CardDescription>
						Choose the organization you want to manage.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{organizations.length === 0 ? (
						<div className="rounded-lg border border-dashed p-6 text-center">
							<p className="font-medium text-sm">No organizations available</p>
							<p className="mt-1 text-muted-foreground text-sm">
								Ask an organization administrator to add you as a member.
							</p>
						</div>
					) : (
						<div className="space-y-2">
							{organizations.map((organization) => (
								<Button
									key={organization.id}
									variant="outline"
									className="h-auto w-full justify-start px-4 py-3 text-left"
									render={
										<Link
											to="/dashboard/$organizationSlug"
											params={{ organizationSlug: organization.slug }}
										/>
									}
								>
									<span className="flex min-w-0 flex-col gap-0.5">
										<span className="truncate font-medium">
											{organization.name}
										</span>
										<span className="truncate text-muted-foreground text-xs">
											{organization.slug}
										</span>
									</span>
								</Button>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
