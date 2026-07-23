import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { useActiveOrganization } from "@/components/active-organization";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/$organizationSlug/flows/new")({
	component: NewFlowPage,
});

function NewFlowPage() {
	const organization = useActiveOrganization();
	const trpc = useTRPC();
	const navigate = useNavigate();

	const createMut = useMutation(
		trpc.flow.create.mutationOptions({
			onSuccess: (data) => {
				toast.success("Flow created");
				navigate({
					to: "/dashboard/$organizationSlug/flows/$flowId",
					params: { organizationSlug: organization.slug, flowId: data.id },
				});
			},
			onError: () => {
				toast.error("Failed to create flow");
				navigate({
					to: "/dashboard/$organizationSlug/flows",
					params: { organizationSlug: organization.slug },
				});
			},
		}),
	);

	useEffect(() => {
		createMut.mutate({ name: "Untitled Flow", tenantId: organization.id });
	}, [createMut.mutate, organization.id]);

	return (
		<div className="flex items-center justify-center py-20">
			<div className="flex flex-col items-center gap-3">
				<Loader2 className="size-8 animate-spin text-muted-foreground" />
				<p className="text-muted-foreground text-sm">Creating flow...</p>
			</div>
		</div>
	);
}
