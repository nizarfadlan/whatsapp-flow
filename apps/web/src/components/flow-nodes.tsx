import { Button } from "@whatsapp-flow/ui/components/button";
import { cn } from "@whatsapp-flow/ui/lib/utils";
import {
	type Edge,
	Handle,
	type Node,
	type NodeProps,
	Position,
	useReactFlow,
} from "@xyflow/react";
import {
	Clock,
	File,
	Forward,
	GitBranch,
	Globe,
	Grid3X3,
	Hash,
	Image,
	List,
	type LucideIcon,
	MapPin,
	MessageCircleReply,
	MessageSquare,
	Music,
	Reply,
	Send,
	Shuffle,
	StopCircle,
	ThumbsUp,
	Trash2,
	Variable,
	Video,
	Webhook,
} from "lucide-react";

// ── Node Data Types ──────────────────────────────────────────────

export type NodeCategory =
	| "trigger"
	| "message"
	| "media"
	| "interactive"
	| "logic"
	| "action";

export type TriggerKind = "keyword" | "any_message" | "webhook" | "schedule";

export interface TriggerNodeData {
	id: "trigger";
	nodeType: "trigger";
	label: string;
	category: "trigger";
	triggerKind: TriggerKind;
	keyword?: string;
	keywords?: string[];
	webhookToken?: string;
	cronExpression?: string;
	contactNumber?: string;
}

export interface MessageNodeData {
	id: string;
	nodeType:
		| "send-text"
		| "send-image"
		| "send-video"
		| "send-audio"
		| "send-document"
		| "send-location"
		| "send-reaction"
		| "send-template";
	label: string;
	category: "message" | "media";
	text?: string;
	mediaUrl?: string;
	caption?: string;
	fileName?: string;
	latitude?: number;
	longitude?: number;
	address?: string;
	emoji?: string;
	templateName?: string;
	languageCode?: string;
	templateBodyParams?: string[];
}

export type WaitForReplyWarning = {
	id: string;
	afterMinutes: number;
	message: string;
};

export interface InteractiveNodeData {
	id: string;
	nodeType: "send-button" | "send-list" | "send-quick-reply";
	label: string;
	category: "interactive";
	bodyText?: string;
	footerText?: string;
	buttonText?: string;
	buttons?: { id: string; text: string }[];
	sections?: {
		title: string;
		rows: { id: string; title: string; description?: string }[];
	}[];
	timeoutMinutes?: number;
	replyWarnings?: WaitForReplyWarning[];
}

export interface LogicNodeData {
	id: string;
	nodeType:
		| "condition"
		| "delay"
		| "set-variable"
		| "wait-for-reply"
		| "random";
	label: string;
	category: "logic";
	field?: string;
	operator?: "equals" | "contains" | "starts-with" | "regex";
	value?: string;
	delaySeconds?: number;
	variableName?: string;
	variableValue?: string;
	timeoutMinutes?: number;
	replyWarnings?: WaitForReplyWarning[];
}

export type WebhookAuthConfig =
	| { type: "none" }
	| { type: "bearer"; secretValue?: string; hasSecret?: boolean }
	| {
			type: "basic";
			username?: string;
			secretValue?: string;
			hasSecret?: boolean;
	  }
	| {
			type: "api_key";
			apiKeyName?: string;
			secretValue?: string;
			hasSecret?: boolean;
	  };

export type WebhookHeader = {
	id: string;
	key: string;
	value: string;
};

export interface ActionNodeData {
	id: string;
	nodeType: "forward" | "webhook-call" | "end";
	label: string;
	category: "action";
	targetNumber?: string;
	webhookMethod?: "GET" | "POST" | "PUT";
	webhookUrl?: string;
	webhookAuth?: WebhookAuthConfig;
	webhookHeaders?: WebhookHeader[] | Record<string, string>;
}

export type FlowNodeData =
	| TriggerNodeData
	| MessageNodeData
	| InteractiveNodeData
	| LogicNodeData
	| ActionNodeData;

export type InteractiveOptionHandle = {
	id: string;
	optionId: string;
	label: string;
	index: number;
};

