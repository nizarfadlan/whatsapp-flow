import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "@whatsapp-flow/db";
import {
	channel,
	chatGroup,
	contact as contactTable,
} from "@whatsapp-flow/db/schema/contact";
import {
	device,
	flow,
	flowExecutionEvent,
	flowExecutionLog,
	flowSession,
} from "@whatsapp-flow/db/schema/device";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import type {
	IncomingReplyDescriptor,
	OutgoingMessage,
	ProviderMessageRef,
	SendResult,
} from "@whatsapp-flow/whatsapp";
import {
	connectionManager,
	derivePrivateIdentityKey,
	deriveThreadKey,
	phoneNumberFromJid,
	sendDeviceMessage,
} from "@whatsapp-flow/whatsapp";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { incrementCounter } from "../observability/metrics";
import {
	getFlowNodeSecret,
	WEBHOOK_AUTH_SECRET_KEY,
} from "./flow-node-secrets";
import { enqueueJob } from "./job-queue";
import {
	delayFlowContinuationJobIdempotencyKey,
	type FlowContinueJobPayload,
	waitTimeoutJobIdempotencyKey,
	waitWarningJobIdempotencyKey,
} from "./job-types";

type FlowNode = {
	id: string;
	type: string;
	data: Record<string, unknown>;
};

type FlowEdge = {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string | null;
};

type InteractiveOption = {
	handle: string;
	id: string;
	text: string;
	index: number;
};

export type WaitContextV1 = {
	version: 1;
	kind: "interactive" | "poll";
	deliveryMode: "text_fallback" | "native_poll";
	provider?: SendResult["provider"];
	/** Complete creation key required to bind native Baileys poll updates. */
	pollMessageKey?: import("baileys").WAMessageKey;
	options: Array<
		InteractiveOption & {
			nextNodeIds: string[];
		}
	>;
};

type NodeResult = {
	nodeId: string;
	status: "success" | "error";
	output?: string;
	error?: string;
};

type TemplateContext = {
	contactNumber: string | null;
	contactKey: string;
	incomingText: string;
	variables: Record<string, unknown>;
};

type ExecutionContext = TemplateContext & {
	flowId: string;
	replyJid: string;
	deviceId: string;
	logId: string;
	variables: Record<string, string>;
	nodeResults: NodeResult[];
	claimJobId?: string | null;
	triggerMessageKey?: import("baileys").WAMessageKey;
	triggerProviderMessageId?: string;
	interactiveSendResult?: SendResult;
	interactiveOptions?: InteractiveOption[];
};

type ExecutionStatus = "running" | "waiting" | "completed" | "failed";
type FlowSessionStatus =
	| "waiting"
	| "running"
	| "completed"
	| "expired"
	| "failed";
type TriggerSource = "message" | "schedule" | "webhook" | "session";

type FlowExecutionEventInput = {
	executionLogId: string;
	flowId: string;
	deviceId: string;
	contactNumber: string | null;
	contactKey?: string | null;
	type: string;
	sessionId?: string | null;
	nodeId?: string | null;
	message?: string | null;
	payload?: Record<string, unknown>;
};

type ExecutionOptions = {
	replyJid?: string;
	contactKey?: string;
	triggerSource?: TriggerSource;
	triggerMessageKey?: import("baileys").WAMessageKey;
	triggerProviderMessageId?: string;
};

type ExecutionResult = {
	status: "completed" | "failed" | "waiting" | "skipped";
	logId?: string;
	sessionId?: string;
	error?: string;
};

type RunResult =
	| { status: "completed"; hasError: boolean }
	| { status: "waiting"; sessionId: string }
	| { status: "delayed" }
	| { status: "failed"; error: string };

function buildAdjacencyMap(edges: FlowEdge[]) {
	const map = new Map<string, FlowEdge[]>();
	for (const edge of edges) {
		const list = map.get(edge.source) ?? [];
		list.push(edge);
		map.set(edge.source, list);
	}
	return map;
}

function getTriggerNode(nodes: FlowNode[]) {
	// Support both unified "trigger" node and legacy "trigger-*" shapes.
	return nodes.find(
		(node) => node.type === "trigger" || node.type?.startsWith("trigger-"),
	);
}

function getNextNodes(
	nodeId: string,
	adjacency: Map<string, FlowEdge[]>,
	nodes: FlowNode[],
	handle?: string,
) {
	const edges = adjacency.get(nodeId) ?? [];
	const filtered = handle
		? edges.filter((edge) => edge.sourceHandle === handle)
		: edges;
	const nodeMap = new Map(nodes.map((node) => [node.id, node]));
	return filtered
		.map((edge) => nodeMap.get(edge.target))
		.filter((node): node is FlowNode => node != null);
}

function getNextNodeIds(
	nodeId: string,
	adjacency: Map<string, FlowEdge[]>,
	handle?: string,
) {
	return (adjacency.get(nodeId) ?? [])
		.filter((edge) => !handle || edge.sourceHandle === handle)
		.map((edge) => edge.target);
}

export function isInteractiveNode(type: string) {
	return (
		type === "send-button" ||
		type === "send-list" ||
		type === "send-quick-reply" ||
		type === "send-poll"
	);
}

export function getInteractiveOptions(node: FlowNode): InteractiveOption[] {
	if (!isInteractiveNode(node.type)) return [];
	const data = node.data;
	const options =
		node.type === "send-list"
			? (
					(data.sections as
						| {
								title: string;
								rows: { id: string; title: string; description?: string }[];
						  }[]
						| undefined) ?? []
				).flatMap((section) =>
					(section.rows ?? []).map((row) => ({
						id: row.id,
						text: row.title,
					})),
				)
			: (((node.type === "send-poll" ? data.options : data.buttons) as
					| { id: string; text: string }[]
					| undefined) ?? []);

	return options
		.map((option, index) => ({
			handle: `option:${option.id}`,
			id: option.id,
			text: String(option.text ?? "").trim(),
			index: index + 1,
		}))
		.filter((option) => option.id && option.text);
}

export function resolveInteractiveReply(node: FlowNode, incomingText: string) {
	return resolveInteractiveOption(getInteractiveOptions(node), incomingText);
}

function resolveInteractiveOption<T extends InteractiveOption>(
	options: T[],
	incomingText: string,
): T | null {
	const normalized = incomingText.trim();
	const numeric = Number(normalized);
	if (Number.isInteger(numeric) && numeric >= 1) {
		const byIndex = options.find((option) => option.index === numeric);
		if (byIndex) return byIndex;
	}

	const byId = options.find((option) => option.id === normalized);
	if (byId) return byId;

	const lowered = normalized.toLowerCase();
	return (
		options.find((option) => option.text.toLowerCase() === lowered) ?? null
	);
}

export function buildInteractiveWaitContext(
	node: FlowNode,
	adjacency: Map<string, FlowEdge[]>,
	sendResult?: SendResult | SendResult["provider"],
	optionsOverride?: InteractiveOption[],
): WaitContextV1 {
	const poll = node.type === "send-poll";
	const result = typeof sendResult === "string" ? undefined : sendResult;
	const provider =
		typeof sendResult === "string" ? sendResult : result?.provider;
	return {
		version: 1,
		kind: poll ? "poll" : "interactive",
		deliveryMode:
			poll && result?.deliveryMode === "native_poll"
				? "native_poll"
				: "text_fallback",
		...(provider ? { provider } : {}),
		...(poll && result?.messageKey
			? { pollMessageKey: result.messageKey }
			: {}),
		options: (optionsOverride ?? getInteractiveOptions(node)).map((option) => ({
			...option,
			nextNodeIds: getNextNodeIds(node.id, adjacency, option.handle),
		})),
	};
}

export function parseInteractiveWaitContext(
	value: unknown,
): WaitContextV1 | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const context = value as Record<string, unknown>;
	if (
		context.version !== 1 ||
		(context.kind !== "interactive" && context.kind !== "poll") ||
		(context.deliveryMode !== "text_fallback" &&
			context.deliveryMode !== "native_poll") ||
		!Array.isArray(context.options)
	) {
		return null;
	}

	const provider = context.provider;
	if (
		provider !== undefined &&
		provider !== "baileys" &&
		provider !== "meta_cloud"
	) {
		return null;
	}

	const options: WaitContextV1["options"] = [];
	for (const value of context.options) {
		if (!value || typeof value !== "object" || Array.isArray(value))
			return null;
		const option = value as Record<string, unknown>;
		const index = option.index;
		if (
			typeof option.id !== "string" ||
			typeof option.text !== "string" ||
			typeof option.handle !== "string" ||
			typeof index !== "number" ||
			!Number.isInteger(index) ||
			index < 1 ||
			!Array.isArray(option.nextNodeIds) ||
			!option.nextNodeIds.every((nodeId) => typeof nodeId === "string")
		) {
			return null;
		}
		options.push({
			id: option.id,
			text: option.text,
			handle: option.handle,
			index,
			nextNodeIds: option.nextNodeIds,
		});
	}

	const kind = context.kind;
	const deliveryMode = context.deliveryMode;
	const pollMessageKey = context.pollMessageKey;
	if (kind === "interactive" && deliveryMode !== "text_fallback") return null;
	if (
		kind === "poll" &&
		deliveryMode === "native_poll" &&
		(!pollMessageKey ||
			typeof pollMessageKey !== "object" ||
			typeof (pollMessageKey as { id?: unknown }).id !== "string" ||
			typeof (pollMessageKey as { remoteJid?: unknown }).remoteJid !== "string")
	) {
		return null;
	}
	return {
		version: 1,
		kind,
		deliveryMode,
		...(provider ? { provider } : {}),
		...(kind === "poll" && pollMessageKey
			? { pollMessageKey: pollMessageKey as import("baileys").WAMessageKey }
			: {}),
		options,
	};
}

export function resolveInteractiveWaitReply(
	context: WaitContextV1,
	incomingText: string,
	reply?: IncomingReplyDescriptor,
) {
	if (reply?.selectedId) {
		const selected = context.options.find(
			(option) => option.id === reply.selectedId,
		);
		if (selected) return selected;
	}
	if (reply?.selectedText) {
		const selected = context.options.find(
			(option) =>
				option.text.toLowerCase() === reply.selectedText?.trim().toLowerCase(),
		);
		if (selected) return selected;
	}
	return resolveInteractiveOption(context.options, incomingText);
}

