import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import { Checkbox } from "@whatsapp-flow/ui/components/checkbox";
import { Input } from "@whatsapp-flow/ui/components/input";
import { Label } from "@whatsapp-flow/ui/components/label";
import { ScrollArea } from "@whatsapp-flow/ui/components/scroll-area";
import { Textarea } from "@whatsapp-flow/ui/components/textarea";
import { ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/roles")({
	component: RolesPage,
});

type RoleRow = {
	id: string;
	key: string;
	name: string;
	description?: string | null;
	isSystem: boolean;
	permissions: string[];
};

function RolesPage() {
	const trpc = useTRPC();
	const rolesQuery = useQuery(trpc.rbac.listRoles.queryOptions());
	const permissionsQuery = useQuery(trpc.rbac.listPermissions.queryOptions());
	const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
	const [newRole, setNewRole] = useState({
		key: "",
		name: "",
		description: "",
	});
	const [permissionOverrides, setPermissionOverrides] = useState<
		Record<string, string[]>
	>({});
	const roles = rolesQuery.data ?? [];
	const permissions = permissionsQuery.data ?? [];
	const selectedRole = useMemo<RoleRow | null>(
		() => roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null,
		[roles, selectedRoleId],
	);
	const selectedPermissions = selectedRole
		? (permissionOverrides[selectedRole.id] ?? selectedRole.permissions)
		: [];
	const selectedPermissionSet = useMemo(
		() => new Set(selectedPermissions),
		[selectedPermissions],
	);
	const permissionGroups = useMemo(() => {
		const groups = new Map<
			string,
			Array<{ key: string; category: string; description: string }>
		>();
		for (const permission of permissions) {
			const list = groups.get(permission.category) ?? [];
			list.push(permission);
			groups.set(permission.category, list);
		}
		return [...groups.entries()];
	}, [permissions]);

	const createRole = useMutation(
		trpc.rbac.createRole.mutationOptions({
			onSuccess: () => {
				toast.success("Role created");
				setNewRole({ key: "", name: "", description: "" });
				rolesQuery.refetch();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const setPermissions = useMutation(
		trpc.rbac.setRolePermissions.mutationOptions({
			onSuccess: (_result, variables) => {
				toast.success("Role permissions updated");
				void rolesQuery.refetch().then(() => {
					setPermissionOverrides((current) => {
						const next = { ...current };
						delete next[variables.roleId];
						return next;
					});
				});
			},
			onError: (error, variables) => {
				setPermissionOverrides((current) => {
					const next = { ...current };
					delete next[variables.roleId];
					return next;
				});
				toast.error(error.message);
			},
		}),
	);

	const togglePermission = (permissionKey: string, checked: boolean) => {
		if (!selectedRole || selectedRole.isSystem) return;
		const next = new Set(selectedPermissions);
		if (checked) next.add(permissionKey);
		else next.delete(permissionKey);
		const permissions = [...next];
		setPermissionOverrides((current) => ({
			...current,
			[selectedRole.id]: permissions,
		}));
		setPermissions.mutate({
			roleId: selectedRole.id,
			permissions: permissions as never,
		});
	};

	if (rolesQuery.error || permissionsQuery.error) {
		return (
			<div className="space-y-2">
				<h2 className="font-semibold text-xl">Roles unavailable</h2>
				<p className="text-muted-foreground text-sm">
					{rolesQuery.error?.message ?? permissionsQuery.error?.message}
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="space-y-1">
				<h2 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
					<ShieldCheck className="size-6 text-primary" />
					Roles & Permissions
				</h2>
				<p className="text-muted-foreground text-sm">
					Create roles and assign granular permissions for enterprise access
					control.
				</p>
			</div>

			<div className="grid gap-6 lg:grid-cols-[360px_1fr]">
				<div className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Create role</CardTitle>
							<CardDescription>
								Custom roles can combine any permission set.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="space-y-1">
								<Label htmlFor="role-key">Key</Label>
								<Input
									id="role-key"
									placeholder="support_lead"
									value={newRole.key}
									onChange={(event) =>
										setNewRole((current) => ({
											...current,
											key: event.target.value,
										}))
									}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="role-name">Name</Label>
								<Input
									id="role-name"
									placeholder="Support lead"
									value={newRole.name}
									onChange={(event) =>
										setNewRole((current) => ({
											...current,
											name: event.target.value,
										}))
									}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="role-description">Description</Label>
								<Textarea
									id="role-description"
									value={newRole.description}
									onChange={(event) =>
										setNewRole((current) => ({
											...current,
											description: event.target.value,
										}))
									}
								/>
							</div>
							<Button
								type="button"
								disabled={createRole.isPending || !newRole.key || !newRole.name}
								onClick={() => createRole.mutate(newRole)}
							>
								Create role
							</Button>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Roles</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							{roles.map((role) => (
								<button
									key={role.id}
									type="button"
									className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedRole?.id === role.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
									onClick={() => setSelectedRoleId(role.id)}
								>
									<div className="flex items-center justify-between gap-2">
										<p className="font-medium text-sm">{role.name}</p>
										{role.isSystem && <Badge variant="secondary">System</Badge>}
									</div>
									<p className="text-muted-foreground text-xs">{role.key}</p>
								</button>
							))}
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>{selectedRole?.name ?? "Select a role"}</CardTitle>
						<CardDescription>
							{selectedRole?.isSystem
								? "System role permissions are managed by the application and cannot be changed here. Create a custom role for editable permissions."
								: (selectedRole?.description ??
									"Choose a role to edit its permissions.")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ScrollArea className="h-[620px] pr-4">
							<div className="space-y-6">
								{permissionGroups.map(([category, items]) => (
									<div key={category} className="space-y-3">
										<h3 className="font-medium text-sm">{category}</h3>
										<div className="grid gap-2 md:grid-cols-2">
											{items.map((permission) => (
												<div
													key={permission.key}
													className={`flex items-start gap-3 rounded-lg border p-3 ${selectedRole?.isSystem ? "bg-muted/30 opacity-60" : ""}`}
												>
													<Checkbox
														aria-label={`Toggle ${permission.key}`}
														checked={selectedPermissionSet.has(permission.key)}
														disabled={
															!selectedRole ||
															selectedRole.isSystem ||
															setPermissions.isPending
														}
														onCheckedChange={(checked) =>
															togglePermission(permission.key, checked === true)
														}
													/>
													<span className="space-y-1">
														<span className="block font-medium text-sm">
															{permission.key}
														</span>
														<span className="block text-muted-foreground text-xs">
															{permission.description}
														</span>
													</span>
												</div>
											))}
										</div>
									</div>
								))}
							</div>
						</ScrollArea>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