export function isInteractiveBranchNode(
	data: FlowNodeData,
): data is InteractiveNodeData {
	return (
		data.nodeType === "send-button" ||
		data.nodeType === "send-list" ||
		data.nodeType === "send-quick-reply"
	);
}

export function getInteractiveOptionHandles(
	data: FlowNodeData,
): InteractiveOptionHandle[] {
	if (!isInteractiveBranchNode(data)) return [];
	const options =
		data.nodeType === "send-list"
			? (data.sections ?? []).flatMap((section) =>
					(section.rows ?? []).map((row) => ({ id: row.id, label: row.title })),
				)
			: (data.buttons ?? []).map((button) => ({
					id: button.id,
					label: button.text,
				}));

	return options.map((option, index) => ({
		id: `option:${option.id}`,
		optionId: option.id,
		label: option.label.trim() || `Option ${index + 1}`,
		index: index + 1,
	}));
}

// ── Node Visual Components ───────────────────────────────────────

export const categoryAccents: Record<
	NodeCategory,
	{ accent: string; chip: string; icon: string }
> = {
	trigger: {
		accent: "bg-primary",
		chip: "bg-primary/10",
		icon: "text-primary",
	},
	message: {
		accent: "bg-violet-500/70",
		chip: "bg-violet-500/10",
		icon: "text-violet-600 dark:text-violet-400",
	},
	media: {
		accent: "bg-sky-500/70",
		chip: "bg-sky-500/10",
		icon: "text-sky-600 dark:text-sky-400",
	},
	interactive: {
		accent: "bg-amber-500/70",
		chip: "bg-amber-500/10",
		icon: "text-amber-600 dark:text-amber-400",
	},
	logic: {
		accent: "bg-blue-500/70",
		chip: "bg-blue-500/10",
		icon: "text-blue-600 dark:text-blue-400",
	},
	action: {
		accent: "bg-rose-500/70",
		chip: "bg-rose-500/10",
		icon: "text-rose-600 dark:text-rose-400",
	},
};

function BaseFlowNode({
	data,
	selected,
	icon: Icon,
	category,
	children,
}: {
	data: FlowNodeData;
	selected: boolean;
	icon: LucideIcon;
	category: NodeCategory;
	children?: React.ReactNode;
}) {
	const c = categoryAccents[category];
	const { deleteElements } = useReactFlow();
	const isTrigger = data.category === "trigger";
	const isCondition = data.nodeType === "condition";
	const isEnd = data.nodeType === "end";
	const optionHandles = getInteractiveOptionHandles(data);

	return (
		<div
			className={cn(
				"group relative flex min-w-56 flex-col overflow-visible rounded-2xl border border-border/80 bg-card text-card-foreground text-xs shadow-sm ring-1 ring-foreground/5 transition-all hover:border-border hover:shadow-md",
				selected && "border-primary/60 shadow-md ring-2 ring-primary/15",
			)}
		>
			{!isTrigger && (
				<Handle
					type="target"
					position={Position.Left}
					className="flow-node-handle"
				/>
			)}

			<div className="flex items-center gap-2 border-b bg-muted/20 px-2.5 py-2">
				<span
					className={cn(
						"flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background shadow-xs",
						c.chip,
					)}
				>
					<Icon className={cn("size-3.5", c.icon)} />
				</span>
				<span className="min-w-0 flex-1 truncate font-medium">
					{data.label}
				</span>
				{!isTrigger && (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="nodrag size-6 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 data-[state=open]:opacity-100"
						onClick={(event) => {
							event.stopPropagation();
							deleteElements({ nodes: [{ id: data.id }] });
						}}
						aria-label="Delete node"
					>
						<Trash2 className="size-3" />
					</Button>
				)}
			</div>

			<div className="flex min-h-9 flex-col gap-1.5 px-3 py-2.5">
				{children ?? (
					<span className="text-[10px] text-muted-foreground">
						Configure this step from the inspector.
					</span>
				)}
			</div>

			<div className={cn("absolute inset-x-4 bottom-0 h-px", c.accent)} />
			{isCondition ? (
				<>
					<Handle
						id="true"
						type="source"
						position={Position.Right}
						style={{ top: "38%" }}
						className="flow-node-handle"
					/>
					<Handle
						id="false"
						type="source"
						position={Position.Right}
						style={{ top: "68%" }}
						className="flow-node-handle"
					/>
					<span className="absolute top-[30%] -right-9 rounded-md border bg-background px-1 text-[9px] text-muted-foreground shadow-xs">
						true
					</span>
					<span className="absolute top-[60%] -right-10 rounded-md border bg-background px-1 text-[9px] text-muted-foreground shadow-xs">
						false
					</span>
				</>
			) : optionHandles.length > 0 ? (
				optionHandles.map((option, index) => {
					const top =
						optionHandles.length === 1
							? 52
							: 30 + (index * 46) / Math.max(optionHandles.length - 1, 1);
					return (
						<div key={option.id}>
							<Handle
								id={option.id}
								type="source"
								position={Position.Right}
								style={{ top: `${top}%` }}
								className="flow-node-handle"
							/>
							<span
								className="absolute -right-24 max-w-20 truncate rounded-md border bg-background px-1 text-[9px] text-muted-foreground shadow-xs"
								style={{ top: `calc(${top}% - 8px)` }}
								title={option.label}
							>
								{option.index}. {option.label}
							</span>
						</div>
					);
				})
			) : (
				!isEnd && (
					<Handle
						type="source"
						position={Position.Right}
						className="flow-node-handle"
					/>
				)
			)}
		</div>
	);
}

