import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@whatsapp-flow/ui/components/alert-dialog";
import { Avatar, AvatarFallback } from "@whatsapp-flow/ui/components/avatar";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@whatsapp-flow/ui/components/dropdown-menu";
import { Input } from "@whatsapp-flow/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@whatsapp-flow/ui/components/native-select";
import { Skeleton } from "@whatsapp-flow/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@whatsapp-flow/ui/components/table";
import { Textarea } from "@whatsapp-flow/ui/components/textarea";
import { MoreHorizontal, ShieldCheck, UserCog, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/users")({
	component: UsersPage,
});

type RoleFilter = "all" | "admin" | "member";
type StatusFilter = "all" | "active" | "suspended";
type UserAction =
	| { type: "role"; userId: string; name: string; role: "admin" | "member" }
	| { type: "sessions"; userId: string; name: string }
	| { type: "suspend"; userId: string; name: string }
	| { type: "reactivate"; userId: string; name: string };

type AdminUser = {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image?: string | null;
	role: "admin" | "member";
	status: "active" | "suspended";
	suspendedAt?: Date | string | null;
	suspensionReason?: string | null;
	createdAt: Date | string;
	sessionCount: number;
	accountCount: number;
	isCurrentUser: boolean;
};

function getInitials(name?: string | null, email?: string | null) {
	const value = name || email || "User";
	return value
		.split(" ")
		.slice(0, 2)
		.map((part) => part.charAt(0))
		.join("")
		.toUpperCase();
}

function roleBadgeVariant(role: AdminUser["role"]) {
	return role === "admin" ? "default" : "secondary";
}

function statusBadgeVariant(status: AdminUser["status"]) {
	return status === "active" ? "secondary" : "destructive";
}

function actionTitle(action: UserAction | null) {
	if (!action) return "Confirm action";
	if (action.type === "sessions") return "Revoke user sessions?";
	if (action.type === "suspend") return "Suspend user account?";
	if (action.type === "reactivate") return "Reactivate user account?";
	return action.role === "admin"
		? "Promote user to admin?"
		: "Demote admin to member?";
}

function actionDescription(action: UserAction | null) {
	if (!action) return "";
	if (action.type === "sessions") {
		return `This will sign ${action.name} out of all active sessions. They can sign in again if their account remains valid.`;
	}
	if (action.type === "suspend") {
		return `This will block ${action.name} from dashboard access and revoke all active sessions. A reason is required for the audit log.`;
	}
	if (action.type === "reactivate") {
		return `${action.name} will regain access and their suspension metadata will be cleared.`;
	}
	if (action.role === "admin") {
		return `${action.name} will gain access to admin settings, enterprise audit, and user management.`;
	}
	return `${action.name} will lose admin access and become a regular member.`;
}

