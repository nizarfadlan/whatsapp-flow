import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Badge } from "@whatsapp-flow/ui/components/badge";
import { Button } from "@whatsapp-flow/ui/components/button";
import { Input } from "@whatsapp-flow/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@whatsapp-flow/ui/components/popover";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";

type Tag = { id: string; name: string };

export function TagBadges({ tags }: { tags: Tag[] }) {
	if (tags.length === 0)
		return <span className="text-[10px] text-muted-foreground">—</span>;
	return (
		<div className="flex flex-wrap gap-1">
			{tags.map((tag) => (
				<Badge key={tag.id} variant="secondary" className="h-4 px-1 text-[9px]">
					{tag.name}
				</Badge>
			))}
		</div>
	);
}

export function TagPicker({
	resourceId,
	tags,
	resource,
	onSaved,
}: {
	resourceId: string;
	tags: Tag[];
	resource: "contact" | "group";
	onSaved: () => void;
}) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [newName, setNewName] = useState("");
	const { data: availableTags = [], refetch } = useSuspenseQuery(
		trpc.contact.listTags.queryOptions(),
	);
	const setTags = useMutation(
		(resource === "contact"
			? trpc.contact.setTags.mutationOptions()
			: trpc.group.setTags.mutationOptions()) as never,
	);
	const createTag = useMutation(
		trpc.contact.createTag.mutationOptions({
			onSuccess: () => {
				setNewName("");
				refetch();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const serverSelectedIds = tags.map((tag) => tag.id);
	const serverSelectionKey = `${resourceId}:${serverSelectedIds.join(",")}`;
	const [selectedIds, setSelectedIds] = useState(serverSelectedIds);
	const serverSelectionRef = useRef(serverSelectionKey);

	useEffect(() => {
		if (
			setTags.isPending ||
			serverSelectionRef.current === serverSelectionKey
		) {
			return;
		}
		serverSelectionRef.current = serverSelectionKey;
		setSelectedIds(serverSelectedIds);
	}, [serverSelectedIds, serverSelectionKey, setTags.isPending]);

	const update = (tagIds: string[]) => {
		if (setTags.isPending) return;
		setSelectedIds(tagIds);
		setTags.mutate(
			(resource === "contact"
				? { contactId: resourceId, tagIds }
				: { groupId: resourceId, tagIds }) as never,
			{
				onSuccess: () => onSaved(),
				onError: (error: Error) => {
					setSelectedIds(serverSelectedIds);
					toast.error(error.message);
				},
			},
		);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						variant="ghost"
						size="icon-xs"
						className="size-6"
						aria-label="Manage tags"
					/>
				}
			>
				<Plus className="size-3" />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-52 p-2">
				<div className="mb-2 flex gap-1">
					<Input
						className="h-7 text-xs"
						placeholder="New tag"
						value={newName}
						onChange={(event) => setNewName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && newName.trim()) {
								createTag.mutate({ name: newName.trim() });
							}
						}}
					/>
					<Button
						type="button"
						size="xs"
						disabled={!newName.trim() || createTag.isPending}
						onClick={() => createTag.mutate({ name: newName.trim() })}
					>
						Add
					</Button>
				</div>
				<div className="flex max-h-48 flex-col overflow-y-auto">
					{availableTags.map((tag) => {
						const selected = selectedIds.includes(tag.id);
						return (
							<Button
								key={tag.id}
								type="button"
								variant="ghost"
								className="h-7 justify-start text-xs"
								disabled={setTags.isPending}
								onClick={() =>
									update(
										selected
											? selectedIds.filter((id) => id !== tag.id)
											: [...selectedIds, tag.id],
									)
								}
							>
								{selected ? (
									<X className="size-3" />
								) : (
									<Plus className="size-3" />
								)}
								{tag.name}
							</Button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