function normalizeKeywords(
	data: Pick<TriggerNodeData, "keyword" | "keywords">,
) {
	const keywords = data.keywords?.length
		? data.keywords
		: (data.keyword ?? "").split(/[\n,]/);
	const seen = new Set<string>();
	return keywords
		.map((keyword) => keyword.trim())
		.filter((keyword) => {
			const key = keyword.toLowerCase();
			if (!key || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

export function TriggerNode({ data, selected }: NodeProps) {
	const d = data as unknown as TriggerNodeData;
	const triggerKind = d.triggerKind ?? "keyword";
	const summary = () => {
		switch (triggerKind) {
			case "keyword": {
				const keywords = normalizeKeywords(d);
				if (keywords.length === 0) return "Set keywords below";
				if (keywords.length === 1) return `Keyword: "${keywords[0]}"`;
				return `${keywords.length} keywords: ${keywords.slice(0, 3).join(", ")}`;
			}
			case "any_message":
				return "Any incoming message";
			case "webhook":
				return d.webhookToken ? "Secured webhook" : "Webhook trigger";
			case "schedule":
				return d.cronExpression ?? "Set schedule below";
		}
	};
	const triggerIcon = () => {
		switch (triggerKind) {
			case "keyword":
				return Hash;
			case "any_message":
				return MessageSquare;
			case "webhook":
				return Globe;
			case "schedule":
				return Clock;
		}
	};
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={triggerIcon()}
			category="trigger"
		>
			<span className="text-[10px] text-muted-foreground">{summary()}</span>
		</BaseFlowNode>
	);
}

// Message nodes
export function SendTextNode({ data, selected }: NodeProps) {
	const d = data as unknown as MessageNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Send} category="message">
			{d.text && (
				<span className="max-w-44 truncate text-[10px] text-muted-foreground">
					"{d.text}"
				</span>
			)}
		</BaseFlowNode>
	);
}

export function SendImageNode({ data, selected }: NodeProps) {
	const d = data as unknown as MessageNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Image} category="media">
			{d.mediaUrl && (
				<span className="text-[10px] text-muted-foreground">{d.mediaUrl}</span>
			)}
		</BaseFlowNode>
	);
}

export function SendVideoNode({ data, selected }: NodeProps) {
	const d = data as unknown as MessageNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Video} category="media">
			{d.mediaUrl && (
				<span className="text-[10px] text-muted-foreground">{d.mediaUrl}</span>
			)}
		</BaseFlowNode>
	);
}

export function SendAudioNode({ data, selected }: NodeProps) {
	const d = data as unknown as MessageNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Music} category="media">
			{d.mediaUrl && (
				<span className="text-[10px] text-muted-foreground">{d.mediaUrl}</span>
			)}
		</BaseFlowNode>
	);
}

