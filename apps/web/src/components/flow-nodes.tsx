import { cn } from "@whatsapp-flow/ui/lib/utils";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
	CirclePlay,
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
	Variable,
	Video,
	Webhook,
} from "lucide-react";

// ── Node Data Types ──────────────────────────────────────────────

export type NodeCategory =
	| "start"
	| "trigger"
	| "message"
	| "media"
	| "interactive"
	| "logic"
	| "action";

export interface StartNodeData {
	id: "start";
	nodeType: "start";
	label: string;
	category: "start";
}

export interface TriggerNodeData {
	id: string;
	nodeType:
		| "trigger-keyword"
		| "trigger-any"
		| "trigger-webhook"
		| "trigger-schedule";
	label: string;
	category: "trigger";
	keyword?: string;
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
		| "send-reaction";
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
}

export interface InteractiveNodeData {
	id: string;
	nodeType: "send-button" | "send-list" | "send-quick-reply";
	label: string;
	category: "interactive";
	bodyText?: string;
	footerText?: string;
	buttons?: { id: string; text: string }[];
	sections?: {
		title: string;
		rows: { id: string; title: string; description?: string }[];
	}[];
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
}

export interface ActionNodeData {
	id: string;
	nodeType: "forward" | "webhook-call" | "end";
	label: string;
	category: "action";
	targetNumber?: string;
	webhookMethod?: "GET" | "POST" | "PUT";
	webhookUrl?: string;
	webhookHeaders?: Record<string, string>;
}

export type FlowNodeData =
	| StartNodeData
	| TriggerNodeData
	| MessageNodeData
	| InteractiveNodeData
	| LogicNodeData
	| ActionNodeData;

// ── Node Visual Components ───────────────────────────────────────

const categoryColors: Record<
	NodeCategory,
	{ border: string; bg: string; icon: string }
> = {
	start: {
		border: "border-primary",
		bg: "bg-primary/10",
		icon: "text-primary",
	},
	trigger: {
		border: "border-green-500",
		bg: "bg-green-50 dark:bg-green-950",
		icon: "text-green-600",
	},
	message: {
		border: "border-purple-500",
		bg: "bg-purple-50 dark:bg-purple-950",
		icon: "text-purple-600",
	},
	media: {
		border: "border-fuchsia-500",
		bg: "bg-fuchsia-50 dark:bg-fuchsia-950",
		icon: "text-fuchsia-600",
	},
	interactive: {
		border: "border-orange-500",
		bg: "bg-orange-50 dark:bg-orange-950",
		icon: "text-orange-600",
	},
	logic: {
		border: "border-blue-500",
		bg: "bg-blue-50 dark:bg-blue-950",
		icon: "text-blue-600",
	},
	action: {
		border: "border-red-500",
		bg: "bg-red-50 dark:bg-red-950",
		icon: "text-red-600",
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
	const c = categoryColors[category];
	const isStart = data.category === "start";
	const isCondition = data.nodeType === "condition";
	const isEnd = data.nodeType === "end";

	return (
		<div
			className={cn(
				"relative flex min-w-40 flex-col gap-1 rounded-none border-2 px-3 py-2 text-xs shadow-sm",
				c.border,
				c.bg,
				selected && "ring-2 ring-primary",
			)}
		>
			{!isStart && <Handle type="target" position={Position.Left} />}
			<div className="flex items-center gap-2 font-medium">
				<Icon className={cn("size-4", c.icon)} />
				{data.label}
			</div>
			{children}
			{isCondition ? (
				<>
					<Handle
						id="true"
						type="source"
						position={Position.Right}
						style={{ top: "35%" }}
					/>
					<Handle
						id="false"
						type="source"
						position={Position.Right}
						style={{ top: "65%" }}
					/>
					<span className="absolute top-[25%] -right-8 text-[9px] text-green-600">
						true
					</span>
					<span className="absolute top-[55%] -right-9 text-[9px] text-red-600">
						false
					</span>
				</>
			) : (
				!isEnd && <Handle type="source" position={Position.Right} />
			)}
		</div>
	);
}

export function StartNode({ data, selected }: NodeProps) {
	const d = data as unknown as StartNodeData;
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={CirclePlay}
			category="start"
		>
			<span className="text-[10px] text-muted-foreground">
				Flow starts here
			</span>
		</BaseFlowNode>
	);
}

// Trigger nodes
export function TriggerKeywordNode({ data, selected }: NodeProps) {
	const d = data as unknown as TriggerNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Hash} category="trigger">
			{d.keyword && (
				<span className="text-[10px] text-muted-foreground">
					Keyword: "{d.keyword}"
				</span>
			)}
		</BaseFlowNode>
	);
}

