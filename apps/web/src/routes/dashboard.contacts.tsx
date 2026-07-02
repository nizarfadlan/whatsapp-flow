import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@whatsapp-flow/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@whatsapp-flow/ui/components/dropdown-menu";
import { Input } from "@whatsapp-flow/ui/components/input";
import { MoreHorizontal, Plus, Search, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { DataTable } from "@/components/data-table";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/contacts")({
	validateSearch: z.object({
		search: z.string().optional(),
	}),
	component: ContactsPage,
});

function ContactsPage() {
	const trpc = useTRPC();
	const { search: searchFromUrl } = Route.useSearch();
	const [search, setSearch] = useState(searchFromUrl ?? "");
	const [addOpen, setAddOpen] = useState(false);
	const [newPhone, setNewPhone] = useState("");
	const [newName, setNewName] = useState("");

	const { data: contacts = [], refetch } = useSuspenseQuery(
		trpc.contact.list.queryOptions({ search: search || undefined, limit: 100 }),
	);

	useEffect(() => {
		if (searchFromUrl) setSearch(searchFromUrl);
	}, [searchFromUrl]);

	const addMut = useMutation(
		trpc.contact.create.mutationOptions({
			onSuccess: () => {
				setAddOpen(false);
				setNewPhone("");
				setNewName("");
				toast.success("Contact added");
				refetch();
			},
			onError: (e) => toast.error(e.message ?? "Failed to add contact"),
		}),
	);

	const deleteMut = useMutation(
		trpc.contact.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Contact deleted");
				refetch();
			},
			onError: (e) => toast.error(e.message ?? "Failed to delete contact"),
		}),
	);

	const columns = [
		{
			key: "name",
			header: "Name",
			cell: (row: (typeof contacts)[0]) => (
				<div className="flex flex-col">
					<span className="font-medium text-xs">
						{row.name ?? row.pushName ?? "—"}
					</span>
					{row.pushName && row.name && row.pushName !== row.name && (
						<span className="text-[10px] text-muted-foreground">
							{row.pushName}
						</span>
					)}
				</div>
			),
		},
		{
			key: "phoneNumber",
			header: "Phone",
			cell: (row: (typeof contacts)[0]) => (
				<span className="text-xs">{row.phoneNumber ?? row.jid}</span>
			),
		},
		{
			key: "source",
			header: "Source",
			cell: (row: (typeof contacts)[0]) => (
				<Badge variant="outline" className="h-4 px-1 text-[9px]">
					{row.source}
				</Badge>
			),
		},
		{
			key: "isWaContact",
			header: "WA",
			cell: (row: (typeof contacts)[0]) => (
				<Badge
					variant={row.isWaContact ? "default" : "secondary"}
					className="h-4 px-1 text-[9px]"
				>
					{row.isWaContact ? "✓" : "—"}
				</Badge>
			),
		},
		{
			key: "actions",
			header: "",
			cell: (row: (typeof contacts)[0]) => (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon-xs" className="size-6">
							<MoreHorizontal className="size-3.5" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							className="text-destructive"
							onClick={() => deleteMut.mutate({ id: row.id })}
						>
							<Trash2 className="size-3.5" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	];

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-base">Contacts</h1>
					<p className="text-muted-foreground text-xs">
						{contacts.length} contacts · synced from your WhatsApp devices
					</p>
				</div>
				<Dialog open={addOpen} onOpenChange={setAddOpen}>
					<DialogTrigger asChild>
						<Button size="sm" className="h-7 gap-1.5 text-xs">
							<Plus className="size-3.5" />
							Add Contact
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Add Contact</DialogTitle>
							<DialogDescription>
								Manually add a WhatsApp contact by phone number.
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-1">
								<label className="font-medium text-xs" htmlFor="contact-phone">
									Phone Number *
								</label>
								<Input
									id="contact-phone"
									placeholder="6281234567890"
									value={newPhone}
									onChange={(e) => setNewPhone(e.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="font-medium text-xs" htmlFor="contact-name">
									Name
								</label>
								<Input
									id="contact-name"
									placeholder="John Doe"
									value={newName}
									onChange={(e) => setNewName(e.target.value)}
								/>
							</div>
						</div>
						<DialogFooter>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setAddOpen(false)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								disabled={!newPhone.trim() || addMut.isPending}
								onClick={() =>
									addMut.mutate({
										phoneNumber: newPhone.trim(),
										name: newName.trim() || undefined,
									})
								}
							>
								{addMut.isPending ? "Adding..." : "Add"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			<div className="relative max-w-xs">
				<Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="h-8 pl-8 text-xs"
					placeholder="Search contacts..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			</div>

			{contacts.length === 0 ? (
				<div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
					<Users className="size-8 opacity-30" />
					<p className="text-xs">
						{search
							? "No contacts found"
							: "No contacts yet — connect a device to sync"}
					</p>
				</div>
			) : (
				<DataTable
					data={contacts}
					columns={columns}
					getRowKey={(row) => row.id}
				/>
			)}
		</div>
	);
}