export function SendDocumentNode({ data, selected }: NodeProps) {
	const d = data as unknown as MessageNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={File} category="media">
			{d.fileName && (
				<span className="text-[10px] text-muted-foreground">{d.fileName}</span>
			)}
		</BaseFlowNode>
	);
}

export function SendLocationNode({ data, selected }: NodeProps) {
	const d = data as unknown as MessageNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={MapPin} category="media">
			{d.address && (
				<span className="text-[10px] text-muted-foreground">{d.address}</span>
			)}
		</BaseFlowNode>
	);
}

export function SendReactionNode({ data, selected }: NodeProps) {
	const d = data as unknown as MessageNodeData;
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={ThumbsUp}
			category="message"
		>
			{d.emoji && <span className="text-[10px]">{d.emoji}</span>}
		</BaseFlowNode>
	);
}

export function SendTemplateNode({ data, selected }: NodeProps) {
	const d = data as unknown as MessageNodeData;
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={MessageSquare}
			category="message"
		>
			{d.templateName && (
				<span className="text-[10px] text-muted-foreground">
					{d.templateName} · {d.languageCode ?? "en_US"}
				</span>
			)}
		</BaseFlowNode>
	);
}

function getReplyWarningCount(data: { replyWarnings?: WaitForReplyWarning[] }) {
	return data.replyWarnings?.filter((warning) => warning.message.trim()).length;
}

function getWaitSummary(data: {
	timeoutMinutes?: number;
	replyWarnings?: WaitForReplyWarning[];
}) {
	const warningCount = getReplyWarningCount(data);
	return `${data.timeoutMinutes ?? 1440}m wait${warningCount ? ` · ${warningCount} warnings` : ""}`;
}

// Interactive nodes
export function SendButtonNode({ data, selected }: NodeProps) {
	const d = data as unknown as InteractiveNodeData;
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={Grid3X3}
			category="interactive"
		>
			{d.bodyText && (
				<span className="max-w-44 truncate text-[10px] text-muted-foreground">
					"{d.bodyText}"
				</span>
			)}
			<span className="text-[10px] text-muted-foreground">
				{getWaitSummary(d)}
			</span>
		</BaseFlowNode>
	);
}

export function SendListNode({ data, selected }: NodeProps) {
	const d = data as unknown as InteractiveNodeData;
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={List}
			category="interactive"
		>
			<span className="text-[10px] text-muted-foreground">
				{d.sections?.length ?? 0} sections
			</span>
			<span className="text-[10px] text-muted-foreground">
				{getWaitSummary(d)}
			</span>
		</BaseFlowNode>
	);
}

export function SendQuickReplyNode({ data, selected }: NodeProps) {
	const d = data as unknown as InteractiveNodeData;
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={Reply}
			category="interactive"
		>
			<span className="text-[10px] text-muted-foreground">
				{d.buttons?.length ?? 0} buttons
			</span>
			<span className="text-[10px] text-muted-foreground">
				{getWaitSummary(d)}
			</span>
		</BaseFlowNode>
	);
}

// Logic nodes
export function ConditionNode({ data, selected }: NodeProps) {
	const d = data as unknown as LogicNodeData;
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={GitBranch}
			category="logic"
		>
			{d.field && (
				<span className="text-[10px] text-muted-foreground">
					{d.field} {d.operator} {d.value}
				</span>
			)}
		</BaseFlowNode>
	);
}

export function DelayNode({ data, selected }: NodeProps) {
	const d = data as unknown as LogicNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Clock} category="logic">
			{d.delaySeconds != null && (
				<span className="text-[10px] text-muted-foreground">
					{d.delaySeconds}s delay
				</span>
			)}
		</BaseFlowNode>
	);
}

export function SetVariableNode({ data, selected }: NodeProps) {
	const d = data as unknown as LogicNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Variable} category="logic">
			{d.variableName && (
				<span className="text-[10px] text-muted-foreground">
					{d.variableName} = {d.variableValue}
				</span>
			)}
		</BaseFlowNode>
	);
}

