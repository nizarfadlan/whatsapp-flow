import { Link, useLocation } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarSeparator,
} from "@whatsapp-flow/ui/components/sidebar";
import {
	Activity,
	Bot,
	Inbox,
	LayoutDashboard,
	MessageSquare,
	Plus,
	Smartphone,
	Users,
	UsersRound,
	Webhook,
} from "lucide-react";

const navItems = [
	{ to: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
	{
		to: "/dashboard/devices",
		label: "Devices",
		icon: Smartphone,
		exact: false,
	},
	{ to: "/dashboard/flows", label: "Flows", icon: MessageSquare, exact: false },
	{ to: "/dashboard/inbox", label: "Inbox", icon: Inbox, exact: false },
	{ to: "/dashboard/contacts", label: "Contacts", icon: Users, exact: false },
	{ to: "/dashboard/groups", label: "Groups", icon: UsersRound, exact: false },
	{ to: "/dashboard/logs", label: "Logs", icon: Activity, exact: false },
	{ to: "/dashboard/webhooks", label: "Webhooks", icon: Webhook, exact: false },
] as const;

function Brand() {
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<SidebarMenuButton
					size="lg"
					render={<Link to="/" />}
					className="h-12 gap-3 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
					tooltip="WhatsApp Flow"
				>
					<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
						<Bot className="size-4" />
					</span>
					<span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
						<span className="block truncate font-semibold text-sm">
							WhatsApp Flow
						</span>
						<span className="block truncate text-sidebar-foreground/60 text-xs">
							Automation builder
						</span>
					</span>
				</SidebarMenuButton>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

function SidebarNav() {
	const location = useLocation();

	return (
		<SidebarMenu>
			{navItems.map(({ to, label, icon: Icon, exact }) => {
				const active = exact
					? location.pathname === to
					: location.pathname === to || location.pathname.startsWith(`${to}/`);

				return (
					<SidebarMenuItem key={to}>
						<SidebarMenuButton
							render={<Link to={to} />}
							isActive={active}
							tooltip={label}
						>
							<Icon />
							<span>{label}</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				);
			})}
		</SidebarMenu>
	);
}

export function DashboardSidebar({ className }: { className?: string }) {
	return (
		<Sidebar collapsible="icon" variant="inset" className={className}>
			<SidebarHeader>
				<Brand />
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton
									render={<Link to="/dashboard/flows/new" />}
									variant="outline"
									tooltip="New Flow"
								>
									<Plus />
									<span>New Flow</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarGroup>
					<SidebarGroupLabel>Workspace</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarNav />
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<SidebarSeparator />
				<div className="rounded-lg border bg-card p-3 text-card-foreground group-data-[collapsible=icon]:hidden">
					<div className="mb-2 flex items-center justify-between gap-2">
						<p className="font-medium text-xs">Runtime</p>
						<Badge variant="secondary" className="text-xs">
							Live
						</Badge>
					</div>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Connect a device, build a flow, then deploy it to respond from your
						WhatsApp number.
					</p>
				</div>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

export default DashboardSidebar;