function getNodesByIds(nodeIds: string[], nodes: FlowNode[]) {
	const nodeMap = new Map(nodes.map((node) => [node.id, node]));
	return nodeIds
		.map((nodeId) => nodeMap.get(nodeId))
		.filter((node): node is FlowNode => node != null);
}

export function getInteractiveWaitSnapshotTargets(
	selected: WaitContextV1["options"][number],
	nodes: FlowNode[],
) {
	const nodeMap = new Map(nodes.map((node) => [node.id, node]));
	const missingNodeIds = selected.nextNodeIds.filter(
		(nodeId) => !nodeMap.has(nodeId),
	);
	return {
		nodes: selected.nextNodeIds
			.map((nodeId) => nodeMap.get(nodeId))
			.filter((node): node is FlowNode => node != null),
		missingNodeIds,
	};
}

export function getWaitingBranchMissingError(
	selected: InteractiveOption,
	missingNodeIds: string[] = [],
) {
	const detail =
		missingNodeIds.length > 0 ? `: ${missingNodeIds.join(", ")}` : "";
	return `waiting_branch_missing: Selected option ${selected.index}. ${selected.text} has missing target${missingNodeIds.length === 1 ? "" : "s"}${detail}`;
}

function evaluateCondition(
	field: string,
	operator: string,
	value: string,
	ctx: ExecutionContext,
) {
	let resolved = "";
	if (field === "message.text") resolved = ctx.incomingText;
	else if (field.startsWith("variables.")) {
		resolved = ctx.variables[field.slice("variables.".length)] ?? "";
	} else resolved = field;

	switch (operator) {
		case "equals":
			return resolved.trim().toLowerCase() === value.trim().toLowerCase();
		case "contains":
			return resolved.toLowerCase().includes(value.toLowerCase());
		case "starts-with":
			return resolved.toLowerCase().startsWith(value.toLowerCase());
		case "regex":
			try {
				return new RegExp(value).test(resolved);
			} catch {
				return false;
			}
		default:
			return false;
	}
}

export function buildPollMessage(
	node: FlowNode,
	jid: string,
	ctx: TemplateContext,
) {
	if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid")) {
		throw new Error("Poll flows are supported only in private chats");
	}
	const name = resolveFlowTemplate(
		String(node.data.question ?? ""),
		ctx,
	).trim();
	const options = getInteractiveOptions(node).map((option) => ({
		...option,
		text: resolveFlowTemplate(option.text, ctx).trim(),
	}));
	if (!name || options.length < 2 || options.some((option) => !option.text)) {
		throw new Error(
			"Poll question and at least two non-empty options are required",
		);
	}
	if (new Set(options.map((option) => option.text)).size !== options.length) {
		throw new Error("Poll option text must be unique");
	}
	const fallbackText = [
		name,
		...options.map((option) => `${option.index}. ${option.text}`),
	].join("\n");
	return {
		message: {
			type: "poll" as const,
			name,
			values: options.map((option) => option.text),
			selectableCount: 1 as const,
			fallbackText,
		},
		options,
	};
}

async function executeNode(node: FlowNode, ctx: ExecutionContext) {
	const type = node.type;
	const data = node.data;
	const jid = ctx.replyJid;

	try {
		switch (type) {
			case "send-text": {
				const text = resolveTemplate(String(data.text ?? ""), ctx);
				const sendResult = await sendDeviceMessage(ctx.deviceId, jid, {
					type: "text",
					text,
				});
				void recordOutboundMessage(ctx, "text", text, undefined, sendResult);
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "success",
					output: text,
				});
				return true;
			}
			case "send-template": {
				const name = resolveTemplate(String(data.templateName ?? ""), ctx);
				const languageCode = resolveTemplate(
					String(data.languageCode ?? "en_US"),
					ctx,
				);
				const bodyParameters = Array.isArray(data.templateBodyParams)
					? data.templateBodyParams.map((param) =>
							resolveTemplate(String(param), ctx),
						)
					: [];
				const sendResult = await sendDeviceMessage(ctx.deviceId, jid, {
					type: "template",
					name,
					languageCode,
					bodyParameters,
				});
				const text = `Template: ${name}`;
				void recordOutboundMessage(
					ctx,
					"template",
					text,
					{ template: { name, languageCode, bodyParameters } },
					sendResult,
				);
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "success",
					output: text,
				});
				return true;
			}
			case "send-image":
			case "send-video":
			case "send-audio": {
				const url = String(data.mediaUrl ?? "");
				const caption = data.caption
					? resolveTemplate(String(data.caption), ctx)
					: undefined;
				const messageType =
					type === "send-image"
						? "image"
						: type === "send-video"
							? "video"
							: "audio";
				const sendResult = await sendDeviceMessage(ctx.deviceId, jid, {
					type: messageType,
					url,
					caption,
				} as OutgoingMessage);
				void recordOutboundMessage(
					ctx,
					messageType,
					caption ?? url,
					{ media: { type: messageType, url } },
					sendResult,
				);
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "success",
					output: url,
				});
				return true;
			}
			case "send-document": {
				const url = String(data.mediaUrl ?? "");
				const fileName = String(data.fileName ?? "file");
				const sendResult = await sendDeviceMessage(ctx.deviceId, jid, {
					type: "document",
					url,
					fileName,
				});
				void recordOutboundMessage(
					ctx,
					"document",
					fileName,
					{ media: { type: "document", url, fileName } },
					sendResult,
				);
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "success",
					output: fileName,
				});
				return true;
			}
			case "send-location": {
				const latitude = Number(data.latitude);
				const longitude = Number(data.longitude);
				if (
					!Number.isFinite(latitude) ||
					latitude < -90 ||
					latitude > 90 ||
					!Number.isFinite(longitude) ||
					longitude < -180 ||
					longitude > 180
				) {
					ctx.nodeResults.push({
						nodeId: node.id,
						status: "error",
						error: "Invalid location coordinates",
					});
					return false;
				}
				const name = data.address ? String(data.address) : undefined;
				const sendResult = await sendDeviceMessage(ctx.deviceId, jid, {
					type: "location",
					latitude,
					longitude,
					name,
				});
				void recordOutboundMessage(
					ctx,
					"location",
					name ?? `${latitude}, ${longitude}`,
					{ location: { latitude, longitude, name } },
					sendResult,
				);
				ctx.nodeResults.push({ nodeId: node.id, status: "success" });
				return true;
			}
			case "send-reaction": {
				const emoji = String(data.emoji ?? "");
				if (!emoji) {
					ctx.nodeResults.push({
						nodeId: node.id,
						status: "error",
						error: "No emoji configured",
					});
					return false;
				}
				if (!ctx.triggerMessageKey && !ctx.triggerProviderMessageId) {
					// Reaction requires a provider reference for the triggering message.
					// Gracefully skip when triggered by schedule/webhook (no message reference).
					ctx.nodeResults.push({
						nodeId: node.id,
						status: "success",
						output: "skipped:no_message_key",
					});
					return true;
				}
				await sendDeviceMessage(ctx.deviceId, jid, {
					type: "reaction",
					text: emoji,
					messageKey: ctx.triggerMessageKey,
					providerMessageId: ctx.triggerProviderMessageId,
				});
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "success",
					output: emoji,
				});
				return true;
			}
			case "send-button": {
				const bodyText = resolveTemplate(String(data.bodyText ?? ""), ctx);
				const buttons = (data.buttons as { text: string }[] | undefined) ?? [];
				const footer = data.footerText
					? resolveTemplate(String(data.footerText), ctx)
					: undefined;
				const sendResult = await sendDeviceMessage(ctx.deviceId, jid, {
					type: "text",
					text: [
						bodyText,
						...buttons.map((button, index) => `${index + 1}. ${button.text}`),
						footer,
					]
						.filter(Boolean)
						.join("\n"),
				});
				await recordOutboundMessage(
					ctx,
					"text",
					bodyText,
					undefined,
					sendResult,
				);
				ctx.interactiveSendResult = sendResult;
				ctx.nodeResults.push({ nodeId: node.id, status: "success" });
				return true;
			}
			case "send-list": {
				const bodyText = resolveTemplate(String(data.bodyText ?? ""), ctx);
				const footer = data.footerText
					? resolveTemplate(String(data.footerText), ctx)
					: undefined;
				const sections =
					(data.sections as
						| {
								title: string;
								rows: { id: string; title: string; description?: string }[];
						  }[]
						| undefined) ?? [];
				const lines: string[] = [bodyText];
				let optionIndex = 1;
				for (const section of sections) {
					if (section.title) lines.push(`\n*${section.title}*`);
					for (const row of section.rows) {
						lines.push(
							row.description
								? `${optionIndex}. ${row.title} — ${row.description}`
								: `${optionIndex}. ${row.title}`,
						);
						optionIndex++;
					}
				}
				if (footer) lines.push(`\n_${footer}_`);
				const sendResult = await sendDeviceMessage(ctx.deviceId, jid, {
					type: "text",
					text: lines.join("\n"),
				});
				await recordOutboundMessage(
					ctx,
					"text",
					bodyText,
					undefined,
					sendResult,
				);
				ctx.interactiveSendResult = sendResult;
				ctx.nodeResults.push({ nodeId: node.id, status: "success" });
				return true;
			}
			case "send-quick-reply": {
				const bodyText = resolveTemplate(String(data.bodyText ?? ""), ctx);
				const buttons =
					((node.type === "send-poll" ? data.options : data.buttons) as
						| { id: string; text: string }[]
						| undefined) ?? [];
				const lines: string[] = [bodyText];
				for (let i = 0; i < buttons.length; i++) {
					lines.push(`${i + 1}. ${buttons[i]?.text ?? ""}`);
				}
				const sendResult = await sendDeviceMessage(ctx.deviceId, jid, {
					type: "text",
					text: lines.join("\n"),
				});
				await recordOutboundMessage(
					ctx,
					"text",
					bodyText,
					undefined,
					sendResult,
				);
				ctx.interactiveSendResult = sendResult;
				ctx.nodeResults.push({ nodeId: node.id, status: "success" });
				return true;
			}
			case "send-poll": {
				const { message, options } = buildPollMessage(node, jid, ctx);
				const sendResult = await sendDeviceMessage(ctx.deviceId, jid, message);
				await recordOutboundMessage(
					ctx,
					"poll",
					message.fallbackText,
					undefined,
					sendResult,
				);
				ctx.interactiveSendResult = sendResult;
				ctx.interactiveOptions = options;
				ctx.nodeResults.push({ nodeId: node.id, status: "success" });
				return true;
			}
			case "set-variable": {
				const name = String(data.variableName ?? "");
				const value = resolveTemplate(String(data.variableValue ?? ""), ctx);
				ctx.variables[name] = value;
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "success",
					output: `${name}=${value}`,
				});
				return true;
			}
			case "delay": {
				const seconds = Number(data.delaySeconds ?? 0);
				if (seconds > 0) {
					await new Promise((resolve) =>
						setTimeout(resolve, Math.min(seconds * 1000, 60_000)),
					);
				}
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "success",
					output: `${seconds}s`,
				});
				return true;
			}
			case "webhook-call": {
				const method = String(data.webhookMethod ?? "POST").toUpperCase();
				if (!["GET", "POST", "PUT"].includes(method)) {
					throw new Error("Webhook method is not allowed");
				}
				const url = resolveTemplate(String(data.webhookUrl ?? ""), ctx);
				if (getWebhookAuth(data.webhookAuth).type !== "none") {
					let parsedUrl: URL;
					try {
						parsedUrl = new URL(url);
					} catch {
						throw new Error("Webhook URL is invalid");
					}
					if (parsedUrl.protocol !== "https:") {
						throw new Error("Authenticated webhook URLs must use HTTPS");
					}
				}
				const headers = await buildWebhookHeaders(ctx, node, method);
				const response = await fetchWebhookUrl(
					url,
					method,
					JSON.stringify({
						contact: ctx.contactNumber,
						variables: ctx.variables,
					}),
					headers,
				);
				ctx.nodeResults.push({
					nodeId: node.id,
					status: response.ok ? "success" : "error",
					output: `${response.status}`,
					error: response.ok
						? undefined
						: `Webhook returned ${response.status}`,
				});
				return response.ok;
			}
			case "forward": {
				const target = normalizeNumber(
					resolveTemplate(String(data.targetNumber ?? ""), ctx),
				);
				const targetJid = target ? `${target}@s.whatsapp.net` : null;
				if (targetJid) {
					// Forward the incoming message text; include attribution.
					const forwardBody = ctx.incomingText
						? `*Forwarded from ${ctx.contactNumber}:*\n${ctx.incomingText}`
						: `*Forwarded from ${ctx.contactNumber}* (media message)`;
					const template = String(data.messageTemplate ?? "").trim();
					const text = template ? resolveTemplate(template, ctx) : forwardBody;
					await sendDeviceMessage(ctx.deviceId, targetJid, {
						type: "text",
						text,
					});
					ctx.nodeResults.push({
						nodeId: node.id,
						status: "success",
						output: target,
					});
				} else {
					ctx.nodeResults.push({
						nodeId: node.id,
						status: "error",
						error: "No target number configured",
					});
				}
				return !!targetJid;
			}
			case "end":
			case "condition":
			case "random":
				ctx.nodeResults.push({ nodeId: node.id, status: "success" });
				return true;
			default:
				ctx.nodeResults.push({ nodeId: node.id, status: "success" });
				return true;
		}
	} catch (error) {
		ctx.nodeResults.push({
			nodeId: node.id,
			status: "error",
			error: error instanceof Error ? error.message : "Unknown error",
		});
		return false;
	} finally {
		void persistProgress(ctx.logId, ctx.nodeResults);
	}
}