export function WaitForReplyNode({ data, selected }: NodeProps) {
	const d = data as unknown as LogicNodeData;
	const warningCount = getReplyWarningCount(d);
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={MessageCircleReply}
			category="logic"
		>
			<span className="text-[10px] text-muted-foreground">
				{d.variableName ?? "reply"} · {d.timeoutMinutes ?? 1440}m
				{warningCount ? ` · ${warningCount} warnings` : ""}
			</span>
		</BaseFlowNode>
	);
}

export function RandomNode({ data, selected }: NodeProps) {
	const d = data as unknown as LogicNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Shuffle} category="logic">
			<span className="text-[10px] text-muted-foreground">Random split</span>
		</BaseFlowNode>
	);
}

// Action nodes
export function ForwardNode({ data, selected }: NodeProps) {
	const d = data as unknown as ActionNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Forward} category="action">
			{d.targetNumber && (
				<span className="text-[10px] text-muted-foreground">
					{d.targetNumber}
				</span>
			)}
		</BaseFlowNode>
	);
}

export function WebhookCallNode({ data, selected }: NodeProps) {
	const d = data as unknown as ActionNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Webhook} category="action">
			{d.webhookUrl && (
				<span className="max-w-44 truncate text-[10px] text-muted-foreground">
					{d.webhookMethod} {d.webhookUrl}
				</span>
			)}
		</BaseFlowNode>
	);
}

export function EndNode({ data, selected }: NodeProps) {
	const d = data as unknown as ActionNodeData;
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={StopCircle}
			category="action"
		>
			<span className="text-[10px] text-muted-foreground">End flow</span>
		</BaseFlowNode>
	);
}

// ── Node Type Registry ───────────────────────────────────────────

export const nodeTypes = {
	trigger: TriggerNode,
	"send-text": SendTextNode,
	"send-image": SendImageNode,
	"send-video": SendVideoNode,
	"send-audio": SendAudioNode,
	"send-document": SendDocumentNode,
	"send-location": SendLocationNode,
	"send-reaction": SendReactionNode,
	"send-template": SendTemplateNode,
	"send-button": SendButtonNode,
	"send-list": SendListNode,
	"send-quick-reply": SendQuickReplyNode,
	condition: ConditionNode,
	delay: DelayNode,
	"set-variable": SetVariableNode,
	"wait-for-reply": WaitForReplyNode,
	random: RandomNode,
	forward: ForwardNode,
	"webhook-call": WebhookCallNode,
	end: EndNode,
};

export type NodeTypeName = keyof typeof nodeTypes;
export type PaletteNodeTypeName = Exclude<NodeTypeName, "trigger">;

// ── Palette Definition ───────────────────────────────────────────

export interface PaletteCategory {
	label: string;
	items: PaletteItem[];
}

export interface PaletteItem {
	type: PaletteNodeTypeName;
	label: string;
	icon: LucideIcon;
	category: NodeCategory;
}

export const paletteCategories: PaletteCategory[] = [
	{
		label: "Messages",
		items: [
			{ type: "send-text", label: "Text", icon: Send, category: "message" },
			{
				type: "send-template",
				label: "Template",
				icon: MessageSquare,
				category: "message",
			},
			{
				type: "send-reaction",
				label: "Reaction",
				icon: ThumbsUp,
				category: "message",
			},
		],
	},
	{
		label: "Media",
		items: [
			{ type: "send-image", label: "Image", icon: Image, category: "media" },
			{ type: "send-video", label: "Video", icon: Video, category: "media" },
			{ type: "send-audio", label: "Audio", icon: Music, category: "media" },
			{
				type: "send-document",
				label: "Document",
				icon: File,
				category: "media",
			},
			{
				type: "send-location",
				label: "Location",
				icon: MapPin,
				category: "media",
			},
		],
	},
	{
		label: "Interactive",
		items: [
			{
				type: "send-button",
				label: "Buttons",
				icon: Grid3X3,
				category: "interactive",
			},
			{ type: "send-list", label: "List", icon: List, category: "interactive" },
			{
				type: "send-quick-reply",
				label: "Quick Reply",
				icon: Reply,
				category: "interactive",
			},
		],
	},
	{
		label: "Logic",
		items: [
			{
				type: "condition",
				label: "Condition",
				icon: GitBranch,
				category: "logic",
			},
			{ type: "delay", label: "Delay", icon: Clock, category: "logic" },
			{
				type: "set-variable",
				label: "Set Variable",
				icon: Variable,
				category: "logic",
			},
			{
				type: "wait-for-reply",
				label: "Wait for Reply",
				icon: MessageCircleReply,
				category: "logic",
			},
			{ type: "random", label: "Random", icon: Shuffle, category: "logic" },
		],
	},
	{
		label: "Actions",
		items: [
			{ type: "forward", label: "Forward", icon: Forward, category: "action" },
			{
				type: "webhook-call",
				label: "Webhook Call",
				icon: Webhook,
				category: "action",
			},
			{ type: "end", label: "End", icon: StopCircle, category: "action" },
		],
	},
];