export function TriggerAnyNode({ data, selected }: NodeProps) {
	const d = data as unknown as TriggerNodeData;
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={MessageSquare}
			category="trigger"
		>
			<span className="text-[10px] text-muted-foreground">Any message</span>
		</BaseFlowNode>
	);
}

export function TriggerWebhookNode({ data, selected }: NodeProps) {
	const d = data as unknown as TriggerNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Globe} category="trigger">
			<span className="text-[10px] text-muted-foreground">
				{d.webhookToken ? "Secured webhook" : "Webhook trigger"}
			</span>
		</BaseFlowNode>
	);
}

export function TriggerScheduleNode({ data, selected }: NodeProps) {
	const d = data as unknown as TriggerNodeData;
	return (
		<BaseFlowNode data={d} selected={selected} icon={Clock} category="trigger">
			{d.cronExpression && (
				<span className="text-[10px] text-muted-foreground">
					{d.cronExpression}
				</span>
			)}
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
	return (
		<BaseFlowNode
			data={d}
			selected={selected}
			icon={MessageCircleReply}
			category="logic"
		>
			<span className="text-[10px] text-muted-foreground">
				{d.variableName ?? "reply"} · {d.timeoutMinutes ?? 1440}m
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
	start: StartNode,
	"trigger-keyword": TriggerKeywordNode,
	"trigger-any": TriggerAnyNode,
	"trigger-webhook": TriggerWebhookNode,
	"trigger-schedule": TriggerScheduleNode,
	"send-text": SendTextNode,
	"send-image": SendImageNode,
	"send-video": SendVideoNode,
	"send-audio": SendAudioNode,
	"send-document": SendDocumentNode,
	"send-location": SendLocationNode,
	"send-reaction": SendReactionNode,
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
export type PaletteNodeTypeName = Exclude<NodeTypeName, "start">;

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
		label: "Triggers",
		items: [
			{
				type: "trigger-keyword",
				label: "Keyword",
				icon: Hash,
				category: "trigger",
			},
			{
				type: "trigger-any",
				label: "Any Message",
				icon: MessageSquare,
				category: "trigger",
			},
			{
				type: "trigger-webhook",
				label: "Webhook",
				icon: Globe,
				category: "trigger",
			},
			{
				type: "trigger-schedule",
				label: "Schedule",
				icon: Clock,
				category: "trigger",
			},
		],
	},
	{
		label: "Messages",
		items: [
			{ type: "send-text", label: "Text", icon: Send, category: "message" },
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
	start: "Start",
	"trigger-keyword": "Keyword Match",
	"trigger-any": "Any Message",
	"trigger-webhook": "Webhook",
	"trigger-schedule": "Schedule",
	"send-text": "Send Text",
	"send-image": "Send Image",
	"send-video": "Send Video",
	"send-audio": "Send Audio",
	"send-document": "Send Document",
	"send-location": "Send Location",
	"send-reaction": "Send Reaction",
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

export function createStartNode(): Node {
	return {
		id: "start",
		type: "start",
		position: { x: 40, y: 120 },
		deletable: false,
		data: { id: "start", nodeType: "start", label: "Start", category: "start" },
	};
}

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
		case "trigger-keyword":
			return { ...base, data: { ...base.data, keyword: "" } };
		case "trigger-webhook":
			return {
				...base,
				data: { ...base.data, webhookToken: crypto.randomUUID() },
			};
		case "trigger-schedule":
			return {
				...base,
				data: { ...base.data, cronExpression: "", contactNumber: "" },
			};
		case "send-text":
			return { ...base, data: { ...base.data, text: "" } };
		case "send-image":
		case "send-video":
		case "send-audio":
			return { ...base, data: { ...base.data, mediaUrl: "", caption: "" } };
		case "send-document":
			return { ...base, data: { ...base.data, mediaUrl: "", fileName: "" } };
		case "send-location":
			return {
				...base,
				data: { ...base.data, latitude: 0, longitude: 0, address: "" },
			};
		case "send-reaction":
			return { ...base, data: { ...base.data, emoji: "" } };
		case "send-button":
			return {
				...base,
				data: { ...base.data, bodyText: "", footerText: "", buttons: [] },
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
				},
			};
		case "send-quick-reply":
			return { ...base, data: { ...base.data, bodyText: "", buttons: [] } };
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
				data: { ...base.data, variableName: "reply", timeoutMinutes: 1440 },
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
					webhookHeaders: {},
				},
			};
		default:
			return base;
	}
}
