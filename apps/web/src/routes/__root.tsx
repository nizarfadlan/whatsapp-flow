import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@whatsapp-flow/api/routers/index";
import { Toaster } from "@whatsapp-flow/ui/components/sonner";
import { useEffect } from "react";

import { useTRPC } from "@/utils/trpc";
import appCss from "../index.css?url";
export interface RouterAppContext {
	trpc: TRPCOptionsProxy<AppRouter>;
	queryClient: QueryClient;
}

const DEFAULT_APP_NAME = "WhatsApp Flow";
const BRAND_FAVICON_ID = "brand-favicon";
const THEME_VARIABLES = [
	"--primary",
	"--primary-foreground",
	"--ring",
	"--sidebar-primary",
	"--sidebar-primary-foreground",
	"--sidebar-ring",
] as const;

function parseHexColor(value?: string | null) {
	if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) return null;
	return value;
}

function toLinearChannel(value: number) {
	const channel = value / 255;
	return channel <= 0.03928
		? channel / 12.92
		: ((channel + 0.055) / 1.055) ** 2.4;
}

function getReadableForeground(hex: string) {
	const r = toLinearChannel(Number.parseInt(hex.slice(1, 3), 16));
	const g = toLinearChannel(Number.parseInt(hex.slice(3, 5), 16));
	const b = toLinearChannel(Number.parseInt(hex.slice(5, 7), 16));
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

	return luminance > 0.55 ? "#111827" : "#ffffff";
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "WhatsApp Flow",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),

	component: RootDocument,
});

function BrandingRuntime() {
	const trpc = useTRPC();
	const { data: publicSettings } = useQuery(
		trpc.settings.public.queryOptions(),
	);
	const branding = publicSettings?.branding;
	const appName = branding?.appName?.trim() || DEFAULT_APP_NAME;
	const faviconUrl = branding?.faviconUrl?.trim();
	const primaryColor = branding?.primaryColor?.trim();

	useEffect(() => {
		document.title = appName;
	}, [appName]);

	useEffect(() => {
		const existing = document.querySelector<HTMLLinkElement>(
			`link#${BRAND_FAVICON_ID}`,
		);

		if (!faviconUrl) {
			existing?.remove();
			return;
		}

		const link = existing ?? document.createElement("link");
		link.id = BRAND_FAVICON_ID;
		link.rel = "icon";
		link.href = faviconUrl;
		if (!existing) document.head.appendChild(link);
	}, [faviconUrl]);

	useEffect(() => {
		const root = document.documentElement;
		const hexColor = parseHexColor(primaryColor);

		if (!hexColor) {
			for (const variable of THEME_VARIABLES)
				root.style.removeProperty(variable);
			return;
		}

		const foreground = getReadableForeground(hexColor);
		root.style.setProperty("--primary", hexColor);
		root.style.setProperty("--primary-foreground", foreground);
		root.style.setProperty("--ring", hexColor);
		root.style.setProperty("--sidebar-primary", hexColor);
		root.style.setProperty("--sidebar-primary-foreground", foreground);
		root.style.setProperty("--sidebar-ring", hexColor);
	}, [primaryColor]);

	return null;
}

function RootDocument() {
	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				<BrandingRuntime />
				<div className="min-h-svh">
					<Outlet />
				</div>
				<Toaster richColors />
				<TanStackRouterDevtools position="bottom-left" />
				<ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
				<Scripts />
			</body>
		</html>
	);
}