function UsersPage() {
	const trpc = useTRPC();
	const [query, setQuery] = useState("");
	const [role, setRole] = useState<RoleFilter>("all");
	const [status, setStatus] = useState<StatusFilter>("all");
	const [pendingAction, setPendingAction] = useState<UserAction | null>(null);
	const [reason, setReason] = useState("");
	const listInput = useMemo(
		() => ({
			query: query.trim() || undefined,
			role,
			status,
			limit: 50,
			offset: 0,
		}),
		[query, role, status],
	);
	const usersQuery = useQuery(trpc.user.list.queryOptions(listInput));
	const updateRole = useMutation(
		trpc.user.updateRole.mutationOptions({
			onSuccess: () => {
				toast.success("User role updated");
				setPendingAction(null);
				usersQuery.refetch();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const revokeSessions = useMutation(
		trpc.user.revokeSessions.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					result.revoked > 0
						? `Revoked ${result.revoked} session${result.revoked === 1 ? "" : "s"}`
						: "No active sessions to revoke",
				);
				setPendingAction(null);
				usersQuery.refetch();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const suspendUser = useMutation(
		trpc.user.suspend.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					`User suspended${result.revoked > 0 ? ` and ${result.revoked} session${result.revoked === 1 ? "" : "s"} revoked` : ""}`,
				);
				setPendingAction(null);
				setReason("");
				usersQuery.refetch();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const reactivateUser = useMutation(
		trpc.user.reactivate.mutationOptions({
			onSuccess: () => {
				toast.success("User reactivated");
				setPendingAction(null);
				setReason("");
				usersQuery.refetch();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const users = usersQuery.data?.users ?? [];
	const actionPending =
		updateRole.isPending ||
		revokeSessions.isPending ||
		suspendUser.isPending ||
		reactivateUser.isPending;
	const reasonRequired = pendingAction?.type === "suspend";
	const confirmDisabled =
		actionPending || (reasonRequired && reason.trim().length === 0);

	const openAction = (action: UserAction) => {
		setReason("");
		setPendingAction(action);
	};

	const confirmAction = () => {
		if (!pendingAction) return;
		if (pendingAction.type === "sessions") {
			revokeSessions.mutate({ userId: pendingAction.userId });
			return;
		}
		if (pendingAction.type === "suspend") {
			suspendUser.mutate({
				userId: pendingAction.userId,
				reason: reason.trim(),
			});
			return;
		}
		if (pendingAction.type === "reactivate") {
			reactivateUser.mutate({
				userId: pendingAction.userId,
				reason: reason.trim() || undefined,
			});
			return;
		}
		updateRole.mutate({
			userId: pendingAction.userId,
			role: pendingAction.role,
		});
	};

	if (usersQuery.error) {
		return (
			<div className="space-y-2">
				<h2 className="font-semibold text-xl">Users unavailable</h2>
				<p className="text-muted-foreground text-sm">
					{usersQuery.error.message === "Admin access required"
						? "You do not have access to user management."
						: usersQuery.error.message}
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1">
					<h2 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
						<UsersRound className="size-6 text-primary" />
						Users
					</h2>
					<p className="text-muted-foreground text-sm">
						Manage dashboard users, administrator access, suspensions, and
						active sessions.
					</p>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<UserCog className="size-5" />
						User management
					</CardTitle>
					<CardDescription>
						Role and suspension changes are audit logged. Destructive account
						deletion is intentionally not available here.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<Input
							className="lg:max-w-sm"
							placeholder="Search by name or email"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
						<div className="grid gap-3 sm:grid-cols-2">
							<NativeSelect
								value={role}
								onChange={(event) => setRole(event.target.value as RoleFilter)}
							>
								<NativeSelectOption value="all">All roles</NativeSelectOption>
								<NativeSelectOption value="admin">Admins</NativeSelectOption>
								<NativeSelectOption value="member">Members</NativeSelectOption>
							</NativeSelect>
							<NativeSelect
								value={status}
								onChange={(event) =>
									setStatus(event.target.value as StatusFilter)
								}
							>
								<NativeSelectOption value="all">
									All statuses
								</NativeSelectOption>
								<NativeSelectOption value="active">Active</NativeSelectOption>
								<NativeSelectOption value="suspended">
									Suspended
								</NativeSelectOption>
							</NativeSelect>
						</div>
					</div>

					{usersQuery.isPending ? (
						<div className="space-y-2">
							<Skeleton className="h-10" />
							<Skeleton className="h-10" />
							<Skeleton className="h-10" />
						</div>
					) : (
						<div className="rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>User</TableHead>
										<TableHead>Role</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Email</TableHead>
										<TableHead>Sessions</TableHead>
										<TableHead>Accounts</TableHead>
										<TableHead>Created</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{users.map((user) => (
										<TableRow key={user.id}>
											<TableCell>
												<div className="flex items-center gap-3">
													<Avatar className="size-9 border bg-background">
														<AvatarFallback>
															{getInitials(user.name, user.email)}
														</AvatarFallback>
													</Avatar>
													<div className="min-w-0">
														<p className="truncate font-medium">
															{user.name || "Unnamed user"}
															{user.isCurrentUser && (
																<span className="ml-2 text-muted-foreground text-xs">
																	You
																</span>
															)}
														</p>
														<p className="truncate text-muted-foreground text-xs">
															{user.email}
														</p>
													</div>
												</div>
											</TableCell>
											<TableCell>
												<Badge variant={roleBadgeVariant(user.role)}>
													{user.role}
												</Badge>
											</TableCell>
											<TableCell>
												<div className="space-y-1">
													<Badge variant={statusBadgeVariant(user.status)}>
														{user.status}
													</Badge>
													{user.suspendedAt && (
														<p className="text-muted-foreground text-xs">
															Since{" "}
															{new Date(user.suspendedAt).toLocaleDateString()}
														</p>
													)}
												</div>
											</TableCell>
											<TableCell>
												{user.emailVerified ? (
													<Badge variant="secondary">Verified</Badge>
												) : (
													<Badge variant="outline">Unverified</Badge>
												)}
											</TableCell>
											<TableCell>{user.sessionCount}</TableCell>
											<TableCell>{user.accountCount}</TableCell>
											<TableCell className="text-muted-foreground text-sm">
												{new Date(user.createdAt).toLocaleDateString()}
											</TableCell>
											<TableCell className="text-right">
												<DropdownMenu>
													<DropdownMenuTrigger
														render={
															<Button
																variant="ghost"
																size="icon-xs"
																className="size-7"
															/>
														}
													>
														<MoreHorizontal className="size-4" />
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														{user.role === "admin" ? (
															<DropdownMenuItem
																disabled={user.isCurrentUser}
																onClick={() =>
																	openAction({
																		type: "role",
																		userId: user.id,
																		name: user.name || user.email,
																		role: "member",
																	})
																}
															>
																Demote to member
															</DropdownMenuItem>
														) : (
															<DropdownMenuItem
																onClick={() =>
																	openAction({
																		type: "role",
																		userId: user.id,
																		name: user.name || user.email,
																		role: "admin",
																	})
																}
															>
																Promote to admin
															</DropdownMenuItem>
														)}
														<DropdownMenuItem
															disabled={user.isCurrentUser}
															onClick={() =>
																openAction({
																	type: "sessions",
																	userId: user.id,
																	name: user.name || user.email,
																})
															}
														>
															Revoke sessions
														</DropdownMenuItem>
														{user.status === "suspended" ? (
															<DropdownMenuItem
																onClick={() =>
																	openAction({
																		type: "reactivate",
																		userId: user.id,
																		name: user.name || user.email,
																	})
																}
															>
																Reactivate
															</DropdownMenuItem>
														) : (
															<DropdownMenuItem
																disabled={user.isCurrentUser}
																onClick={() =>
																	openAction({
																		type: "suspend",
																		userId: user.id,
																		name: user.name || user.email,
																	})
																}
															>
																Suspend
															</DropdownMenuItem>
														)}
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
									))}
									{users.length === 0 && (
										<TableRow>
											<TableCell colSpan={8}>
												<div className="py-8 text-center text-muted-foreground text-sm">
													No users match the current filters.
												</div>
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</div>
					)}

					<div className="flex items-center justify-between text-muted-foreground text-xs">
						<span>{usersQuery.data?.total ?? 0} total users</span>
						<span>Showing up to 50 users</span>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<ShieldCheck className="size-5" />
						Production safety notes
					</CardTitle>
					<CardDescription>
						User management now favors reversible controls with audit evidence.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ul className="list-disc space-y-2 pl-5 text-muted-foreground text-sm">
						<li>
							User deletion is disabled because auth and product data may
							cascade.
						</li>
						<li>
							Suspension revokes sessions and blocks protected tRPC plus
							authenticated server routes.
						</li>
						<li>
							Role changes, session revocations, suspensions, and reactivations
							are written to the immutable audit log.
						</li>
					</ul>
				</CardContent>
			</Card>

			<AlertDialog
				open={Boolean(pendingAction)}
				onOpenChange={(open) => {
					if (!open && !actionPending) {
						setPendingAction(null);
						setReason("");
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{actionTitle(pendingAction)}</AlertDialogTitle>
						<AlertDialogDescription>
							{actionDescription(pendingAction)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					{(pendingAction?.type === "suspend" ||
						pendingAction?.type === "reactivate") && (
						<Textarea
							placeholder={
								pendingAction.type === "suspend"
									? "Reason for suspension"
									: "Optional reason for reactivation"
							}
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							maxLength={500}
						/>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={actionPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={confirmDisabled}
							onClick={confirmAction}
						>
							{actionPending ? "Working..." : "Confirm"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