async function persistProgress(
	logId: string,
	nodeResults: NodeResult[],
	error?: string,
	status?: ExecutionStatus,
) {
	try {
		const updates: Partial<typeof flowExecutionLog.$inferInsert> = {
			nodeResults,
		};
		if (error) updates.error = error;
		if (status) updates.status = status;
		if (status === "completed" || status === "failed") {
			updates.completedAt = new Date();
		}
		const [updated] = await db
			.update(flowExecutionLog)
			.set(updates)
			.where(eq(flowExecutionLog.id, logId))
			.returning({
				id: flowExecutionLog.id,
				flowId: flowExecutionLog.flowId,
				deviceId: flowExecutionLog.deviceId,
			});
		if (updated) {
			connectionManager.emit("flow:log:updated", {
				logId: updated.id,
				flowId: updated.flowId,
				deviceId: updated.deviceId,
			});
		}
	} catch (error) {
		console.error("Failed to persist flow progress", { logId, error });
	}
}

function emitLogCreated(log: { id: string; flowId: string; deviceId: string }) {
	connectionManager.emit("flow:log:updated", {
		logId: log.id,
		flowId: log.flowId,
		deviceId: log.deviceId,
	});
}

export function emitFlowSessionUpdated(session: {
	id: string;
	flowId: string;
	deviceId: string;
	executionLogId: string;
	contactNumber: string | null;
	contactKey: string;
	status: FlowSessionStatus;
}) {
	connectionManager.emit("flow:session:updated", {
		sessionId: session.id,
		flowId: session.flowId,
		deviceId: session.deviceId,
		executionLogId: session.executionLogId,
		contactNumber: session.contactNumber,
		contactKey: session.contactKey,
		status: session.status,
	});
}

export async function recordFlowExecutionEvent(input: FlowExecutionEventInput) {
	const id = crypto.randomUUID();
	const createdAt = new Date();
	const payload = input.payload ?? {};
	const sessionId = input.sessionId ?? null;
	const nodeId = input.nodeId ?? null;
	const message = input.message ?? null;
	const contactKey =
		input.contactKey ??
		derivePrivateIdentityKey({ number: input.contactNumber });

	try {
		await db.insert(flowExecutionEvent).values({
			id,
			executionLogId: input.executionLogId,
			flowId: input.flowId,
			deviceId: input.deviceId,
			sessionId,
			contactNumber: input.contactNumber,
			contactKey,
			type: input.type,
			nodeId,
			message,
			payload,
			createdAt,
		});
		connectionManager.emit("flow:execution-event", {
			id,
			executionLogId: input.executionLogId,
			flowId: input.flowId,
			deviceId: input.deviceId,
			sessionId,
			contactNumber: input.contactNumber,
			contactKey,
			type: input.type,
			nodeId,
			message,
			payload,
			createdAt: createdAt.toISOString(),
		});
	} catch (error) {
		console.warn("Failed to record flow execution event", {
			flowId: input.flowId,
			executionLogId: input.executionLogId,
			type: input.type,
			error,
		});
	}
}

function maskUserReply(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (trimmed.length <= 4) return "••••";
	return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
}

export function resolveFlowTemplate(text: string, ctx: TemplateContext) {
	return text.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
		if (key === "contact.number") return ctx.contactNumber ?? "";
		if (key === "contact.key") return ctx.contactKey;
		if (key === "contact.identifier")
			return ctx.contactNumber ?? ctx.contactKey;
		if (key === "message.text") return ctx.incomingText;
		const value = key.startsWith("variables.")
			? ctx.variables[key.slice("variables.".length)]
			: ctx.variables[key];
		return value == null ? `{{${key}}}` : String(value);
	});
}

function resolveTemplate(text: string, ctx: ExecutionContext) {
	return resolveFlowTemplate(text, ctx);
}

const WEBHOOK_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const BLOCKED_WEBHOOK_HEADERS = new Set([
	"authorization",
	"cookie",
	"set-cookie",
	"host",
	"content-length",
	"connection",
	"transfer-encoding",
	"content-type",
]);

type WebhookHeaderConfig = { id: string; key: string; value: string };
type WebhookAuthConfig =
	| { type: "none" }
	| { type: "bearer"; hasSecret?: boolean }
	| { type: "basic"; username?: string; hasSecret?: boolean }
	| { type: "api_key"; apiKeyName?: string; hasSecret?: boolean };

function getWebhookAuth(value: unknown): WebhookAuthConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { type: "none" };
	}
	const data = value as Record<string, unknown>;
	if (data.type === "bearer")
		return { type: "bearer", hasSecret: data.hasSecret === true };
	if (data.type === "basic") {
		return {
			type: "basic",
			username: typeof data.username === "string" ? data.username : "",
			hasSecret: data.hasSecret === true,
		};
	}
	if (data.type === "api_key") {
		return {
			type: "api_key",
			apiKeyName: typeof data.apiKeyName === "string" ? data.apiKeyName : "",
			hasSecret: data.hasSecret === true,
		};
	}
	return { type: "none" };
}

function normalizeWebhookHeaders(value: unknown): WebhookHeaderConfig[] {
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				const data =
					item && typeof item === "object"
						? (item as Record<string, unknown>)
						: {};
				return {
					id: String(data.id ?? crypto.randomUUID()),
					key: String(data.key ?? data.name ?? "").trim(),
					value: String(data.value ?? ""),
				};
			})
			.filter((header) => header.key.length > 0 || header.value.length > 0);
	}
	if (value && typeof value === "object") {
		return Object.entries(value as Record<string, unknown>)
			.map(([key, item]) => ({
				id: crypto.randomUUID(),
				key: key.trim(),
				value: String(item ?? ""),
			}))
			.filter((header) => header.key.length > 0 || header.value.length > 0);
	}
	return [];
}

function validateWebhookHeaderName(name: string) {
	return (
		name.length > 0 &&
		name.length <= 128 &&
		WEBHOOK_HEADER_NAME_PATTERN.test(name)
	);
}

