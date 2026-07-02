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
	EmojiPicker,
	EmojiPickerContent,
	EmojiPickerFooter,
	EmojiPickerSearch,
} from "@whatsapp-flow/ui/components/emoji-picker";
import { Input } from "@whatsapp-flow/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@whatsapp-flow/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@whatsapp-flow/ui/components/select";
import { Separator } from "@whatsapp-flow/ui/components/separator";
import { Textarea } from "@whatsapp-flow/ui/components/textarea";
import type { Edge, Node } from "@xyflow/react";
import { Copy, Plus, RefreshCw, Smile, Trash2, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ContactCombobox } from "./contact-combobox";
import type {
	ActionNodeData,
	FlowNodeData,
	InteractiveNodeData,
	LogicNodeData,
	MessageNodeData,
	TriggerNodeData,
} from "./flow-nodes";
import { MediaUpload } from "./media-upload";

interface NodeConfigPanelProps {
	node: Node | null;
	flowId: string;
	/** All flow nodes, used to extract variable names for autocomplete. */
	allNodes?: Node[];
	edges?: Edge[];
	onUpdate: (id: string, data: Partial<FlowNodeData>) => void;
	onDelete: (id: string) => void;
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-[10px] text-muted-foreground">{label}</span>
			{children}
		</div>
	);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
	return <h4 className="font-medium text-[10px]">{children}</h4>;
}

function TriggerKeywordConfig({
	data,
	onUpdate,
}: {
	data: TriggerNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<Field label="Keyword">
			<Input
				className="h-7 text-xs"
				placeholder="e.g. hello"
				value={data.keyword ?? ""}
				onChange={(e) => onUpdate({ keyword: e.target.value })}
			/>
		</Field>
	);
}

