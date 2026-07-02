import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@whatsapp-flow/ui/components/card";
import { Input } from "@whatsapp-flow/ui/components/input";
import { ScrollArea } from "@whatsapp-flow/ui/components/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@whatsapp-flow/ui/components/tabs";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	CheckCheck,
	Clock3,
	Inbox,
	MessageSquare,
	MoreHorizontal,
	Search,
	Smartphone,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useInboxSSE } from "@/hooks/use-inbox-sse";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/inbox")({
	validateSearch: z.object({
		thread: z.string().optional(),
	}),
	component: InboxPage,
});

type ThreadRow = {
	id: string;
	deviceId: string;
	contactNumber: string;
	contactName: string | null;
	lastMessageText: string | null;
	lastMessageAt: string;
	unreadCount: number;
};

function getInitials(name: string | null, fallback: string) {
	return (
		name
			?.split(/\s+/)
			.slice(0, 2)
			.map((word) => word[0])
			.join("")
			.toUpperCase() || fallback.slice(0, 2)
	);
}

function formatTime(dateStr: string) {
	const d = new Date(dateStr);
	const now = new Date();
	const isToday = d.toDateString() === now.toDateString();
	if (isToday) {
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function ThreadList({
	threads,
	selectedId,
	onSelect,
}: {
	threads: ThreadRow[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	const [search, setSearch] = useState("");

	const filtered = useMemo(() => {
		if (!search) return threads;
		const q = search.toLowerCase();
		return threads.filter(
			(thread) =>
				thread.contactNumber.includes(q) ||
				thread.contactName?.toLowerCase().includes(q) ||
				thread.lastMessageText?.toLowerCase().includes(q),
		);
	}, [search, threads]);

	if (threads.length === 0) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<MessageSquare className="size-10 text-muted-foreground/40" />
				<div>
					<p className="font-medium text-sm">No conversations yet</p>
					<p className="text-muted-foreground text-xs">
						Incoming WhatsApp messages will appear here.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="space-y-3 border-b p-4">
				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="font-semibold text-sm">Conversations</p>
						<p className="text-muted-foreground text-xs">
							{threads.length} active threads
						</p>
					</div>
					<Badge variant="secondary" className="h-5 px-2 text-[10px]">
						Live
					</Badge>
				</div>
				<div className="relative">
					<Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Search conversations..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="h-8 pl-8 text-xs"
					/>
				</div>
			</div>

			<ScrollArea className="flex-1">
				<div className="p-2">
					{filtered.map((thread) => (
						<Button
							key={thread.id}
							type="button"
							variant="ghost"
							className={cn(
								"h-auto w-full justify-start gap-3 rounded-lg px-2.5 py-2.5 text-left text-xs hover:bg-muted",
								selectedId === thread.id && "bg-muted ring-1 ring-border",
							)}
							onClick={() => onSelect(thread.id)}
						>
							<span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background font-medium text-xs shadow-xs">
								{getInitials(thread.contactName, thread.contactNumber)}
							</span>
							<span className="min-w-0 flex-1 space-y-1">
								<span className="flex items-center justify-between gap-2">
									<span className="truncate font-medium">
										{thread.contactName ?? thread.contactNumber}
									</span>
									<span className="shrink-0 text-[10px] text-muted-foreground">
										{formatTime(thread.lastMessageAt)}
									</span>
								</span>
								<span className="flex items-center justify-between gap-2">
									<span className="truncate text-muted-foreground">
										{thread.lastMessageText ?? "No messages"}
									</span>
									{thread.unreadCount > 0 && (
										<Badge className="h-4 min-w-4 px-1 text-[9px]">
											{thread.unreadCount}
										</Badge>
									)}
								</span>
							</span>
						</Button>
					))}
				</div>
			</ScrollArea>
		</div>
	);
}

function ThreadHeader({ thread }: { thread: ThreadRow }) {
	return (
		<div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4">
			<div className="flex min-w-0 items-center gap-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted font-medium text-xs">
					{getInitials(thread.contactName, thread.contactNumber)}
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold text-sm">
						{thread.contactName ?? thread.contactNumber}
					</p>
					<p className="truncate text-muted-foreground text-xs">
						{thread.contactNumber}
					</p>
				</div>
			</div>
			<Button variant="ghost" size="icon-sm" aria-label="Thread actions">
				<MoreHorizontal className="size-4" />
			</Button>
		</div>
	);
}

function ThreadView({ thread }: { thread: ThreadRow }) {
	const trpc = useTRPC();
	const { data: messages } = useSuspenseQuery(
		trpc.inbox.messages.queryOptions({ threadId: thread.id }),
	);
	const { mutate: markRead } = useMutation(
		trpc.inbox.markRead.mutationOptions(),
	);
	const markedThreadId = useRef<string | null>(null);

	useEffect(() => {
		if (thread.unreadCount > 0 && markedThreadId.current !== thread.id) {
			markedThreadId.current = thread.id;
			markRead({ id: thread.id });
		}
	}, [thread.unreadCount, thread.id, markRead]);

	if (messages.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center p-8 text-center">
				<div>
					<MessageSquare className="mx-auto mb-3 size-10 text-muted-foreground/30" />
					<p className="font-medium text-sm">No messages yet</p>
					<p className="text-muted-foreground text-xs">
						This thread is ready for the first message.
					</p>
				</div>
			</div>
		);
	}

	return (
		<ScrollArea className="flex-1 bg-muted/20">
			<div className="flex flex-col gap-2 p-4">
				{messages.map((msg) => (
					<div
						key={msg.id}
						className={cn(
							"flex",
							msg.direction === "outbound" ? "justify-end" : "justify-start",
						)}
					>
						<div
							className={cn(
								"max-w-[72%] rounded-xl border px-3 py-2 text-xs shadow-xs",
								msg.direction === "outbound"
									? "rounded-br-sm bg-primary text-primary-foreground"
									: "rounded-bl-sm bg-card",
							)}
						>
							<p className="whitespace-pre-wrap leading-relaxed">
								{msg.text ?? `[${msg.messageType}]`}
							</p>
							<p
								className={cn(
									"mt-1 text-[10px]",
									msg.direction === "outbound"
										? "text-primary-foreground/70"
										: "text-muted-foreground",
								)}
							>
								{formatTime(msg.createdAt.toString())}
							</p>
						</div>
					</div>
				))}
			</div>
		</ScrollArea>
	);
}

function ThreadDetails({ thread }: { thread: ThreadRow }) {
	const details = [
		{ label: "Phone", value: thread.contactNumber, icon: Inbox },
		{ label: "Device", value: thread.deviceId, icon: Smartphone },
		{
			label: "Last message",
			value: formatTime(thread.lastMessageAt),
			icon: Clock3,
		},
	];

	return (
		<Card className="h-full rounded-none border-0 bg-card/80 py-0 ring-0">
			<CardHeader className="border-b px-4 py-4">
				<CardTitle className="text-sm">Thread details</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4 p-4">
				<div className="flex flex-col items-center rounded-xl border bg-background p-4 text-center">
					<div className="mb-3 flex size-12 items-center justify-center rounded-xl border bg-muted font-semibold text-sm">
						{getInitials(thread.contactName, thread.contactNumber)}
					</div>
					<p className="font-semibold text-sm">
						{thread.contactName ?? thread.contactNumber}
					</p>
					<p className="text-muted-foreground text-xs">WhatsApp contact</p>
				</div>

				<div className="space-y-2">
					{details.map(({ label, value, icon: Icon }) => (
						<div
							key={label}
							className="flex items-start gap-3 rounded-lg border bg-background p-3"
						>
							<Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
									{label}
								</p>
								<p className="truncate font-medium text-xs">{value}</p>
							</div>
						</div>
					))}
				</div>

				<Button
					variant="outline"
					size="sm"
					className="w-full justify-start text-xs"
				>
					<CheckCheck className="size-3.5" />
					Marked as read
				</Button>
			</CardContent>
		</Card>
	);
}

function EmptyThread() {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<div className="flex size-12 items-center justify-center rounded-2xl border bg-muted">
				<MessageSquare className="size-6 text-muted-foreground/50" />
			</div>
			<div>
				<p className="font-medium text-sm">Select a conversation</p>
				<p className="max-w-xs text-muted-foreground text-xs">
					Open a thread to read messages and inspect contact metadata.
				</p>
			</div>
		</div>
	);
}

function InboxPage() {
	const trpc = useTRPC();
	const { thread: threadFromUrl } = Route.useSearch();
	const { data: threads } = useSuspenseQuery(trpc.inbox.list.queryOptions({}));
	const [selectedId, setSelectedId] = useState<string | null>(
		threadFromUrl ?? null,
	);
	useInboxSSE();

	useEffect(() => {
		if (threadFromUrl) setSelectedId(threadFromUrl);
	}, [threadFromUrl]);

	const typedThreads = threads as ThreadRow[];
	const selectedThread = selectedId
		? typedThreads.find((thread) => thread.id === selectedId)
		: null;

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-5">
				<div>
					<div className="flex items-center gap-2">
						<h1 className="font-semibold text-sm">Inbox</h1>
						<Badge variant="outline" className="h-5 px-2 text-[10px]">
							{typedThreads.reduce(
								(total, thread) => total + thread.unreadCount,
								0,
							)}{" "}
							unread
						</Badge>
					</div>
					<p className="text-muted-foreground text-xs">
						Monitor WhatsApp conversations captured from connected devices.
					</p>
				</div>
				<Tabs defaultValue="all">
					<TabsList className="hidden h-8 md:inline-flex">
						<TabsTrigger value="all" className="px-3 text-xs">
							All
						</TabsTrigger>
						<TabsTrigger value="unread" className="px-3 text-xs">
							Unread
						</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_280px] overflow-hidden bg-muted/30">
				<Card className="rounded-none border-0 border-r bg-card/80 py-0 ring-0">
					<CardContent className="flex h-full min-h-0 flex-col p-0">
						<ThreadList
							threads={typedThreads}
							selectedId={selectedId}
							onSelect={setSelectedId}
						/>
					</CardContent>
				</Card>

				<Card className="flex min-w-0 rounded-none border-0 bg-card py-0 ring-0">
					<CardContent className="flex min-h-0 flex-1 flex-col p-0">
						{selectedThread ? (
							<>
								<ThreadHeader thread={selectedThread} />
								<ThreadView thread={selectedThread} />
							</>
						) : (
							<EmptyThread />
						)}
					</CardContent>
				</Card>

				<div className="min-h-0 border-l bg-card/80">
					{selectedThread ? (
						<ThreadDetails thread={selectedThread} />
					) : (
						<div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-xs">
							Contact details appear after selecting a thread.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
