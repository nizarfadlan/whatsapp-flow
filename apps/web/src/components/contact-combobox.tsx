import { useQuery } from "@tanstack/react-query";
import { Button } from "@whatsapp-flow/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@whatsapp-flow/ui/components/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@whatsapp-flow/ui/components/popover";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useTRPC } from "@/utils/trpc";

interface ContactComboboxProps {
	/** The selected JID or phone number */
	value?: string;
	onChange: (jid: string) => void;
	deviceId?: string;
	placeholder?: string;
	className?: string;
	/** Include groups as well as personal contacts */
	includeGroups?: boolean;
}

export function ContactCombobox({
	value,
	onChange,
	deviceId,
	placeholder = "Select contact...",
	className,
	includeGroups = false,
}: ContactComboboxProps) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const { data: contacts = [] } = useQuery(
		trpc.contact.list.queryOptions({
			deviceId,
			search: search || undefined,
			limit: 50,
		}),
	);

	const { data: groups = [] } = useQuery({
		...trpc.group.list.queryOptions({
			deviceId,
			search: search || undefined,
			limit: 30,
		}),
		enabled: includeGroups,
	});

	type Option = { label: string; sub: string; value: string };

	const options: Option[] = [
		...contacts.map((c) => ({
			label: c.name ?? c.pushName ?? c.phoneNumber ?? c.jid,
			sub: c.phoneNumber ?? c.jid,
			value: c.jid,
		})),
		...(includeGroups
			? groups.map((g) => ({
					label: g.subject,
					sub: g.jid,
					value: g.jid,
				}))
			: []),
	];

	const selected = options.find((o) => o.value === value);
	const displayLabel = selected ? selected.label : value || placeholder;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="outline"
						role="combobox"
						aria-expanded={open}
						className={cn(
							"h-7 w-full justify-between px-2 font-normal text-xs",
							!selected && !value && "text-muted-foreground",
							className,
						)}
					/>
				}
			>
				<span className="min-w-0 flex-1 truncate text-left">
					{displayLabel}
				</span>
				<ChevronsUpDown className="ml-1 size-3 shrink-0 text-muted-foreground" />
			</PopoverTrigger>
			<PopoverContent className="w-60 p-0" align="start">
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search..."
						value={search}
						onValueChange={setSearch}
						className="h-8 text-xs"
					/>
					<CommandList>
						<CommandEmpty className="py-4 text-center text-muted-foreground text-xs">
							No contacts found
						</CommandEmpty>
						{contacts.length > 0 && (
							<CommandGroup heading="Contacts">
								{contacts.map((c) => (
									<CommandItem
										key={c.jid}
										value={c.jid}
										onSelect={() => {
											onChange(c.jid);
											setOpen(false);
											setSearch("");
										}}
										className="text-xs"
									>
										<Check
											className={cn(
												"mr-1.5 size-3",
												value === c.jid ? "opacity-100" : "opacity-0",
											)}
										/>
										<span className="min-w-0 flex-1 truncate">
											{c.name ?? c.pushName ?? c.phoneNumber ?? c.jid}
										</span>
										<span className="text-[10px] text-muted-foreground">
											{c.phoneNumber}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
						{includeGroups && groups.length > 0 && (
							<CommandGroup heading="Groups">
								{groups.map((g) => (
									<CommandItem
										key={g.jid}
										value={g.jid}
										onSelect={() => {
											onChange(g.jid);
											setOpen(false);
											setSearch("");
										}}
										className="text-xs"
									>
										<Check
											className={cn(
												"mr-1.5 size-3",
												value === g.jid ? "opacity-100" : "opacity-0",
											)}
										/>
										<span className="min-w-0 flex-1 truncate">{g.subject}</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