async function buildWebhookHeaders(
	ctx: ExecutionContext,
	node: FlowNode,
	method: string,
) {
	const headers: Record<string, string> = {};
	if (method !== "GET") headers["content-type"] = "application/json";

	const seenHeaders = new Set<string>();
	for (const header of normalizeWebhookHeaders(node.data.webhookHeaders)) {
		const key = header.key.trim();
		const lowerKey = key.toLowerCase();
		const value = resolveTemplate(header.value, ctx);
		if (
			!validateWebhookHeaderName(key) ||
			BLOCKED_WEBHOOK_HEADERS.has(lowerKey)
		) {
			throw new Error(`Webhook header ${key || "(empty)"} is not allowed`);
		}
		if (seenHeaders.has(lowerKey)) {
			throw new Error(`Webhook header ${key} is duplicated`);
		}
		if (value.length > 4096 || /[\r\n]/.test(value)) {
			throw new Error(`Webhook header ${key} has an invalid value`);
		}
		headers[key] = value;
		seenHeaders.add(lowerKey);
	}

	const auth = getWebhookAuth(node.data.webhookAuth);
	if (auth.type === "none") return headers;
	const secret = await getFlowNodeSecret(db, {
		flowId: ctx.flowId,
		nodeId: node.id,
		key: WEBHOOK_AUTH_SECRET_KEY,
	});
	if (!secret) throw new Error("Webhook auth secret is not configured");

	if (auth.type === "bearer") {
		headers.Authorization = `Bearer ${secret}`;
		return headers;
	}
	if (auth.type === "basic") {
		const username = auth.username?.trim() ?? "";
		if (!username)
			throw new Error("Webhook basic auth username is not configured");
		headers.Authorization = `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`;
		return headers;
	}
	if (auth.type === "api_key") {
		const apiKeyName = auth.apiKeyName?.trim() ?? "";
		const lowerKey = apiKeyName.toLowerCase();
		if (
			!validateWebhookHeaderName(apiKeyName) ||
			BLOCKED_WEBHOOK_HEADERS.has(lowerKey)
		) {
			throw new Error("Webhook API key header name is invalid");
		}
		if (seenHeaders.has(lowerKey)) {
			throw new Error("Webhook API key header duplicates a custom header");
		}
		headers[apiKeyName] = secret;
	}
	return headers;
}

function normalizeNumber(value: string) {
	return value.replace(/[^\d]/g, "");
}

function isActiveSessionUniqueConflict(error: unknown) {
	if (!error || typeof error !== "object") return false;
	const record = error as Record<string, unknown>;
	return (
		record.code === "23505" &&
		record.constraint === "flow_session_active_contact_key_unique_idx"
	);
}

export function getFlowSessionClaimOutcome(input: {
	status: string;
	sessionClaimJobId?: string | null;
	claimJobId?: string;
}) {
	if (input.status === "waiting") return "claim" as const;
	if (input.status === "running") {
		if (input.claimJobId && input.sessionClaimJobId === input.claimJobId) {
			return "reenter" as const;
		}
		return "owned_by_other" as const;
	}
	return "terminal" as const;
}

function runningSessionClaimFilter(
	sessionId: string,
	expectedClaimJobId?: string | null,
) {
	return and(
		eq(flowSession.id, sessionId),
		eq(flowSession.status, "running"),
		expectedClaimJobId
			? eq(flowSession.claimJobId, expectedClaimJobId)
			: isNull(flowSession.claimJobId),
	);
}

function runningSessionOwnershipFilter(
	session: typeof flowSession.$inferSelect,
) {
	return runningSessionClaimFilter(session.id, session.claimJobId);
}

export function getDelayContinuationClaimTransfer(input: {
	sessionId?: string;
	expectedClaimJobId?: string | null;
	continuationJobId: string;
}) {
	if (!input.sessionId) return null;
	return {
		sessionId: input.sessionId,
		expectedClaimJobId: input.expectedClaimJobId ?? null,
		claimJobId: input.continuationJobId,
		claimedAt: null,
		failureCode: null,
	};
}

async function recordOutboundMessage(
	ctx: ExecutionContext,
	messageType: string,
	text?: string,
	raw?: Record<string, unknown>,
	sendResult?: SendResult,
) {
	try {
		const now = new Date();
		const storedRaw = sendResult
			? {
					...(raw ?? {}),
					provider: sendResult.provider,
					response: sendResult.raw ?? null,
				}
			: raw;
		const chatJid = ctx.replyJid;
		let chatType: "private" | "group" | "channel" | "broadcast" = "private";
		if (chatJid.endsWith("@g.us")) {
			chatType = "group";
		} else if (chatJid.endsWith("@newsletter")) {
			chatType = "channel";
		} else if (chatJid.endsWith("@broadcast")) {
			chatType = "broadcast";
		}
		let contactId: string | null = null;
		let groupId: string | null = null;
		let channelId: string | null = null;
		const contactNumber = ctx.contactNumber ?? phoneNumberFromJid(chatJid);
		const contactIdentityKey =
			chatType === "private"
				? ctx.contactKey ||
					derivePrivateIdentityKey({ jid: chatJid, number: contactNumber })
				: null;
		const threadKey = deriveThreadKey({
			chatType,
			chatJid,
			contactIdentityKey,
			groupJid: chatType === "group" ? chatJid : null,
			channelJid: chatType === "channel" ? chatJid : null,
		});

		if (chatType === "private") {
			const [savedContact] = await db
				.insert(contactTable)
				.values({
					id: crypto.randomUUID(),
					deviceId: ctx.deviceId,
					jid: chatJid,
					identityKey: contactIdentityKey ?? ctx.contactKey,
					phoneNumber: contactNumber,
					source: "message",
				})
				.onConflictDoUpdate({
					target: [contactTable.deviceId, contactTable.identityKey],
					set: { jid: chatJid, phoneNumber: contactNumber, updatedAt: now },
				})
				.returning({ id: contactTable.id });
			contactId = savedContact?.id ?? null;
		} else if (chatType === "group") {
			const [savedGroup] = await db
				.insert(chatGroup)
				.values({
					id: crypto.randomUUID(),
					deviceId: ctx.deviceId,
					jid: chatJid,
					subject: chatJid,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [chatGroup.deviceId, chatGroup.jid],
					set: { updatedAt: now },
				})
				.returning({ id: chatGroup.id });
			groupId = savedGroup?.id ?? null;
		} else if (chatType === "channel") {
			const [savedChannel] = await db
				.insert(channel)
				.values({
					id: crypto.randomUUID(),
					deviceId: ctx.deviceId,
					jid: chatJid,
					name: chatJid,
					source: "sync",
				})
				.onConflictDoUpdate({
					target: [channel.deviceId, channel.jid],
					set: { updatedAt: now },
				})
				.returning({ id: channel.id });
			channelId = savedChannel?.id ?? null;
		}

		const [savedThread] = await db
			.insert(inboxThread)
			.values({
				id: crypto.randomUUID(),
				deviceId: ctx.deviceId,
				chatType,
				threadKey,
				chatJid,
				contactId,
				groupId,
				channelId,
				groupJid: chatType === "group" ? chatJid : null,
				channelJid: chatType === "channel" ? chatJid : null,
				contactNumber: chatType === "private" ? contactNumber : null,
				lastMessageText: text ?? null,
				lastMessageAt: now,
				unreadCount: 0,
			})
			.onConflictDoUpdate({
				target: [inboxThread.deviceId, inboxThread.threadKey],
				set: {
					chatType,
					contactId,
					groupId,
					channelId,
					groupJid: chatType === "group" ? chatJid : null,
					channelJid: chatType === "channel" ? chatJid : null,
					contactNumber: chatType === "private" ? contactNumber : null,
					lastMessageText: text ?? null,
					lastMessageAt: now,
				},
			})
			.returning({ id: inboxThread.id });

		const threadId = savedThread?.id;

		if (threadId) {
			await db
				.insert(inboxMessage)
				.values({
					id: crypto.randomUUID(),
					threadId,
					direction: "outbound",
					messageType,
					text: text ?? null,
					providerMessageId: sendResult?.messageId ?? null,
					deliveryStatus: sendResult
						? sendResult.provider === "meta_cloud"
							? "accepted"
							: "sent"
						: null,
					raw: storedRaw ?? null,
				})
				.onConflictDoNothing();
			connectionManager.emit("inbox:updated", {
				deviceId: ctx.deviceId,
				threadId,
			});
		}
	} catch (error) {
		console.warn("Failed to persist outbound inbox message", {
			flowId: ctx.flowId,
			deviceId: ctx.deviceId,
			contactNumber: ctx.contactNumber,
			contactKey: ctx.contactKey,
			error,
		});
	}
}

function isPrivateIpAddress(address: string) {
	if (address === "::1" || address.toLowerCase().startsWith("fe80:"))
		return true;
	if (address.startsWith("::ffff:")) {
		return isPrivateIpAddress(address.slice("::ffff:".length));
	}

	const parts = address.split(".").map((part) => Number(part));
	if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
		const [a, b] = parts as [number, number, number, number];
		return (
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a === 0
		);
	}

	return address.startsWith("fc") || address.startsWith("fd");
}

async function assertSafeWebhookUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Webhook URL is invalid");
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("Webhook URL must use HTTP or HTTPS");
	}
	if (url.username || url.password) {
		throw new Error("Webhook URL cannot include credentials");
	}

	const hostname = url.hostname.toLowerCase();
	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		throw new Error("Webhook URL cannot target localhost");
	}

	let resolved: { address: string }[];
	try {
		resolved = isIP(hostname)
			? [{ address: hostname }]
			: await lookup(hostname, { all: true });
	} catch {
		throw new Error("Webhook URL host cannot be resolved");
	}
	if (resolved.some((item) => isPrivateIpAddress(item.address))) {
		throw new Error("Webhook URL cannot target private networks");
	}
}

async function fetchWebhookUrl(
	value: string,
	method: string,
	body: string,
	headers: Record<string, string>,
) {
	let currentUrl = value;
	let currentMethod = method;
	const initialOrigin = new URL(value).origin;
	for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
		await assertSafeWebhookUrl(currentUrl);
		const sameOrigin = new URL(currentUrl).origin === initialOrigin;
		const requestHeaders = sameOrigin
			? headers
			: currentMethod === "GET"
				? undefined
				: { "content-type": "application/json" };
		const response = await fetch(currentUrl, {
			method: currentMethod,
			headers:
				currentMethod === "GET" && !sameOrigin ? undefined : requestHeaders,
			body: currentMethod === "GET" ? undefined : body,
			redirect: "manual",
			signal: AbortSignal.timeout(10_000),
		});

		if (![301, 302, 303, 307, 308].includes(response.status)) {
			return response;
		}

		const location = response.headers.get("location");
		if (!location) return response;
		currentUrl = new URL(location, currentUrl).toString();
		if (response.status === 303) currentMethod = "GET";
	}

	throw new Error("Webhook URL redirected too many times");
}