// ── Node Factory ─────────────────────────────────────────────────

let nodeIdCounter = 0;
export function resetNodeIdCounter() {
	nodeIdCounter = 0;
}
function nextNodeId() {
	nodeIdCounter += 1;
	return `node_${Date.now()}_${nodeIdCounter}`;
}

const defaultLabels: Record<NodeTypeName, string> = {
	trigger: "Trigger",
	"send-text": "Send Text",
	"send-image": "Send Image",
	"send-video": "Send Video",
	"send-audio": "Send Audio",
	"send-document": "Send Document",
	"send-location": "Send Location",
	"send-reaction": "Send Reaction",
	"send-template": "Send Template",
	"send-button": "Send Buttons",
	"send-list": "Send List",
	"send-quick-reply": "Quick Reply",
	condition: "Condition",
	delay: "Delay",
	"set-variable": "Set Variable",
	"wait-for-reply": "Wait for Reply",
	random: "Random",
	forward: "Forward",
	"webhook-call": "Webhook Call",
	end: "End",
};

export function createTriggerNode(): Node {
	return {
		id: "trigger",
		type: "trigger",
		position: { x: 40, y: 120 },
		deletable: false,
		data: {
			id: "trigger",
			nodeType: "trigger",
			label: "Trigger",
			category: "trigger",
			triggerKind: "keyword",
			keyword: "",
		},
	};
}

// Backward-compat alias for any external callers still referencing the old name.
export const createStartNode = createTriggerNode;

export function createNode(type: PaletteNodeTypeName, x = 300, y = 50): Node {
	const id = nextNodeId();
	const item = paletteCategories
		.flatMap((c) => c.items)
		.find((i) => i.type === type);
	const category = item?.category ?? "message";

	const base = {
		id,
		type,
		position: { x, y },
		data: { id, nodeType: type, label: defaultLabels[type], category },
	};

	switch (type) {
		case "send-text":
			return { ...base, data: { ...base.data, text: "" } };
		case "send-image":
		case "send-video":
		case "send-audio":
			return { ...base, data: { ...base.data, mediaUrl: "", caption: "" } };
		case "send-document":
			return { ...base, data: { ...base.data, mediaUrl: "", fileName: "" } };
		case "send-location":
			return { ...base, data: { ...base.data, address: "" } };
		case "send-reaction":
			return { ...base, data: { ...base.data, emoji: "" } };
		case "send-template":
			return {
				...base,
				data: {
					...base.data,
					templateName: "",
					languageCode: "en_US",
					templateBodyParams: [],
				},
			};
		case "send-button":
			return {
				...base,
				data: {
					...base.data,
					bodyText: "",
					footerText: "",
					buttons: [],
					timeoutMinutes: 1440,
					replyWarnings: [],
				},
			};
		case "send-list":
			return {
				...base,
				data: {
					...base.data,
					bodyText: "",
					footerText: "",
					buttonText: "Menu",
					sections: [],
					timeoutMinutes: 1440,
					replyWarnings: [],
				},
			};
		case "send-quick-reply":
			return {
				...base,
				data: {
					...base.data,
					bodyText: "",
					buttons: [],
					timeoutMinutes: 1440,
					replyWarnings: [],
				},
			};
		case "condition":
			return {
				...base,
				data: {
					...base.data,
					field: "message.text",
					operator: "contains" as const,
					value: "",
				},
			};
		case "delay":
			return { ...base, data: { ...base.data, delaySeconds: 5 } };
		case "set-variable":
			return {
				...base,
				data: { ...base.data, variableName: "", variableValue: "" },
			};
		case "wait-for-reply":
			return {
				...base,
				data: {
					...base.data,
					variableName: "reply",
					timeoutMinutes: 1440,
					replyWarnings: [],
				},
			};
		case "forward":
			return { ...base, data: { ...base.data, targetNumber: "" } };
		case "webhook-call":
			return {
				...base,
				data: {
					...base.data,
					webhookMethod: "POST" as const,
					webhookUrl: "",
					webhookAuth: { type: "none" as const },
					webhookHeaders: [],
				},
			};
		default:
			return base;
	}
}

