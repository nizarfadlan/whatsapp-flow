import { Button } from "@whatsapp-flow/ui/components/button";
import { Input } from "@whatsapp-flow/ui/components/input";
import { Separator } from "@whatsapp-flow/ui/components/separator";
import type { Node } from "@xyflow/react";
import { Copy, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type {
	ActionNodeData,
	FlowNodeData,
	InteractiveNodeData,
	LogicNodeData,
	MessageNodeData,
	TriggerNodeData,
} from "./flow-nodes";

interface NodeConfigPanelProps {
	node: Node | null;
	flowId: string;
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

// Trigger configs
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

// Message configs
function SendTextConfig({
	data,
	onUpdate,
}: {
	data: MessageNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<Field label="Message Text">
			<Input
				className="h-7 text-xs"
				placeholder="e.g. Hello! How can I help?"
				value={data.text ?? ""}
				onChange={(e) => onUpdate({ text: e.target.value })}
			/>
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
	return (
		<>
			<Field label="Media URL">
				<Input
					className="h-7 text-xs"
					placeholder="https://..."
					value={data.mediaUrl ?? ""}
					onChange={(e) => onUpdate({ mediaUrl: e.target.value })}
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
			<Field label="File URL">
				<Input
					className="h-7 text-xs"
					placeholder="https://..."
					value={data.mediaUrl ?? ""}
					onChange={(e) => onUpdate({ mediaUrl: e.target.value })}
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
	return (
		<Field label="Emoji">
			<Input
				className="h-7 text-xs"
				placeholder="👍"
				value={data.emoji ?? ""}
				onChange={(e) => onUpdate({ emoji: e.target.value })}
			/>
		</Field>
	);
}

// Interactive configs
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
			<Field label="Body Text">
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
						Buttons ({(data.buttons ?? []).length}/3)
					</span>
					{(data.buttons ?? []).length < 3 && (
						<button
							type="button"
							className="text-muted-foreground hover:text-foreground"
							onClick={addButton}
						>
							<Plus className="size-3" />
						</button>
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
						<button
							type="button"
							className="text-muted-foreground hover:text-destructive"
							onClick={() => removeButton(i)}
						>
							<X className="size-3" />
						</button>
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
			<Field label="Body Text">
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
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground"
						onClick={addSection}
					>
						<Plus className="size-3" />
					</button>
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
							<button
								type="button"
								className="text-muted-foreground hover:text-destructive"
								onClick={() => removeSection(si)}
							>
								<X className="size-3" />
							</button>
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
									<button
										type="button"
										className="text-muted-foreground hover:text-destructive"
										onClick={() => removeRow(si, ri)}
									>
										<X className="size-3" />
									</button>
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
						<button
							type="button"
							className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
							onClick={() => addRow(si)}
						>
							<Plus className="size-2.5" /> Row
						</button>
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
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground"
						onClick={addButton}
					>
						<Plus className="size-3" />
					</button>
				</div>
				{(data.buttons ?? []).map((btn, i) => (
					<div key={btn.id} className="flex items-center gap-1">
						<Input
							className="h-7 flex-1 text-xs"
							placeholder={`Option ${i + 1}`}
							value={btn.text}
							onChange={(e) => updateButton(i, e.target.value)}
						/>
						<button
							type="button"
							className="text-muted-foreground hover:text-destructive"
							onClick={() => removeButton(i)}
						>
							<X className="size-3" />
						</button>
					</div>
				))}
			</div>
		</>
	);
}

// Logic configs
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
				<select
					className="h-7 w-full rounded-none border border-input bg-background px-2 text-xs"
					value={data.operator ?? "contains"}
					onChange={(e) =>
						onUpdate({ operator: e.target.value as LogicNodeData["operator"] })
					}
				>
					<option value="equals">equals</option>
					<option value="contains">contains</option>
					<option value="starts-with">starts with</option>
					<option value="regex">regex</option>
				</select>
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

// Action configs
function ForwardConfig({
	data,
	onUpdate,
}: {
	data: ActionNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	return (
		<Field label="Target Number">
			<Input
				className="h-7 text-xs"
				placeholder="+1234567890"
				value={data.targetNumber ?? ""}
				onChange={(e) => onUpdate({ targetNumber: e.target.value })}
			/>
		</Field>
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
				<select
					className="h-7 w-full rounded-none border border-input bg-background px-2 text-xs"
					value={data.webhookMethod ?? "POST"}
					onChange={(e) =>
						onUpdate({
							webhookMethod: e.target.value as ActionNodeData["webhookMethod"],
						})
					}
				>
					<option value="GET">GET</option>
					<option value="POST">POST</option>
					<option value="PUT">PUT</option>
				</select>
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
	switch (data.nodeType) {
		case "trigger-keyword":
			return <TriggerKeywordConfig data={data} onUpdate={onUpdate} />;
		case "trigger-webhook":
			return (
				<TriggerWebhookConfig data={data} flowId={flowId} onUpdate={onUpdate} />
			);
		case "trigger-schedule":
			return <TriggerScheduleConfig data={data} onUpdate={onUpdate} />;
		default:
			return (
				<p className="text-[10px] text-muted-foreground">
					No configuration needed
				</p>
			);
	}
}

function MessageConfigForm({
	data,
	onUpdate,
}: {
	data: MessageNodeData;
	onUpdate: (d: Partial<FlowNodeData>) => void;
}) {
	switch (data.nodeType) {
		case "send-text":
			return <SendTextConfig data={data} onUpdate={onUpdate} />;
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
	const isStartNode = data.category === "start";

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
		case "start":
			configForm = (
				<p className="text-[10px] text-muted-foreground">
					Static starting point. Connect it to the first trigger to make the
					flow easier to read.
				</p>
			);
			break;
		default:
			configForm = null;
	}

	return (
		<div className="flex flex-col gap-3 p-3">
			<SectionTitle>Node Properties</SectionTitle>
			{!isStartNode && (
				<Field label="Label">
					<Input
						className="h-7 text-xs"
						value={data.label}
						onChange={(e) => handleUpdate({ label: e.target.value })}
					/>
				</Field>
			)}
			{!isStartNode && <Separator />}
			{configForm}
			{!isStartNode && (
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