function normalizeVariables(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, String(item ?? "")]),
	);
}

function normalizeNodeResults(value: unknown): NodeResult[] {
	return Array.isArray(value) ? (value as NodeResult[]) : [];
}

function normalizeNodeIds(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

async function runFlowNodes({
	nodes,
	edges,
	startNodes,
	ctx,
	previousSessionId,
}: {
	nodes: FlowNode[];
	edges: FlowEdge[];
	startNodes: FlowNode[];
	ctx: ExecutionContext;
	previousSessionId?: string;
}): Promise<RunResult> {
	const adjacency = buildAdjacencyMap(edges);
	const visited = new Set<string>();
	const queue = startNodes.map((node) => ({ node }));
	let hasError = false;

	while (queue.length > 0) {
		const item = queue.shift();
		if (!item || visited.has(item.node.id)) continue;
		visited.add(item.node.id);

		if (item.node.type === "wait-for-reply") {
			const session = await createWaitingSession(
				item.node,
				adjacency,
				ctx,
				previousSessionId,
			);
			if (!session) {
				return {
					status: "failed",
					error: "Contact already has an active flow session",
				};
			}
			return { status: "waiting", sessionId: session.id };
		}

		if (item.node.type === "delay" && getDelaySeconds(item.node) > 0) {
			try {
				await scheduleDelayContinuation(
					item.node,
					adjacency,
					ctx,
					previousSessionId,
				);
				return { status: "delayed" };
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Failed to schedule delay continuation";
				ctx.nodeResults.push({
					nodeId: item.node.id,
					status: "error",
					error: message,
				});
				await persistProgress(ctx.logId, ctx.nodeResults, message, "failed");
				return { status: "failed", error: message };
			}
		}

		const ok = await executeNode(item.node, ctx);
		let result: NodeResult | undefined;
		for (let i = ctx.nodeResults.length - 1; i >= 0; i--) {
			if (ctx.nodeResults[i]?.nodeId === item.node.id) {
				result = ctx.nodeResults[i];
				break;
			}
		}
		await recordFlowExecutionEvent({
			executionLogId: ctx.logId,
			flowId: ctx.flowId,
			deviceId: ctx.deviceId,
			contactNumber: ctx.contactNumber,
			contactKey: ctx.contactKey,
			sessionId: previousSessionId ?? null,
			type: ok ? "node.completed" : "node.failed",
			nodeId: item.node.id,
			message: result?.error ?? result?.output ?? null,
			payload: { output: result?.output, error: result?.error },
		});
		if (!ok) hasError = true;

		if (ok && isInteractiveNode(item.node.type)) {
			const session = await createWaitingSession(
				item.node,
				adjacency,
				ctx,
				previousSessionId,
			);
			if (!session) {
				return {
					status: "failed",
					error: "Contact already has an active flow session",
				};
			}
			return { status: "waiting", sessionId: session.id };
		}

		if (item.node.type === "condition") {
			const data = item.node.data;
			const branch = evaluateCondition(
				String(data.field ?? ""),
				String(data.operator ?? "contains"),
				String(data.value ?? ""),
				ctx,
			)
				? "true"
				: "false";
			for (const node of getNextNodes(item.node.id, adjacency, nodes, branch)) {
				queue.push({ node });
			}
			continue;
		}

		if (item.node.type === "random") {
			const next = getNextNodes(item.node.id, adjacency, nodes);
			const picked = next[Math.floor(Math.random() * next.length)];
			if (picked) queue.push({ node: picked });
			continue;
		}

		if (item.node.type !== "end") {
			for (const node of getNextNodes(item.node.id, adjacency, nodes)) {
				queue.push({ node });
			}
		}
	}

	return { status: "completed", hasError };
}

function getDelaySeconds(node: FlowNode) {
	const seconds = Number(node.data.delaySeconds ?? 0);
	if (!Number.isFinite(seconds)) return 0;
	return Math.max(0, seconds);
}

async function scheduleDelayContinuation(
	node: FlowNode,
	adjacency: Map<string, FlowEdge[]>,
	ctx: ExecutionContext,
	sessionId?: string,
) {
	const seconds = getDelaySeconds(node);
	const runAt = new Date(Date.now() + seconds * 1000);
	const nextNodeIds = getNextNodeIds(node.id, adjacency);

	ctx.nodeResults.push({
		nodeId: node.id,
		status: "success",
		output: `scheduled:${seconds}s`,
	});

	const continuationJob = await enqueueJob({
		kind: "flow.continue",
		payload: {
			executionLogId: ctx.logId,
			flowId: ctx.flowId,
			deviceId: ctx.deviceId,
			contactNumber: ctx.contactNumber,
			contactKey: ctx.contactKey,
			incomingText: ctx.incomingText,
			replyJid: ctx.replyJid,
			sessionId,
			variables: ctx.variables,
			nodeResults: ctx.nodeResults,
			nextNodeIds,
			triggerMessageKey: ctx.triggerMessageKey,
			triggerProviderMessageId: ctx.triggerProviderMessageId,
		},
		runAt,
		idempotencyKey: delayFlowContinuationJobIdempotencyKey({
			executionLogId: ctx.logId,
			nodeId: node.id,
		}),
	});

	const claimTransfer = getDelayContinuationClaimTransfer({
		sessionId,
		expectedClaimJobId: ctx.claimJobId,
		continuationJobId: continuationJob.id,
	});
	if (claimTransfer) {
		const [updated] = await db
			.update(flowSession)
			.set({
				claimJobId: claimTransfer.claimJobId,
				claimedAt: claimTransfer.claimedAt,
				failureCode: claimTransfer.failureCode,
			})
			.where(
				runningSessionClaimFilter(
					claimTransfer.sessionId,
					claimTransfer.expectedClaimJobId,
				),
			)
			.returning();
		if (!updated) {
			throw new Error(
				"Flow session claim changed before delay continuation was scheduled",
			);
		}
		emitFlowSessionUpdated(updated);
	}

	await recordFlowExecutionEvent({
		executionLogId: ctx.logId,
		flowId: ctx.flowId,
		deviceId: ctx.deviceId,
		contactNumber: ctx.contactNumber,
		contactKey: ctx.contactKey,
		sessionId: sessionId ?? null,
		type: "flow.delay_scheduled",
		nodeId: node.id,
		message: `Delay scheduled for ${seconds}s`,
		payload: { seconds, runAt: runAt.toISOString(), nextNodeIds },
	});
	await persistProgress(ctx.logId, ctx.nodeResults, undefined, "waiting");
}

type WaitForReplyWarning = {
	id: string;
	afterMinutes: number;
	message: string;
};

function getWaitForReplyWarnings(
	data: Record<string, unknown>,
	timeoutMinutes: number,
): WaitForReplyWarning[] {
	if (!Array.isArray(data.replyWarnings)) return [];
	return data.replyWarnings
		.flatMap((warning) => {
			if (!warning || typeof warning !== "object") return [];
			const warningData = warning as Record<string, unknown>;
			const afterMinutes = Number(warningData.afterMinutes);
			const message = String(warningData.message ?? "").trim();
			if (
				!Number.isInteger(afterMinutes) ||
				afterMinutes < 1 ||
				afterMinutes >= timeoutMinutes ||
				!message
			) {
				return [];
			}
			return [
				{
					id: String(warningData.id ?? crypto.randomUUID()),
					afterMinutes,
					message,
				},
			];
		})
		.sort((a, b) => a.afterMinutes - b.afterMinutes);
}

type FlowWaitTimeoutJobInput = {
	sessionId: string;
	waitingNodeId: string;
	expiresAt: Date | string;
};

export function buildFlowWaitTimeoutJob(input: FlowWaitTimeoutJobInput) {
	const expiresAt =
		input.expiresAt instanceof Date
			? input.expiresAt
			: new Date(input.expiresAt);
	const expiresAtIso = expiresAt.toISOString();
	return {
		kind: "flow.wait_timeout" as const,
		payload: {
			sessionId: input.sessionId,
			waitingNodeId: input.waitingNodeId,
			expiresAt: expiresAtIso,
		},
		runAt: expiresAt,
		maxAttempts: 3,
		idempotencyKey: waitTimeoutJobIdempotencyKey({
			sessionId: input.sessionId,
			waitingNodeId: input.waitingNodeId,
			expiresAt: expiresAtIso,
		}),
	};
}

export async function enqueueFlowWaitTimeoutJob(
	input: FlowWaitTimeoutJobInput,
) {
	return enqueueJob(buildFlowWaitTimeoutJob(input));
}

async function scheduleWaitTimeout(
	session: typeof flowSession.$inferSelect,
	node: FlowNode,
	expiresAt: Date,
) {
	await enqueueFlowWaitTimeoutJob({
		sessionId: session.id,
		waitingNodeId: node.id,
		expiresAt,
	});
}

async function scheduleWaitReplyWarnings(
	session: typeof flowSession.$inferSelect,
	node: FlowNode,
	ctx: ExecutionContext,
	expiresAt: Date,
	timeoutMinutes: number,
) {
	const warnings = getWaitForReplyWarnings(node.data, timeoutMinutes);
	if (warnings.length === 0) return;

	const scheduledWarnings: {
		id: string;
		afterMinutes: number;
		runAt: string;
	}[] = [];
	for (const warning of warnings) {
		const runAt = new Date(Date.now() + warning.afterMinutes * 60_000);
		if (runAt >= expiresAt) continue;
		await enqueueJob({
			kind: "flow.wait_warning",
			payload: {
				sessionId: session.id,
				executionLogId: ctx.logId,
				flowId: ctx.flowId,
				deviceId: ctx.deviceId,
				contactNumber: ctx.contactNumber,
				contactKey: ctx.contactKey,
				replyJid: ctx.replyJid,
				waitingNodeId: node.id,
				warningId: warning.id,
				afterMinutes: warning.afterMinutes,
				message: warning.message,
				incomingText: ctx.incomingText,
				variables: ctx.variables,
				expiresAt: expiresAt.toISOString(),
			},
			runAt,
			maxAttempts: 3,
			idempotencyKey: waitWarningJobIdempotencyKey({
				sessionId: session.id,
				waitingNodeId: node.id,
				warningId: warning.id,
				expiresAt: expiresAt.toISOString(),
			}),
		});
		scheduledWarnings.push({
			id: warning.id,
			afterMinutes: warning.afterMinutes,
			runAt: runAt.toISOString(),
		});
	}

	if (scheduledWarnings.length === 0) return;
	await recordFlowExecutionEvent({
		executionLogId: ctx.logId,
		flowId: ctx.flowId,
		deviceId: ctx.deviceId,
		contactNumber: ctx.contactNumber,
		contactKey: ctx.contactKey,
		sessionId: session.id,
		type: "session.warning_scheduled",
		nodeId: node.id,
		message: `${scheduledWarnings.length} wait warning(s) scheduled`,
		payload: { warnings: scheduledWarnings },
	});
}

async function createWaitingSession(
	node: FlowNode,
	adjacency: Map<string, FlowEdge[]>,
	ctx: ExecutionContext,
	previousSessionId?: string,
) {
	const interactive = isInteractiveNode(node.type);
	const timeoutMinutes = Math.min(
		Math.max(Number(node.data.timeoutMinutes ?? 1440), 1),
		10_080,
	);
	const expiresAt = new Date(Date.now() + timeoutMinutes * 60_000);
	const nextNodeIds = interactive ? [] : getNextNodeIds(node.id, adjacency);
	const waitContext = interactive
		? buildInteractiveWaitContext(
				node,
				adjacency,
				ctx.interactiveSendResult,
				node.type === "send-poll" ? ctx.interactiveOptions : undefined,
			)
		: null;
	const waitingProviderMessageId = ctx.interactiveSendResult?.messageId ?? null;
	if (
		node.type === "send-poll" &&
		ctx.interactiveSendResult?.deliveryMode === "native_poll" &&
		(!ctx.interactiveSendResult.messageKey ||
			ctx.interactiveSendResult.originalMessageStored !== true)
	) {
		await recordFlowExecutionEvent({
			executionLogId: ctx.logId,
			flowId: ctx.flowId,
			deviceId: ctx.deviceId,
			contactNumber: ctx.contactNumber,
			contactKey: ctx.contactKey,
			type: "poll_wait_binding_failed",
			nodeId: node.id,
			message: "Native poll message binding could not be persisted",
			payload: { messageId: ctx.interactiveSendResult.messageId ?? null },
		});
		throw new Error("poll_wait_binding_failed");
	}
	const variableName = interactive
		? "selectedOption"
		: String(node.data.variableName ?? "reply");
	const waitMessage = interactive
		? "Waiting for selected option"
		: `Waiting for ${variableName}`;

	ctx.nodeResults.push({
		nodeId: node.id,
		status: "success",
		output: `waiting:${variableName}`,
	});

	try {
		if (previousSessionId) {
			const [updated] = await db
				.update(flowSession)
				.set({
					status: "waiting",
					waitingNodeId: node.id,
					nextNodeIds,
					waitContext,
					waitingProviderMessageId,
					variables: ctx.variables,
					nodeResults: ctx.nodeResults,
					expiresAt,
					claimJobId: null,
					claimedAt: null,
					failureCode: null,
					completedAt: null,
				})
				.where(
					and(
						runningSessionClaimFilter(previousSessionId, ctx.claimJobId),
						eq(flowSession.deviceId, ctx.deviceId),
						eq(flowSession.contactKey, ctx.contactKey),
					),
				)
				.returning();
			if (!updated) return null;

			await recordFlowExecutionEvent({
				executionLogId: ctx.logId,
				flowId: ctx.flowId,
				deviceId: ctx.deviceId,
				contactNumber: ctx.contactNumber,
				contactKey: ctx.contactKey,
				sessionId: updated.id,
				type: "session.waiting",
				nodeId: node.id,
				message: waitMessage,
				payload: { variableName, expiresAt: expiresAt.toISOString() },
			});
			await scheduleWaitTimeout(updated, node, expiresAt);
			await scheduleWaitReplyWarnings(
				updated,
				node,
				ctx,
				expiresAt,
				timeoutMinutes,
			);
			emitFlowSessionUpdated(updated);
			await persistProgress(ctx.logId, ctx.nodeResults, undefined, "waiting");
			return updated;
		}

		const [created] = await db
			.insert(flowSession)
			.values({
				id: crypto.randomUUID(),
				flowId: ctx.flowId,
				deviceId: ctx.deviceId,
				contactNumber: ctx.contactNumber,
				contactKey: ctx.contactKey,
				executionLogId: ctx.logId,
				status: "waiting",
				waitingNodeId: node.id,
				nextNodeIds,
				waitContext,
				waitingProviderMessageId,
				variables: ctx.variables,
				nodeResults: ctx.nodeResults,
				expiresAt,
			})
			.returning();

		if (created) {
			await recordFlowExecutionEvent({
				executionLogId: ctx.logId,
				flowId: ctx.flowId,
				deviceId: ctx.deviceId,
				contactNumber: ctx.contactNumber,
				contactKey: ctx.contactKey,
				sessionId: created.id,
				type: "session.waiting",
				nodeId: node.id,
				message: waitMessage,
				payload: { variableName, expiresAt: expiresAt.toISOString() },
			});
			await scheduleWaitTimeout(created, node, expiresAt);
			await scheduleWaitReplyWarnings(
				created,
				node,
				ctx,
				expiresAt,
				timeoutMinutes,
			);
			emitFlowSessionUpdated(created);
		}
		await persistProgress(ctx.logId, ctx.nodeResults, undefined, "waiting");
		return created;
	} catch (error) {
		if (isActiveSessionUniqueConflict(error)) {
			console.warn("Failed to create waiting flow session", {
				flowId: ctx.flowId,
				deviceId: ctx.deviceId,
				contactNumber: ctx.contactNumber,
				contactKey: ctx.contactKey,
				error,
			});
			return null;
		}
		throw error;
	}
}

async function hasActiveScheduleExecution(
	flowRow: typeof flow.$inferSelect,
	contactKey: string,
) {
	if (!flowRow.deviceId) return false;
	const [active] = await db
		.select({ id: flowExecutionLog.id })
		.from(flowExecutionLog)
		.where(
			and(
				eq(flowExecutionLog.flowId, flowRow.id),
				eq(flowExecutionLog.deviceId, flowRow.deviceId),
				eq(flowExecutionLog.contactKey, contactKey),
				eq(flowExecutionLog.triggerSource, "schedule"),
				inArray(flowExecutionLog.status, ["running", "waiting"]),
			),
		)
		.limit(1);
	return active != null;
}

export async function resumeWaitingSession(
	deviceId: string,
	contactNumber: string,
	incomingText: string,
	replyJid = `${contactNumber}@s.whatsapp.net`,
	triggerRef?: ProviderMessageRef,
	reply?: IncomingReplyDescriptor,
): Promise<ExecutionResult | null> {
	const contactKey = derivePrivateIdentityKey({
		jid: replyJid,
		number: contactNumber,
	});
	const [waiting] = await db
		.select()
		.from(flowSession)
		.where(
			and(
				eq(flowSession.deviceId, deviceId),
				eq(flowSession.contactKey, contactKey),
				eq(flowSession.status, "waiting"),
			),
		)
		.limit(1);

	if (!waiting) return null;

	const claimed = await claimWaitingSession(waiting);
	if (!claimed) return null;
	return resumeFlowSession(claimed, incomingText, replyJid, triggerRef, reply);
}

export async function resumeWaitingSessionById(
	sessionId: string,
	incomingText: string,
	replyJid: string,
	triggerRef?: ProviderMessageRef,
	claimJobId?: string,
	reply?: IncomingReplyDescriptor,
	expectedDeviceId?: string,
): Promise<ExecutionResult | null> {
	const [waiting] = await db
		.select()
		.from(flowSession)
		.where(eq(flowSession.id, sessionId))
		.limit(1);

	if (!waiting || (expectedDeviceId && waiting.deviceId !== expectedDeviceId)) {
		return null;
	}

	const claimed = await claimWaitingSession(waiting, claimJobId);
	if (!claimed) return null;
	return resumeFlowSession(claimed, incomingText, replyJid, triggerRef, reply);
}

async function claimWaitingSession(
	session: typeof flowSession.$inferSelect,
	claimJobId?: string,
) {
	const claimOutcome = getFlowSessionClaimOutcome({
		status: session.status,
		sessionClaimJobId: session.claimJobId,
		claimJobId,
	});
	if (claimOutcome === "reenter") return session;
	if (claimOutcome !== "claim") return null;

	if (session.expiresAt && session.expiresAt <= new Date()) {
		const [expired] = await db
			.update(flowSession)
			.set({
				status: "expired",
				claimJobId: null,
				claimedAt: null,
				failureCode: "wait_timeout",
				completedAt: new Date(),
			})
			.where(
				and(eq(flowSession.id, session.id), eq(flowSession.status, "waiting")),
			)
			.returning();
		await recordFlowExecutionEvent({
			executionLogId: session.executionLogId,
			flowId: session.flowId,
			deviceId: session.deviceId,
			contactNumber: session.contactNumber,
			contactKey: session.contactKey,
			sessionId: session.id,
			type: "session.expired",
			nodeId: session.waitingNodeId,
			message: "Flow session expired",
		});
		if (expired) emitFlowSessionUpdated(expired);
		await persistProgress(
			session.executionLogId,
			normalizeNodeResults(session.nodeResults),
			"Flow session expired",
			"failed",
		);
		return null;
	}

	const [claimed] = await db
		.update(flowSession)
		.set({
			status: "running",
			claimJobId: claimJobId ?? null,
			claimedAt: new Date(),
			failureCode: null,
		})
		.where(
			and(eq(flowSession.id, session.id), eq(flowSession.status, "waiting")),
		)
		.returning();

	if (!claimed) return null;
	emitFlowSessionUpdated(claimed);
	return claimed;
}

async function resumeFlowSession(
	session: typeof flowSession.$inferSelect,
	incomingText: string,
	replyJid: string,
	triggerRef?: ProviderMessageRef,
	reply?: IncomingReplyDescriptor,
): Promise<ExecutionResult> {
	const [flowRow] = await db
		.select()
		.from(flow)
		.where(eq(flow.id, session.flowId))
		.limit(1);

	if (!flowRow) {
		await markSessionFailed(session, "Flow not found");
		return { status: "failed", sessionId: session.id, error: "Flow not found" };
	}
	if (
		flowRow.deviceId !== session.deviceId ||
		!(await hasFlowDeviceTenantConsistency(flowRow, session.deviceId))
	) {
		await markSessionFailed(session, "Flow device tenant mismatch");
		return {
			status: "failed",
			sessionId: session.id,
			error: "Flow device tenant mismatch",
		};
	}

	const nodes = (flowRow.nodes ?? []) as FlowNode[];
	const edges = (flowRow.edges ?? []) as FlowEdge[];
	const adjacency = buildAdjacencyMap(edges);
	const interactiveWaitContext = parseInteractiveWaitContext(
		session.waitContext,
	);
	const waitingNode = nodes.find((node) => node.id === session.waitingNodeId);
	if (!interactiveWaitContext && !waitingNode) {
		await markSessionFailed(session, "Waiting node not found");
		return {
			status: "failed",
			sessionId: session.id,
			error: "Waiting node not found",
		};
	}

	const variables = normalizeVariables(session.variables);
	const nodeResults = normalizeNodeResults(session.nodeResults);
	let startNodes: FlowNode[];

	if (interactiveWaitContext || isInteractiveNode(waitingNode?.type ?? "")) {
		const selectedFromSnapshot = interactiveWaitContext
			? resolveInteractiveWaitReply(interactiveWaitContext, incomingText, reply)
			: null;
		const selected = interactiveWaitContext
			? selectedFromSnapshot
			: resolveInteractiveReply(waitingNode as FlowNode, incomingText);
		await recordFlowExecutionEvent({
			executionLogId: session.executionLogId,
			flowId: session.flowId,
			deviceId: session.deviceId,
			contactNumber: session.contactNumber,
			contactKey: session.contactKey,
			sessionId: session.id,
			type: "reply.received",
			nodeId: session.waitingNodeId,
			message: "Interactive reply received",
			payload: { maskedPreview: maskUserReply(incomingText) },
		});

		if (!selected) {
			const [updated] = await db
				.update(flowSession)
				.set({
					status: "waiting",
					variables,
					nodeResults,
					claimJobId: null,
					claimedAt: null,
					completedAt: null,
				})
				.where(runningSessionOwnershipFilter(session))
				.returning();
			await recordFlowExecutionEvent({
				executionLogId: session.executionLogId,
				flowId: session.flowId,
				deviceId: session.deviceId,
				contactNumber: session.contactNumber,
				contactKey: session.contactKey,
				sessionId: session.id,
				type: "reply.option_invalid",
				nodeId: session.waitingNodeId,
				message: "Reply did not match any interactive option",
				payload: { maskedPreview: maskUserReply(incomingText) },
			});
			await persistProgress(
				session.executionLogId,
				nodeResults,
				undefined,
				"waiting",
			);
			if (updated) emitFlowSessionUpdated(updated);
			return {
				status: "waiting",
				logId: session.executionLogId,
				sessionId: session.id,
			};
		}

		variables.reply = incomingText;
		variables.selectedOptionId = selected.id;
		variables.selectedOptionText = selected.text;
		variables.selectedOptionIndex = String(selected.index);
		const snapshotTargets = selectedFromSnapshot
			? getInteractiveWaitSnapshotTargets(selectedFromSnapshot, nodes)
			: null;
		startNodes = snapshotTargets
			? snapshotTargets.nodes
			: getNextNodes(
					(waitingNode as FlowNode).id,
					adjacency,
					nodes,
					selected.handle,
				);

		await recordFlowExecutionEvent({
			executionLogId: session.executionLogId,
			flowId: session.flowId,
			deviceId: session.deviceId,
			contactNumber: session.contactNumber,
			contactKey: session.contactKey,
			sessionId: session.id,
			type: "reply.option_selected",
			nodeId: session.waitingNodeId,
			message: `Selected option ${selected.index}. ${selected.text}`,
			payload: {
				id: selected.id,
				text: selected.text,
				index: selected.index,
				handle: selected.handle,
			},
		});

		if (
			startNodes.length === 0 ||
			(snapshotTargets && snapshotTargets.missingNodeIds.length > 0)
		) {
			const error = interactiveWaitContext
				? getWaitingBranchMissingError(
						selected,
						snapshotTargets?.missingNodeIds,
					)
				: `Selected option ${selected.index}. ${selected.text} is not connected`;
			await markSessionFailed(
				session,
				error,
				nodeResults,
				variables,
				interactiveWaitContext ? "waiting_branch_missing" : undefined,
			);
			return {
				status: "failed",
				logId: session.executionLogId,
				sessionId: session.id,
				error,
			};
		}
	} else {
		const variableName = String(
			(waitingNode as FlowNode).data.variableName ?? "reply",
		).trim();
		const savedVariableName = variableName || "reply";
		variables[savedVariableName] = incomingText;
		startNodes = getNodesByIds(normalizeNodeIds(session.nextNodeIds), nodes);

		await recordFlowExecutionEvent({
			executionLogId: session.executionLogId,
			flowId: session.flowId,
			deviceId: session.deviceId,
			contactNumber: session.contactNumber,
			contactKey: session.contactKey,
			sessionId: session.id,
			type: "reply.received",
			nodeId: session.waitingNodeId,
			message: `Reply captured as ${savedVariableName}`,
			payload: {
				variableName: savedVariableName,
				maskedPreview: maskUserReply(incomingText),
			},
		});
	}

	await recordFlowExecutionEvent({
		executionLogId: session.executionLogId,
		flowId: session.flowId,
		deviceId: session.deviceId,
		contactNumber: session.contactNumber,
		contactKey: session.contactKey,
		sessionId: session.id,
		type: "session.resumed",
		nodeId: session.waitingNodeId,
		message: "Session resumed from user reply",
	});

	const ctx: ExecutionContext = {
		flowId: flowRow.id,
		contactNumber: session.contactNumber,
		contactKey: session.contactKey,
		replyJid,
		incomingText,
		deviceId: session.deviceId,
		logId: session.executionLogId,
		variables,
		nodeResults,
		claimJobId: session.claimJobId,
		triggerMessageKey: triggerRef?.messageKey,
		triggerProviderMessageId: triggerRef?.providerMessageId,
	};

	const result = await runFlowNodes({
		nodes,
		edges,
		startNodes,
		ctx,
		previousSessionId: session.id,
	});

	if (result.status === "waiting") {
		return { status: "waiting", logId: ctx.logId, sessionId: result.sessionId };
	}

	if (result.status === "delayed") {
		return { status: "waiting", logId: ctx.logId, sessionId: session.id };
	}

	if (result.status === "failed") {
		await markSessionFailed(session, result.error, ctx.nodeResults, variables);
		return {
			status: "failed",
			logId: ctx.logId,
			sessionId: session.id,
			error: result.error,
		};
	}

	const status = result.hasError ? "failed" : "completed";
	await persistProgress(
		ctx.logId,
		ctx.nodeResults,
		result.hasError ? "One or more nodes failed" : undefined,
		status,
	);
	const [updated] = await db
		.update(flowSession)
		.set({
			status,
			variables,
			nodeResults: ctx.nodeResults,
			claimJobId: null,
			claimedAt: null,
			failureCode: result.hasError ? "node_error" : null,
			completedAt: new Date(),
		})
		.where(runningSessionOwnershipFilter(session))
		.returning();
	await recordFlowExecutionEvent({
		executionLogId: ctx.logId,
		flowId: ctx.flowId,
		deviceId: ctx.deviceId,
		contactNumber: ctx.contactNumber,
		contactKey: ctx.contactKey,
		sessionId: session.id,
		type: status === "completed" ? "session.completed" : "session.failed",
		message:
			status === "completed"
				? "Session completed"
				: "Session completed with node errors",
	});
	if (updated) emitFlowSessionUpdated(updated);

	return { status, logId: ctx.logId, sessionId: session.id };
}

async function markSessionFailed(
	session: typeof flowSession.$inferSelect,
	error: string,
	nodeResults = normalizeNodeResults(session.nodeResults),
	variables = normalizeVariables(session.variables),
	failureCode = "execution_failed",
) {
	await persistProgress(session.executionLogId, nodeResults, error, "failed");
	const [updated] = await db
		.update(flowSession)
		.set({
			status: "failed",
			variables,
			nodeResults,
			claimJobId: null,
			claimedAt: null,
			failureCode,
			completedAt: new Date(),
		})
		.where(runningSessionOwnershipFilter(session))
		.returning();
	await recordFlowExecutionEvent({
		executionLogId: session.executionLogId,
		flowId: session.flowId,
		deviceId: session.deviceId,
		contactNumber: session.contactNumber,
		contactKey: session.contactKey,
		sessionId: session.id,
		type: "session.failed",
		nodeId: session.waitingNodeId,
		message: error,
	});
	if (updated) emitFlowSessionUpdated(updated);
}

export async function continueFlowExecution(
	input: FlowContinueJobPayload,
): Promise<ExecutionResult> {
	const nodeResults = normalizeNodeResults(input.nodeResults);
	const variables = normalizeVariables(input.variables);
	const [executionLog] = await db
		.select({
			status: flowExecutionLog.status,
			triggerSource: flowExecutionLog.triggerSource,
		})
		.from(flowExecutionLog)
		.where(eq(flowExecutionLog.id, input.executionLogId))
		.limit(1);

	if (!executionLog) {
		return {
			status: "failed",
			logId: input.executionLogId,
			error: "Log not found",
		};
	}
	if (executionLog.status === "completed" || executionLog.status === "failed") {
		return { status: "skipped", logId: input.executionLogId };
	}

	const [flowRow] = await db
		.select()
		.from(flow)
		.where(eq(flow.id, input.flowId))
		.limit(1);

	if (!flowRow?.deviceId) {
		await persistProgress(
			input.executionLogId,
			nodeResults,
			"Flow not found",
			"failed",
		);
		return {
			status: "failed",
			logId: input.executionLogId,
			error: "Flow not found",
		};
	}
	if (!(await hasFlowDeviceTenantConsistency(flowRow, input.deviceId))) {
		await persistProgress(
			input.executionLogId,
			nodeResults,
			"Flow device tenant mismatch",
			"failed",
		);
		return {
			status: "failed",
			logId: input.executionLogId,
			error: "Flow device tenant mismatch",
		};
	}

	let session: typeof flowSession.$inferSelect | null = null;
	if (input.sessionId) {
		const [sessionRow] = await db
			.select()
			.from(flowSession)
			.where(eq(flowSession.id, input.sessionId))
			.limit(1);
		if (!sessionRow) {
			await persistProgress(
				input.executionLogId,
				nodeResults,
				"Flow session not found",
				"failed",
			);
			return {
				status: "failed",
				logId: input.executionLogId,
				error: "Flow session not found",
			};
		}
		if (
			sessionRow.flowId !== flowRow.id ||
			sessionRow.deviceId !== flowRow.deviceId ||
			sessionRow.deviceId !== input.deviceId
		) {
			await persistProgress(
				input.executionLogId,
				nodeResults,
				"Flow session device mismatch",
				"failed",
			);
			return {
				status: "failed",
				logId: input.executionLogId,
				error: "Flow session device mismatch",
			};
		}
		session = sessionRow;
	}

	const nodes = (flowRow.nodes ?? []) as FlowNode[];
	const edges = (flowRow.edges ?? []) as FlowEdge[];
	const replyJid =
		input.replyJid ??
		(input.contactNumber ? `${input.contactNumber}@s.whatsapp.net` : undefined);
	if (!replyJid) {
		return {
			status: "failed",
			logId: input.executionLogId,
			error: "Reply JID is required",
		};
	}

	const ctx: ExecutionContext = {
		flowId: input.flowId,
		contactNumber: input.contactNumber,
		contactKey: input.contactKey,
		replyJid,
		incomingText: input.incomingText,
		deviceId: input.deviceId,
		logId: input.executionLogId,
		variables,
		nodeResults,
		claimJobId: session?.claimJobId,
		triggerMessageKey: input.triggerMessageKey,
		triggerProviderMessageId: input.triggerProviderMessageId,
	};

	await persistProgress(ctx.logId, ctx.nodeResults, undefined, "running");
	await recordFlowExecutionEvent({
		executionLogId: ctx.logId,
		flowId: ctx.flowId,
		deviceId: ctx.deviceId,
		contactNumber: ctx.contactNumber,
		contactKey: ctx.contactKey,
		sessionId: session?.id ?? null,
		type: "flow.delay_resumed",
		message: "Delay continuation resumed",
		payload: { nextNodeIds: input.nextNodeIds },
	});

	const result = await runFlowNodes({
		nodes,
		edges,
		startNodes: getNodesByIds(input.nextNodeIds, nodes),
		ctx,
		previousSessionId: session?.id,
	});

	if (result.status === "waiting") {
		return { status: "waiting", logId: ctx.logId, sessionId: result.sessionId };
	}
	if (result.status === "delayed") {
		return { status: "waiting", logId: ctx.logId, sessionId: session?.id };
	}
	if (result.status === "failed") {
		if (session) {
			await markSessionFailed(
				session,
				result.error,
				ctx.nodeResults,
				variables,
			);
		} else {
			await recordFlowExecutionEvent({
				executionLogId: ctx.logId,
				flowId: ctx.flowId,
				deviceId: ctx.deviceId,
				contactNumber: ctx.contactNumber,
				contactKey: ctx.contactKey,
				type: "execution.failed",
				message: result.error,
			});
			await persistProgress(ctx.logId, ctx.nodeResults, result.error, "failed");
		}
		incrementCounter("whatsapp_flow_executions_failed_total", {
			trigger_source: executionLog.triggerSource,
		});
		return { status: "failed", logId: ctx.logId, error: result.error };
	}

	const status = result.hasError ? "failed" : "completed";
	const error = result.hasError ? "One or more nodes failed" : undefined;
	await persistProgress(ctx.logId, ctx.nodeResults, error, status);

	if (session) {
		const [updated] = await db
			.update(flowSession)
			.set({
				status,
				variables,
				nodeResults: ctx.nodeResults,
				claimJobId: null,
				claimedAt: null,
				failureCode: result.hasError ? "node_error" : null,
				completedAt: new Date(),
			})
			.where(runningSessionOwnershipFilter(session))
			.returning();
		await recordFlowExecutionEvent({
			executionLogId: ctx.logId,
			flowId: ctx.flowId,
			deviceId: ctx.deviceId,
			contactNumber: ctx.contactNumber,
			contactKey: ctx.contactKey,
			sessionId: session.id,
			type: status === "completed" ? "session.completed" : "session.failed",
			message:
				status === "completed"
					? "Session completed"
					: "Session completed with node errors",
		});
		if (updated) emitFlowSessionUpdated(updated);
	} else {
		await recordFlowExecutionEvent({
			executionLogId: ctx.logId,
			flowId: ctx.flowId,
			deviceId: ctx.deviceId,
			contactNumber: ctx.contactNumber,
			contactKey: ctx.contactKey,
			type: status === "completed" ? "execution.completed" : "execution.failed",
			message: error ?? "Execution completed",
		});
	}

	incrementCounter(
		status === "completed"
			? "whatsapp_flow_executions_completed_total"
			: "whatsapp_flow_executions_failed_total",
		{ trigger_source: executionLog.triggerSource },
	);
	return { status, logId: ctx.logId, sessionId: session?.id };
}

export async function hasFlowDeviceTenantConsistency(
	flowRow: Pick<typeof flow.$inferSelect, "deviceId" | "tenantId">,
	expectedDeviceId?: string,
) {
	if (
		!flowRow.deviceId ||
		(expectedDeviceId && flowRow.deviceId !== expectedDeviceId)
	) {
		return false;
	}
	const [flowDevice] = await db
		.select({ tenantId: device.tenantId })
		.from(device)
		.where(eq(device.id, flowRow.deviceId))
		.limit(1);
	return flowDevice?.tenantId === flowRow.tenantId;
}

export async function executeFlow(
	flowRow: typeof flow.$inferSelect,
	contactNumber: string | null,
	incomingText: string,
	options: ExecutionOptions = {},
): Promise<ExecutionResult> {
	const triggerSource = options.triggerSource ?? "message";
	if (!(await hasFlowDeviceTenantConsistency(flowRow))) {
		return { status: "failed", error: "Flow device tenant mismatch" };
	}
	const replyJid =
		options.replyJid ??
		(contactNumber ? `${contactNumber}@s.whatsapp.net` : undefined);
	if (!replyJid) {
		return { status: "failed", error: "Reply JID is required" };
	}
	const contactKey =
		options.contactKey ??
		derivePrivateIdentityKey({ jid: replyJid, number: contactNumber });
	const nodes = (flowRow.nodes ?? []) as FlowNode[];
	const edges = (flowRow.edges ?? []) as FlowEdge[];
	if (nodes.length === 0)
		return { status: "skipped", error: "Flow has no nodes" };

	const triggerNode = getTriggerNode(nodes);
	if (!triggerNode) return { status: "skipped", error: "Flow has no trigger" };
	if (!flowRow.deviceId)
		return { status: "failed", error: "Flow has no device" };

	if (
		triggerSource === "schedule" &&
		(await hasActiveScheduleExecution(flowRow, contactKey))
	) {
		return { status: "skipped", error: "Schedule execution already active" };
	}

	const logId = crypto.randomUUID();
	const ctx: ExecutionContext = {
		flowId: flowRow.id,
		contactNumber,
		contactKey,
		replyJid,
		incomingText,
		deviceId: flowRow.deviceId,
		logId,
		variables: {},
		nodeResults: [],
		triggerMessageKey: options.triggerMessageKey,
		triggerProviderMessageId: options.triggerProviderMessageId,
	};

	const [createdLog] = await db
		.insert(flowExecutionLog)
		.values({
			id: logId,
			flowId: flowRow.id,
			deviceId: ctx.deviceId,
			contactNumber,
			contactKey,
			triggerSource,
			status: "running",
			nodeResults: [],
			startedAt: new Date(),
		})
		.returning({
			id: flowExecutionLog.id,
			flowId: flowExecutionLog.flowId,
			deviceId: flowExecutionLog.deviceId,
		});
	if (createdLog) {
		incrementCounter("whatsapp_flow_executions_started_total", {
			trigger_source: triggerSource,
		});
		await recordFlowExecutionEvent({
			executionLogId: logId,
			flowId: flowRow.id,
			deviceId: ctx.deviceId,
			contactNumber,
			contactKey,
			type: "execution.started",
			message: `Triggered by ${triggerSource}`,
			payload: { triggerSource },
		});
		emitLogCreated(createdLog);
	}

	const adjacency = buildAdjacencyMap(edges);
	const result = await runFlowNodes({
		nodes,
		edges,
		startNodes: getNextNodes(triggerNode.id, adjacency, nodes),
		ctx,
	});

	if (result.status === "waiting") {
		return { status: "waiting", logId, sessionId: result.sessionId };
	}

	if (result.status === "delayed") {
		return { status: "waiting", logId };
	}

	if (result.status === "failed") {
		await recordFlowExecutionEvent({
			executionLogId: logId,
			flowId: flowRow.id,
			deviceId: ctx.deviceId,
			contactNumber,
			contactKey,
			type: "execution.failed",
			message: result.error,
		});
		await persistProgress(logId, ctx.nodeResults, result.error, "failed");
		incrementCounter("whatsapp_flow_executions_failed_total", {
			trigger_source: triggerSource,
		});
		return { status: "failed", logId, error: result.error };
	}

	const status = result.hasError ? "failed" : "completed";
	const error = result.hasError ? "One or more nodes failed" : undefined;
	await recordFlowExecutionEvent({
		executionLogId: logId,
		flowId: flowRow.id,
		deviceId: ctx.deviceId,
		contactNumber,
		contactKey,
		type: status === "completed" ? "execution.completed" : "execution.failed",
		message: error ?? "Execution completed",
	});
	await persistProgress(logId, ctx.nodeResults, error, status);
	incrementCounter(
		status === "completed"
			? "whatsapp_flow_executions_completed_total"
			: "whatsapp_flow_executions_failed_total",
		{ trigger_source: triggerSource },
	);
	return { status, logId };
}