// ── Legacy Node Migration ────────────────────────────────────────
// Maps old node shapes (separate `start` + `trigger-*` nodes) onto the unified
// `trigger` node so existing flows stored as JSONB keep working.

const TRIGGER_TYPE_TO_KIND: Record<string, TriggerKind> = {
	"trigger-keyword": "keyword",
	"trigger-any": "any_message",
	"trigger-webhook": "webhook",
	"trigger-schedule": "schedule",
};

export function migrateLegacyNodes(nodes: Node[]): Node[] {
	const hasTrigger = nodes.some((n) => n.type === "trigger");
	if (hasTrigger) {
		// Drop any leftover `start` node; keep the unified trigger.
		return nodes.filter((n) => n.type !== "start");
	}

	const legacyTrigger = nodes.find((n) => n.type?.startsWith("trigger-"));
	const startNode = nodes.find((n) => n.type === "start");

	if (!legacyTrigger && !startNode) return nodes;

	const kind = legacyTrigger?.type
		? TRIGGER_TYPE_TO_KIND[legacyTrigger.type]
		: "keyword";
	const legacyData = (legacyTrigger?.data ?? {}) as Record<string, unknown>;
	const triggerData: TriggerNodeData = {
		id: "trigger",
		nodeType: "trigger",
		label: "Trigger",
		category: "trigger",
		triggerKind: kind,
		keyword: typeof legacyData.keyword === "string" ? legacyData.keyword : "",
		webhookToken:
			typeof legacyData.webhookToken === "string"
				? legacyData.webhookToken
				: undefined,
		cronExpression:
			typeof legacyData.cronExpression === "string"
				? legacyData.cronExpression
				: undefined,
		contactNumber:
			typeof legacyData.contactNumber === "string"
				? legacyData.contactNumber
				: undefined,
	};

	const triggerNode: Node = {
		id: "trigger",
		type: "trigger",
		position: startNode?.position ??
			legacyTrigger?.position ?? { x: 40, y: 120 },
		deletable: false,
		data: { ...triggerData },
	};

	// Re-point edges that referenced the old start/trigger node ids onto "trigger".
	const remapped = nodes
		.filter((n) => n.type !== "start" && !n.type?.startsWith("trigger-"))
		.map((n) => {
			if (n.id === (legacyTrigger?.id ?? startNode?.id)) return triggerNode;
			return n;
		});

	if (!remapped.some((n) => n.id === "trigger")) remapped.unshift(triggerNode);
	return remapped;
}

export function remapLegacyEdges(edges: Edge[], nodes: Node[] = []): Edge[] {
	// Edges are plain objects; remap source/target from old start/trigger node ids to "trigger".
	const legacyTriggerIds = new Set(
		nodes
			.filter(
				(node) => node.type === "start" || node.type?.startsWith("trigger-"),
			)
			.map((node) => node.id),
	);
	legacyTriggerIds.add("start");

	return edges.map((e) => {
		const edge = { ...e };
		if (legacyTriggerIds.has(edge.source)) {
			edge.source = "trigger";
			// Legacy trigger nodes often had specific handle IDs (like "next").
			// The new TriggerNode uses the default handle (no id), so we must clear it.
			delete edge.sourceHandle;
		}
		if (legacyTriggerIds.has(edge.target)) {
			edge.target = "trigger";
			delete edge.targetHandle;
		}
		return edge;
	});
}
