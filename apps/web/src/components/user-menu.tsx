import { Link, useNavigate } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@whatsapp-flow/ui/components/avatar";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@whatsapp-flow/ui/components/dropdown-menu";
import { Skeleton } from "@whatsapp-flow/ui/components/skeleton";
import { LogOut, User } from "lucide-react";

import { useActiveOrganization } from "@/components/active-organization";
import { authClient } from "@/lib/auth-client";

function getInitials(name?: string | null, email?: string | null) {
	const value = name || email || "User";
	return value
		.split(" ")
		.slice(0, 2)
		.map((part) => part.charAt(0))
		.join("")
		.toUpperCase();
}

export default function UserMenu() {
	const organization = useActiveOrganization();
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return <Skeleton className="h-9 w-28" />;
	}

	if (!session) {
		return (
			<Link to="/login">
				<Button variant="outline">Sign In</Button>
			</Link>
		);
	}

	const initials = getInitials(session.user.name, session.user.email);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button variant="ghost" className="h-10 gap-2 px-2" />}
			>
				<Avatar className="size-7 border bg-muted">
					<AvatarFallback>{initials}</AvatarFallback>
				</Avatar>
				<span className="hidden max-w-28 truncate text-xs md:inline">
					{session.user.name}
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="min-w-56 bg-card" align="end">
				<DropdownMenuGroup>
					<DropdownMenuLabel className="flex items-center gap-2">
						<Avatar className="size-8 border bg-muted">
							<AvatarFallback>{initials}</AvatarFallback>
						</Avatar>
						<span className="min-w-0">
							<span className="block truncate font-medium text-xs">
								{session.user.name}
							</span>
							<span className="block truncate text-[10px] text-muted-foreground">
								{session.user.email}
							</span>
						</span>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						render={
							<Link
								to="/dashboard/$organizationSlug/account"
								params={{ organizationSlug: organization.slug }}
							/>
						}
					>
						<User className="size-3.5" />
						Account
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onClick={() => {
							authClient.signOut({
								fetchOptions: {
									onSuccess: () => {
										navigate({ to: "/" });
									},
								},
							});
						}}
					>
						<LogOut className="size-3.5" />
						Sign Out
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