function TriggerWebhookConfig({
	data,
	flowId,
	onUpdate,
}: {
	data: TriggerNodeData;
	flowId: string;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	const token = data.webhookToken ?? "";
	const endpoint = `/api/flows/${flowId}/webhook?token=${token || "WEBHOOK_TOKEN"}`;
	const regenerateToken = () => onUpdate({ webhookToken: crypto.randomUUID() });
	const copyEndpoint = () => navigator.clipboard.writeText(endpoint);

	return (
		<div className="flex flex-col gap-2">
			<Field label="Webhook Endpoint">
				<div className="flex gap-1">
					<Input className="h-7 text-xs" readOnly value={endpoint} />
					<Button
						className="h-7 px-2"
						size="sm"
						variant="outline"
						onClick={copyEndpoint}
					>
						<Copy className="size-3" />
					</Button>
				</div>
			</Field>
			<Field label="Secret Token">
				<div className="flex gap-1">
					<Input className="h-7 text-xs" readOnly value={token} />
					<Button
						className="h-7 px-2"
						size="sm"
						variant="outline"
						onClick={regenerateToken}
					>
						<RefreshCw className="size-3" />
					</Button>
				</div>
			</Field>
			<p className="text-[10px] text-muted-foreground">
				Send POST JSON with contactNumber and optional text/message fields.
			</p>
		</div>
	);
}

function TriggerScheduleConfig({
	data,
	onUpdate,
}: {
	data: TriggerNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<>
			<Field label="Cron Expression">
				<Input
					className="h-7 text-xs"
					placeholder="*/5 * * * *"
					value={data.cronExpression ?? ""}
					onChange={(e) => onUpdate({ cronExpression: e.target.value })}
				/>
				<p className="text-[10px] text-muted-foreground">
					Use 5 fields: minute hour day month weekday. Supports *, lists,
					ranges, and steps.
				</p>
			</Field>
			<Field label="Recipient Number">
				<Input
					className="h-7 text-xs"
					placeholder="6281234567890"
					value={data.contactNumber ?? ""}
					onChange={(e) => onUpdate({ contactNumber: e.target.value })}
				/>
			</Field>
		</>
	);
}

function getUpstreamNodeIds(
	currentNodeId?: string,
	edges?: Edge[],
): Set<string> {
	const upstream = new Set<string>();
	const queue = currentNodeId ? [currentNodeId] : [];

	while (queue.length > 0) {
		const target = queue.shift();
		for (const edge of edges ?? []) {
			if (edge.target !== target || upstream.has(edge.source)) continue;
			upstream.add(edge.source);
			queue.push(edge.source);
		}
	}

	return upstream;
}

function getFlowVariables(
	allNodes?: Node[],
	edges?: Edge[],
	currentNodeId?: string,
): string[] {
	const vars = new Set(["contact.number", "message.text"]);
	const upstreamNodeIds = getUpstreamNodeIds(currentNodeId, edges);

	for (const node of allNodes ?? []) {
		if (!upstreamNodeIds.has(node.id)) continue;

		const data = node.data as Record<string, unknown>;
		if (
			(data.nodeType === "set-variable" ||
				data.nodeType === "wait-for-reply") &&
			typeof data.variableName === "string" &&
			data.variableName.trim()
		) {
			vars.add(`variables.${data.variableName.trim()}`);
		}
	}

	return Array.from(vars);
}

function getVariableMeta(variable: string) {
	if (variable === "contact.number") {
		return {
			label: "Contact number",
			description: "Sender phone number",
		};
	}

	if (variable === "message.text") {
		return {
			label: "Message text",
			description: "Incoming message text",
		};
	}

	if (variable.startsWith("variables.")) {
		return {
			label: variable.slice("variables.".length),
			description: "Flow variable",
		};
	}

	return {
		label: variable,
		description: "Variable",
	};
}

function SendTextConfig({
	data,
	onUpdate,
	allNodes,
	edges,
	currentNodeId,
}: {
	data: MessageNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
	allNodes?: Node[];
	edges?: Edge[];
	currentNodeId?: string;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [showVars, setShowVars] = useState(false);
	const [varQuery, setVarQuery] = useState("");

	const flowVars = getFlowVariables(allNodes, edges, currentNodeId);

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const value = e.target.value;
			onUpdate({ text: value });

			const cursorPos = e.target.selectionStart ?? 0;
			const textBeforeCursor = value.slice(0, cursorPos);
			const match = textBeforeCursor.match(/\{\{([\w.]*)$/);
			if (match) {
				setVarQuery(match[1] ?? "");
				setShowVars(true);
			} else {
				setShowVars(false);
			}
		},
		[onUpdate],
	);

	const insertVariable = useCallback(
		(variable: string) => {
			const textarea = textareaRef.current;
			if (!textarea) return;

			const value = data.text ?? "";
			const cursorPos = textarea.selectionStart;
			const textBeforeCursor = value.slice(0, cursorPos);
			const match = textBeforeCursor.match(/\{\{([\w.]*)$/);
			const beforeInsert = match
				? textBeforeCursor.slice(0, match.index)
				: textBeforeCursor;
			const inserted = `{{${variable}}}`;
			const afterCursor = value.slice(cursorPos);
			const newValue = `${beforeInsert}${inserted}${afterCursor}`;

			onUpdate({ text: newValue });
			setShowVars(false);
			setVarQuery("");

			const newCursorPos = beforeInsert.length + inserted.length;
			requestAnimationFrame(() => {
				textarea.focus();
				textarea.setSelectionRange(newCursorPos, newCursorPos);
			});
		},
		[data.text, onUpdate],
	);

	const filteredVars = flowVars.filter((v) => {
		const query = varQuery.toLowerCase();
		const meta = getVariableMeta(v);
		return [v, meta.label, meta.description].some((value) =>
			value.toLowerCase().includes(query),
		);
	});

	return (
		<Field label="Text Message">
			<div className="relative">
				<Textarea
					ref={textareaRef}
					className="min-h-[64px] text-xs"
					placeholder="e.g. Hi! How can I help?\n\nUse {{variable}} to insert a value."
					value={data.text ?? ""}
					onChange={handleChange}
				/>
				<Popover
					open={showVars && filteredVars.length > 0}
					onOpenChange={setShowVars}
				>
					<PopoverTrigger
						render={
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="mt-1 h-7 w-fit text-xs"
								onClick={() => {
									setVarQuery("");
									setShowVars(true);
								}}
							/>
						}
					>
						Variables
					</PopoverTrigger>
					<PopoverContent
						className="w-56 p-0"
						align="start"
						side="bottom"
						sideOffset={4}
					>
						<Command>
							<CommandInput
								placeholder="Search variables..."
								value={varQuery}
								onValueChange={setVarQuery}
								className="h-8 text-xs"
							/>
							<CommandList>
								<CommandEmpty className="py-3 text-center text-muted-foreground text-xs">
									No variables found
								</CommandEmpty>
								<CommandGroup heading="Available Variables">
									{filteredVars.map((v) => {
										const meta = getVariableMeta(v);
										return (
											<CommandItem
												key={v}
												value={`${meta.label} ${meta.description} ${v}`}
												className="flex flex-col items-start gap-0.5 text-xs"
												onSelect={() => insertVariable(v)}
											>
												<span>{meta.label}</span>
												<span className="text-[10px] text-muted-foreground">
													{meta.description} · {`{{${v}}}`}
												</span>
											</CommandItem>
										);
									})}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			</div>
			<p className="text-[10px] text-muted-foreground">
				Use {"{{variable}}"} to insert values from context.
			</p>
		</Field>
	);
}

function MediaConfig({
	data,
	onUpdate,
}: {
	data: MessageNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	const nodeType = data.nodeType;
	const accept =
		nodeType === "send-image"
			? "image/*"
			: nodeType === "send-video"
				? "video/*"
				: "audio/*";
	return (
		<>
			<Field label="Media">
				<MediaUpload
					accept={accept}
					label="Upload or paste URL"
					value={data.mediaUrl ?? ""}
					onUploaded={(m) =>
						onUpdate({ mediaUrl: m.url, caption: data.caption })
					}
					onUrlChange={(url) => onUpdate({ mediaUrl: url })}
				/>
			</Field>
			<Field label="Caption (optional)">
				<Input
					className="h-7 text-xs"
					placeholder="Optional caption"
					value={data.caption ?? ""}
					onChange={(e) => onUpdate({ caption: e.target.value })}
				/>
			</Field>
		</>
	);
}

function DocumentConfig({
	data,
	onUpdate,
}: {
	data: MessageNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<>
			<Field label="Document">
				<MediaUpload
					accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,application/*,text/*"
					label="Upload or paste URL"
					value={data.mediaUrl ?? ""}
					onUploaded={(m) =>
						onUpdate({ mediaUrl: m.url, fileName: m.fileName })
					}
					onUrlChange={(url) => onUpdate({ mediaUrl: url })}
				/>
			</Field>
			<Field label="File Name">
				<Input
					className="h-7 text-xs"
					placeholder="document.pdf"
					value={data.fileName ?? ""}
					onChange={(e) => onUpdate({ fileName: e.target.value })}
				/>
			</Field>
		</>
	);
}

function LocationConfig({
	data,
	onUpdate,
}: {
	data: MessageNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<>
			<div className="grid grid-cols-2 gap-2">
				<Field label="Latitude">
					<Input
						className="h-7 text-xs"
						type="number"
						step="any"
						value={data.latitude ?? ""}
						onChange={(e) =>
							onUpdate({ latitude: Number.parseFloat(e.target.value) })
						}
					/>
				</Field>
				<Field label="Longitude">
					<Input
						className="h-7 text-xs"
						type="number"
						step="any"
						value={data.longitude ?? ""}
						onChange={(e) =>
							onUpdate({ longitude: Number.parseFloat(e.target.value) })
						}
					/>
				</Field>
			</div>
			<Field label="Address (optional)">
				<Input
					className="h-7 text-xs"
					placeholder="123 Main St"
					value={data.address ?? ""}
					onChange={(e) => onUpdate({ address: e.target.value })}
				/>
			</Field>
		</>
	);
}

function ReactionConfig({
	data,
	onUpdate,
}: {
	data: MessageNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	const [pickerOpen, setPickerOpen] = useState(false);

	const handleEmojiSelect = useCallback(
		(emoji: string) => {
			onUpdate({ emoji });
			setPickerOpen(false);
		},
		[onUpdate],
	);

	return (
		<Field label="Emoji">
			<Popover open={pickerOpen} onOpenChange={setPickerOpen}>
				<PopoverTrigger
					render={
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7 w-full justify-start gap-1.5 font-normal text-xs"
						/>
					}
				>
					{data.emoji ? (
						<span className="text-base leading-none">{data.emoji}</span>
					) : (
						<Smile className="size-3.5 text-muted-foreground" />
					)}
					<span className={data.emoji ? "" : "text-muted-foreground"}>
						{data.emoji ? data.emoji : "Select emoji"}
					</span>
				</PopoverTrigger>
				<PopoverContent className="h-80 w-72 p-0" align="start">
					<EmojiPicker
						className="h-full"
						onEmojiSelect={(e) => handleEmojiSelect(e.emoji)}
					>
						<EmojiPickerSearch placeholder="Search emoji..." />
						<EmojiPickerContent />
						<EmojiPickerFooter />
					</EmojiPicker>
				</PopoverContent>
			</Popover>
		</Field>
	);
}

function InteractiveButtonsConfig({
	data,
	onUpdate,
}: {
	data: InteractiveNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	const addButton = () => {
		const buttons = [...(data.buttons ?? [])];
		buttons.push({ id: `btn_${Date.now()}`, text: "" });
		onUpdate({ buttons } as Partial<FlowNodeData>);
	};
	const removeButton = (idx: number) => {
		const buttons = [...(data.buttons ?? [])];
		buttons.splice(idx, 1);
		onUpdate({ buttons } as Partial<FlowNodeData>);
	};
	const updateButton = (idx: number, text: string) => {
		const buttons = [...(data.buttons ?? [])];
		buttons[idx] = { ...buttons[idx], text };
		onUpdate({ buttons } as Partial<FlowNodeData>);
	};

	return (
		<>
			<Field label="Message Body">
				<Input
					className="h-7 text-xs"
					placeholder="Main message"
					value={data.bodyText ?? ""}
					onChange={(e) => onUpdate({ bodyText: e.target.value })}
				/>
			</Field>
			<Field label="Footer (optional)">
				<Input
					className="h-7 text-xs"
					placeholder="Footer text"
					value={data.footerText ?? ""}
					onChange={(e) => onUpdate({ footerText: e.target.value })}
				/>
			</Field>
			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between">
					<span className="text-[10px] text-muted-foreground">
						Button ({(data.buttons ?? []).length}/3)
					</span>
					{(data.buttons ?? []).length < 3 && (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							onClick={addButton}
						>
							<Plus className="size-3" />
						</Button>
					)}
				</div>
				{(data.buttons ?? []).map((btn, i) => (
					<div key={btn.id} className="flex items-center gap-1">
						<Input
							className="h-7 flex-1 text-xs"
							placeholder={`Button ${i + 1}`}
							value={btn.text}
							onChange={(e) => updateButton(i, e.target.value)}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="text-muted-foreground hover:text-destructive"
							onClick={() => removeButton(i)}
						>
							<X className="size-3" />
						</Button>
					</div>
				))}
			</div>
		</>
	);
}

function InteractiveListConfig({
	data,
	onUpdate,
}: {
	data: InteractiveNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	const addSection = () => {
		const sections = [...(data.sections ?? [])];
		sections.push({ title: "", rows: [] });
		onUpdate({ sections } as Partial<FlowNodeData>);
	};
	const removeSection = (i: number) => {
		const sections = [...(data.sections ?? [])];
		sections.splice(i, 1);
		onUpdate({ sections } as Partial<FlowNodeData>);
	};
	const updateSectionTitle = (i: number, title: string) => {
		const sections = [...(data.sections ?? [])];
		sections[i] = { ...sections[i], title };
		onUpdate({ sections } as Partial<FlowNodeData>);
	};
	const addRow = (si: number) => {
		const sections = [...(data.sections ?? [])];
		sections[si].rows.push({
			id: `row_${Date.now()}`,
			title: "",
			description: "",
		});
		onUpdate({ sections } as Partial<FlowNodeData>);
	};
	const removeRow = (si: number, ri: number) => {
		const sections = [...(data.sections ?? [])];
		sections[si].rows.splice(ri, 1);
		onUpdate({ sections } as Partial<FlowNodeData>);
	};
	const updateRow = (
		si: number,
		ri: number,
		field: "title" | "description",
		value: string,
	) => {
		const sections = [...(data.sections ?? [])];
		sections[si].rows[ri] = { ...sections[si].rows[ri], [field]: value };
		onUpdate({ sections } as Partial<FlowNodeData>);
	};

	return (
		<>
			<Field label="Message Body">
				<Input
					className="h-7 text-xs"
					placeholder="Main message"
					value={data.bodyText ?? ""}
					onChange={(e) => onUpdate({ bodyText: e.target.value })}
				/>
			</Field>
			<Field label="Footer (optional)">
				<Input
					className="h-7 text-xs"
					placeholder="Footer text"
					value={data.footerText ?? ""}
					onChange={(e) => onUpdate({ footerText: e.target.value })}
				/>
			</Field>
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between">
					<span className="text-[10px] text-muted-foreground">Sections</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={addSection}
					>
						<Plus className="size-3" />
					</Button>
				</div>
				{(data.sections ?? []).map((section, si) => (
					<div key={si} className="flex flex-col gap-1 border-l-2 pl-2">
						<div className="flex items-center gap-1">
							<Input
								className="h-7 flex-1 text-[10px]"
								placeholder="Section title"
								value={section.title}
								onChange={(e) => updateSectionTitle(si, e.target.value)}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="text-muted-foreground hover:text-destructive"
								onClick={() => removeSection(si)}
							>
								<X className="size-3" />
							</Button>
						</div>
						{section.rows.map((row, ri) => (
							<div key={row.id} className="flex flex-col gap-0.5 pl-2">
								<div className="flex items-center gap-1">
									<Input
										className="h-6 flex-1 text-[10px]"
										placeholder="Row title"
										value={row.title}
										onChange={(e) => updateRow(si, ri, "title", e.target.value)}
									/>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										className="text-muted-foreground hover:text-destructive"
										onClick={() => removeRow(si, ri)}
									>
										<X className="size-3" />
									</Button>
								</div>
								<Input
									className="h-6 text-[10px]"
									placeholder="Description (optional)"
									value={row.description ?? ""}
									onChange={(e) =>
										updateRow(si, ri, "description", e.target.value)
									}
								/>
							</div>
						))}
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className="h-6 w-fit gap-1 px-1.5 text-[10px]"
							onClick={() => addRow(si)}
						>
							<Plus className="size-2.5" /> Row
						</Button>
					</div>
				))}
			</div>
		</>
	);
}

function InteractiveQuickReplyConfig({
	data,
	onUpdate,
}: {
	data: InteractiveNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	const addButton = () => {
		const buttons = [...(data.buttons ?? [])];
		buttons.push({ id: `btn_${Date.now()}`, text: "" });
		onUpdate({ buttons } as Partial<FlowNodeData>);
	};
	const removeButton = (idx: number) => {
		const buttons = [...(data.buttons ?? [])];
		buttons.splice(idx, 1);
		onUpdate({ buttons } as Partial<FlowNodeData>);
	};
	const updateButton = (idx: number, text: string) => {
		const buttons = [...(data.buttons ?? [])];
		buttons[idx] = { ...buttons[idx], text };
		onUpdate({ buttons } as Partial<FlowNodeData>);
	};

	return (
		<>
			<Field label="Prompt Text">
				<Input
					className="h-7 text-xs"
					placeholder="Choose an option..."
					value={data.bodyText ?? ""}
					onChange={(e) => onUpdate({ bodyText: e.target.value })}
				/>
			</Field>
			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between">
					<span className="text-[10px] text-muted-foreground">Options</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={addButton}
					>
						<Plus className="size-3" />
					</Button>
				</div>
				{(data.buttons ?? []).map((btn, i) => (
					<div key={btn.id} className="flex items-center gap-1">
						<Input
							className="h-7 flex-1 text-xs"
							placeholder={`Option ${i + 1}`}
							value={btn.text}
							onChange={(e) => updateButton(i, e.target.value)}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="text-muted-foreground hover:text-destructive"
							onClick={() => removeButton(i)}
						>
							<X className="size-3" />
						</Button>
					</div>
				))}
			</div>
		</>
	);
}

function ConditionConfig({
	data,
	onUpdate,
}: {
	data: LogicNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<>
			<Field label="Field">
				<Input
					className="h-7 text-xs"
					placeholder="message.text"
					value={data.field ?? ""}
					onChange={(e) => onUpdate({ field: e.target.value })}
				/>
			</Field>
			<Field label="Operator">
				<Select
					value={data.operator ?? "contains"}
					onValueChange={(value) =>
						onUpdate({ operator: value as LogicNodeData["operator"] })
					}
				>
					<SelectTrigger className="h-7 w-full text-xs" size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="equals">equals</SelectItem>
						<SelectItem value="contains">contains</SelectItem>
						<SelectItem value="starts-with">starts with</SelectItem>
						<SelectItem value="regex">regex</SelectItem>
					</SelectContent>
				</Select>
			</Field>
			<Field label="Value">
				<Input
					className="h-7 text-xs"
					placeholder="Value to match"
					value={data.value ?? ""}
					onChange={(e) => onUpdate({ value: e.target.value })}
				/>
			</Field>
		</>
	);
}

function DelayConfig({
	data,
	onUpdate,
}: {
	data: LogicNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<Field label="Delay (seconds)">
			<Input
				className="h-7 text-xs"
				type="number"
				min={1}
				value={data.delaySeconds ?? 5}
				onChange={(e) =>
					onUpdate({ delaySeconds: Number.parseInt(e.target.value, 10) || 0 })
				}
			/>
		</Field>
	);
}

function SetVariableConfig({
	data,
	onUpdate,
}: {
	data: LogicNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<>
			<Field label="Variable Name">
				<Input
					className="h-7 text-xs"
					placeholder="myVar"
					value={data.variableName ?? ""}
					onChange={(e) => onUpdate({ variableName: e.target.value })}
				/>
			</Field>
			<Field label="Value">
				<Input
					className="h-7 text-xs"
					placeholder="Value"
					value={data.variableValue ?? ""}
					onChange={(e) => onUpdate({ variableValue: e.target.value })}
				/>
			</Field>
		</>
	);
}

function WaitForReplyConfig({
	data,
	onUpdate,
}: {
	data: LogicNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<>
			<Field label="Variable Name">
				<Input
					className="h-7 text-xs"
					placeholder="reply"
					value={data.variableName ?? "reply"}
					onChange={(e) => onUpdate({ variableName: e.target.value })}
				/>
			</Field>
			<Field label="Timeout (minutes)">
				<Input
					className="h-7 text-xs"
					min={1}
					max={10_080}
					type="number"
					value={data.timeoutMinutes ?? 1440}
					onChange={(e) =>
						onUpdate({
							timeoutMinutes: Number.parseInt(e.target.value, 10) || 1,
						})
					}
				/>
				<p className="text-[10px] text-muted-foreground">
					Pauses only for the same WhatsApp contact on the same device.
				</p>
			</Field>
		</>
	);
}

function ForwardConfig({
	data,
	onUpdate,
}: {
	data: ActionNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	const forwardData = data as ActionNodeData & { messageTemplate?: string };

	return (
		<>
			<Field label="Forward To">
				<ContactCombobox
					value={data.targetNumber ?? ""}
					onChange={(jid) => onUpdate({ targetNumber: jid })}
					includeGroups={false}
					placeholder="Select contact..."
				/>
			</Field>
			<Field label="Or enter number manually">
				<Input
					className="h-7 text-xs"
					placeholder="6281234567890"
					value={data.targetNumber ?? ""}
					onChange={(e) => onUpdate({ targetNumber: e.target.value })}
				/>
			</Field>
			<Field label="Message Template (optional)">
				<Textarea
					className="min-h-[48px] text-xs"
					placeholder="Leave empty to forward the original message"
					value={forwardData.messageTemplate ?? ""}
					onChange={(e) =>
						onUpdate({
							...data,
							messageTemplate: e.target.value,
						} as Partial<ActionNodeData>)
					}
				/>
			</Field>
		</>
	);
}

function WebhookCallConfig({
	data,
	onUpdate,
}: {
	data: ActionNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<>
			<Field label="Method">
				<Select
					value={data.webhookMethod ?? "POST"}
					onValueChange={(value) =>
						onUpdate({
							webhookMethod: value as ActionNodeData["webhookMethod"],
						})
					}
				>
					<SelectTrigger className="h-7 w-full text-xs" size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="GET">GET</SelectItem>
						<SelectItem value="POST">POST</SelectItem>
						<SelectItem value="PUT">PUT</SelectItem>
					</SelectContent>
				</Select>
			</Field>
			<Field label="URL">
				<Input
					className="h-7 text-xs"
					placeholder="https://..."
					value={data.webhookUrl ?? ""}
					onChange={(e) => onUpdate({ webhookUrl: e.target.value })}
				/>
			</Field>
		</>
	);
}

function TriggerConfigForm({
	data,
	flowId,
	onUpdate,
}: {
	data: TriggerNodeData;
	flowId: string;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	const kind = data.triggerKind ?? "keyword";
	return (
		<div className="flex flex-col gap-3">
			<Field label="Trigger Type">
				<Select
					value={kind}
					onValueChange={(value) =>
						onUpdate({ triggerKind: value as TriggerNodeData["triggerKind"] })
					}
				>
					<SelectTrigger className="h-7 w-full text-xs" size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="keyword">Keyword Match</SelectItem>
						<SelectItem value="any_message">Any Message</SelectItem>
						<SelectItem value="webhook">Webhook</SelectItem>
						<SelectItem value="schedule">Schedule</SelectItem>
					</SelectContent>
				</Select>
			</Field>
			{kind === "keyword" && (
				<TriggerKeywordConfig data={data} onUpdate={onUpdate} />
			)}
			{kind === "webhook" && (
				<TriggerWebhookConfig data={data} flowId={flowId} onUpdate={onUpdate} />
			)}
			{kind === "schedule" && (
				<TriggerScheduleConfig data={data} onUpdate={onUpdate} />
			)}
			{kind === "any_message" && (
				<p className="text-[10px] text-muted-foreground">
					Fires on every incoming message from any contact.
				</p>
			)}
		</div>
	);
}

function MessageConfigForm({
	data,
	onUpdate,
	allNodes,
	edges,
	currentNodeId,
}: {
	data: MessageNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
	allNodes?: Node[];
	edges?: Edge[];
	currentNodeId?: string;
}) {
	switch (data.nodeType) {
		case "send-text":
			return (
				<SendTextConfig
					data={data}
					onUpdate={onUpdate}
					allNodes={allNodes}
					edges={edges}
					currentNodeId={currentNodeId}
				/>
			);
		case "send-image":
		case "send-video":
		case "send-audio":
			return <MediaConfig data={data} onUpdate={onUpdate} />;
		case "send-document":
			return <DocumentConfig data={data} onUpdate={onUpdate} />;
		case "send-location":
			return <LocationConfig data={data} onUpdate={onUpdate} />;
		case "send-reaction":
			return <ReactionConfig data={data} onUpdate={onUpdate} />;
		default:
			return null;
	}
}

function InteractiveConfigForm({
	data,
	onUpdate,
}: {
	data: InteractiveNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	switch (data.nodeType) {
		case "send-button":
			return <InteractiveButtonsConfig data={data} onUpdate={onUpdate} />;
		case "send-list":
			return <InteractiveListConfig data={data} onUpdate={onUpdate} />;
		case "send-quick-reply":
			return <InteractiveQuickReplyConfig data={data} onUpdate={onUpdate} />;
		default:
			return null;
	}
}

function LogicConfigForm({
	data,
	onUpdate,
}: {
	data: LogicNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	switch (data.nodeType) {
		case "condition":
			return <ConditionConfig data={data} onUpdate={onUpdate} />;
		case "delay":
			return <DelayConfig data={data} onUpdate={onUpdate} />;
		case "set-variable":
			return <SetVariableConfig data={data} onUpdate={onUpdate} />;
		case "wait-for-reply":
			return <WaitForReplyConfig data={data} onUpdate={onUpdate} />;
		default:
			return (
				<p className="text-[10px] text-muted-foreground">
					No configuration needed
				</p>
			);
	}
}

function ActionConfigForm({
	data,
	onUpdate,
}: {
	data: ActionNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	switch (data.nodeType) {
		case "forward":
			return <ForwardConfig data={data} onUpdate={onUpdate} />;
		case "webhook-call":
			return <WebhookCallConfig data={data} onUpdate={onUpdate} />;
		default:
			return (
				<p className="text-[10px] text-muted-foreground">
					No configuration needed
				</p>
			);
	}
}

export function NodeConfigPanel({
	node,
	flowId,
	allNodes,
	edges,
	onUpdate,
	onDelete,
}: NodeConfigPanelProps) {
	if (!node) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground text-xs">
				Select a node to edit
			</div>
		);
	}

	const data = node.data as unknown as FlowNodeData;
	const isTriggerNode = data.category === "trigger";

	const handleUpdate = (partial: Partial<FlowNodeData>) => {
		onUpdate(node.id, partial);
	};

	let configForm: React.ReactNode;
	switch (data.category) {
		case "trigger":
			configForm = (
				<TriggerConfigForm
					data={data as TriggerNodeData}
					flowId={flowId}
					onUpdate={handleUpdate}
				/>
			);
			break;
		case "message":
		case "media":
			configForm = (
				<MessageConfigForm
					data={data as MessageNodeData}
					onUpdate={handleUpdate}
					allNodes={allNodes}
					edges={edges}
					currentNodeId={node.id}
				/>
			);
			break;
		case "interactive":
			configForm = (
				<InteractiveConfigForm
					data={data as InteractiveNodeData}
					onUpdate={handleUpdate}
				/>
			);
			break;
		case "logic":
			configForm = (
				<LogicConfigForm data={data as LogicNodeData} onUpdate={handleUpdate} />
			);
			break;
		case "action":
			configForm = (
				<ActionConfigForm
					data={data as ActionNodeData}
					onUpdate={handleUpdate}
				/>
			);
			break;
		default:
			configForm = null;
	}

	return (
		<div className="flex flex-col gap-3 p-3">
			<SectionTitle>Node Properties</SectionTitle>
			{!isTriggerNode && (
				<Field label="Label">
					<Input
						className="h-7 text-xs"
						value={data.label}
						onChange={(e) => handleUpdate({ label: e.target.value })}
					/>
				</Field>
			)}
			{!isTriggerNode && <Separator />}
			{configForm}
			{!isTriggerNode && (
				<>
					<Separator />
					<Button
						variant="outline"
						size="sm"
						className="mt-1 h-7 text-destructive text-xs"
						onClick={() => onDelete(node.id)}
					>
						<Trash2 className="size-3" />
						Delete Node
					</Button>
				</>
			)}
		</div>
	);
}
