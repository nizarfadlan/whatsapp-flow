import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "@whatsapp-flow/db";
import {
	channel,
	chatGroup,
	contact as contactTable,
} from "@whatsapp-flow/db/schema/contact";
import {
	flow,
	flowExecutionEvent,
	flowExecutionLog,
	flowSession,
} from "@whatsapp-flow/db/schema/device";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import type {
	OutgoingMessage,
	ProviderMessageRef,
	SendResult,
} from "@whatsapp-flow/whatsapp";
import { connectionManager, sendDeviceMessage } from "@whatsapp-flow/whatsapp";
import { and, eq, inArray } from "drizzle-orm";
import { incrementCounter } from "../observability/metrics";
import { enqueueJob } from "./job-queue";
import {
	delayFlowContinuationJobIdempotencyKey,
	type FlowContinueJobPayload,
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

type NodeResult = {
	nodeId: string;
	status: "success" | "error";
	output?: string;
	error?: string;
};

type TemplateContext = {
	contactNumber: string;
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
	triggerMessageKey?: import("baileys").WAMessageKey;
	triggerProviderMessageId?: string;
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
	contactNumber: string;
	type: string;
	sessionId?: string | null;
	nodeId?: string | null;
	message?: string | null;
	payload?: Record<string, unknown>;
};

type ExecutionOptions = {
	replyJid?: string;
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

function getNextNodeIds(nodeId: string, adjacency: Map<string, FlowEdge[]>) {
	return (adjacency.get(nodeId) ?? []).map((edge) => edge.target);
}

function getNodesByIds(nodeIds: string[], nodes: FlowNode[]) {
	const nodeMap = new Map(nodes.map((node) => [node.id, node]));
	return nodeIds
		.map((nodeId) => nodeMap.get(nodeId))
		.filter((node): node is FlowNode => node != null);
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
				await sendDeviceMessage(ctx.deviceId, jid, {
					type: "text",
					text: [
						bodyText,
						...buttons.map((button, index) => `${index + 1}. ${button.text}`),
						footer,
					]
						.filter(Boolean)
						.join("\n"),
				});
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
				await sendDeviceMessage(ctx.deviceId, jid, {
					type: "text",
					text: lines.join("\n"),
				});
				ctx.nodeResults.push({ nodeId: node.id, status: "success" });
				return true;
			}
			case "send-quick-reply": {
				const bodyText = resolveTemplate(String(data.bodyText ?? ""), ctx);
				const buttons =
					(data.buttons as { id: string; text: string }[] | undefined) ?? [];
				const lines: string[] = [bodyText];
				for (let i = 0; i < buttons.length; i++) {
					lines.push(`${i + 1}. ${buttons[i]?.text ?? ""}`);
				}
				await sendDeviceMessage(ctx.deviceId, jid, {
					type: "text",
					text: lines.join("\n"),
				});
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
				const response = await fetchWebhookUrl(
					url,
					method,
					JSON.stringify({
						contact: ctx.contactNumber,
						variables: ctx.variables,
					}),
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
	contactNumber: string;
	status: FlowSessionStatus;
}) {
	connectionManager.emit("flow:session:updated", {
		sessionId: session.id,
		flowId: session.flowId,
		deviceId: session.deviceId,
		executionLogId: session.executionLogId,
		contactNumber: session.contactNumber,
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

	try {
		await db.insert(flowExecutionEvent).values({
			id,
			executionLogId: input.executionLogId,
			flowId: input.flowId,
			deviceId: input.deviceId,
			sessionId,
			contactNumber: input.contactNumber,
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
		if (key === "contact.number") return ctx.contactNumber;
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

function normalizeNumber(value: string) {
	return value.replace(/[^\d]/g, "");
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

		if (chatType === "private") {
			const [savedContact] = await db
				.insert(contactTable)
				.values({
					id: crypto.randomUUID(),
					deviceId: ctx.deviceId,
					jid: chatJid,
					phoneNumber: ctx.contactNumber,
					source: "message",
				})
				.onConflictDoUpdate({
					target: [contactTable.deviceId, contactTable.jid],
					set: { phoneNumber: ctx.contactNumber, updatedAt: now },
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
				chatJid,
				contactId,
				groupId,
				channelId,
				groupJid: chatType === "group" ? chatJid : null,
				channelJid: chatType === "channel" ? chatJid : null,
				contactNumber: chatType === "private" ? ctx.contactNumber : null,
				lastMessageText: text ?? null,
				lastMessageAt: now,
				unreadCount: 0,
			})
			.onConflictDoUpdate({
				target: [inboxThread.deviceId, inboxThread.chatJid],
				set: {
					chatType,
					contactId,
					groupId,
					channelId,
					groupJid: chatType === "group" ? chatJid : null,
					channelJid: chatType === "channel" ? chatJid : null,
					contactNumber: chatType === "private" ? ctx.contactNumber : null,
					lastMessageText: text ?? null,
					lastMessageAt: now,
				},
			})
			.returning({ id: inboxThread.id });

		const threadId = savedThread?.id;

		if (threadId) {
			await db.insert(inboxMessage).values({
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
			});
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

async function fetchWebhookUrl(value: string, method: string, body: string) {
	let currentUrl = value;
	let currentMethod = method;
	for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
		await assertSafeWebhookUrl(currentUrl);
		const response = await fetch(currentUrl, {
			method: currentMethod,
			headers:
				currentMethod === "GET"
					? undefined
					: { "content-type": "application/json" },
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
			sessionId: previousSessionId ?? null,
			type: ok ? "node.completed" : "node.failed",
			nodeId: item.node.id,
			message: result?.error ?? result?.output ?? null,
			payload: { output: result?.output, error: result?.error },
		});
		if (!ok) hasError = true;

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

	await enqueueJob({
		kind: "flow.continue",
		payload: {
			executionLogId: ctx.logId,
			flowId: ctx.flowId,
			deviceId: ctx.deviceId,
			contactNumber: ctx.contactNumber,
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

	await recordFlowExecutionEvent({
		executionLogId: ctx.logId,
		flowId: ctx.flowId,
		deviceId: ctx.deviceId,
		contactNumber: ctx.contactNumber,
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
	const timeoutMinutes = Math.min(
		Math.max(Number(node.data.timeoutMinutes ?? 1440), 1),
		10_080,
	);
	const expiresAt = new Date(Date.now() + timeoutMinutes * 60_000);
	const nextNodeIds = getNextNodeIds(node.id, adjacency);
	const variableName = String(node.data.variableName ?? "reply");

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
					variables: ctx.variables,
					nodeResults: ctx.nodeResults,
					expiresAt,
					completedAt: null,
				})
				.where(
					and(
						eq(flowSession.id, previousSessionId),
						eq(flowSession.deviceId, ctx.deviceId),
						eq(flowSession.contactNumber, ctx.contactNumber),
						eq(flowSession.status, "running"),
					),
				)
				.returning();
			if (!updated) return null;

			await recordFlowExecutionEvent({
				executionLogId: ctx.logId,
				flowId: ctx.flowId,
				deviceId: ctx.deviceId,
				contactNumber: ctx.contactNumber,
				sessionId: updated.id,
				type: "session.waiting",
				nodeId: node.id,
				message: `Waiting for ${variableName}`,
				payload: { variableName, expiresAt: expiresAt.toISOString() },
			});
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
				executionLogId: ctx.logId,
				status: "waiting",
				waitingNodeId: node.id,
				nextNodeIds,
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
				sessionId: created.id,
				type: "session.waiting",
				nodeId: node.id,
				message: `Waiting for ${variableName}`,
				payload: { variableName, expiresAt: expiresAt.toISOString() },
			});
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
		console.warn("Failed to create waiting flow session", {
			flowId: ctx.flowId,
			deviceId: ctx.deviceId,
			contactNumber: ctx.contactNumber,
			error,
		});
		return null;
	}
}

async function hasActiveScheduleExecution(
	flowRow: typeof flow.$inferSelect,
	contactNumber: string,
) {
	if (!flowRow.deviceId) return false;
	const [active] = await db
		.select({ id: flowExecutionLog.id })
		.from(flowExecutionLog)
		.where(
			and(
				eq(flowExecutionLog.flowId, flowRow.id),
				eq(flowExecutionLog.deviceId, flowRow.deviceId),
				eq(flowExecutionLog.contactNumber, contactNumber),
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
): Promise<ExecutionResult | null> {
	const [waiting] = await db
		.select()
		.from(flowSession)
		.where(
			and(
				eq(flowSession.deviceId, deviceId),
				eq(flowSession.contactNumber, contactNumber),
				eq(flowSession.status, "waiting"),
			),
		)
		.limit(1);

	if (!waiting) return null;

	const claimed = await claimWaitingSession(waiting);
	if (!claimed) return null;
	return resumeFlowSession(claimed, incomingText, replyJid, triggerRef);
}

export async function resumeWaitingSessionById(
	sessionId: string,
	incomingText: string,
	replyJid: string,
	triggerRef?: ProviderMessageRef,
): Promise<ExecutionResult | null> {
	const [waiting] = await db
		.select()
		.from(flowSession)
		.where(
			and(eq(flowSession.id, sessionId), eq(flowSession.status, "waiting")),
		)
		.limit(1);

	if (!waiting) return null;

	const claimed = await claimWaitingSession(waiting);
	if (!claimed) return null;
	return resumeFlowSession(claimed, incomingText, replyJid, triggerRef);
}

async function claimWaitingSession(session: typeof flowSession.$inferSelect) {
	if (session.expiresAt && session.expiresAt <= new Date()) {
		const [expired] = await db
			.update(flowSession)
			.set({ status: "expired", completedAt: new Date() })
			.where(eq(flowSession.id, session.id))
			.returning();
		await recordFlowExecutionEvent({
			executionLogId: session.executionLogId,
			flowId: session.flowId,
			deviceId: session.deviceId,
			contactNumber: session.contactNumber,
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
		.set({ status: "running" })
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

	const nodes = (flowRow.nodes ?? []) as FlowNode[];
	const edges = (flowRow.edges ?? []) as FlowEdge[];
	const waitingNode = nodes.find((node) => node.id === session.waitingNodeId);
	const variableName = String(waitingNode?.data.variableName ?? "reply").trim();
	const savedVariableName = variableName || "reply";
	const variables = normalizeVariables(session.variables);
	variables[savedVariableName] = incomingText;

	await recordFlowExecutionEvent({
		executionLogId: session.executionLogId,
		flowId: session.flowId,
		deviceId: session.deviceId,
		contactNumber: session.contactNumber,
		sessionId: session.id,
		type: "reply.received",
		nodeId: session.waitingNodeId,
		message: `Reply captured as ${savedVariableName}`,
		payload: {
			variableName: savedVariableName,
			maskedPreview: maskUserReply(incomingText),
		},
	});
	await recordFlowExecutionEvent({
		executionLogId: session.executionLogId,
		flowId: session.flowId,
		deviceId: session.deviceId,
		contactNumber: session.contactNumber,
		sessionId: session.id,
		type: "session.resumed",
		nodeId: session.waitingNodeId,
		message: "Session resumed from user reply",
	});

	const ctx: ExecutionContext = {
		flowId: flowRow.id,
		contactNumber: session.contactNumber,
		replyJid,
		incomingText,
		deviceId: session.deviceId,
		logId: session.executionLogId,
		variables,
		nodeResults: normalizeNodeResults(session.nodeResults),
		triggerMessageKey: triggerRef?.messageKey,
		triggerProviderMessageId: triggerRef?.providerMessageId,
	};

	const result = await runFlowNodes({
		nodes,
		edges,
		startNodes: getNodesByIds(normalizeNodeIds(session.nextNodeIds), nodes),
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
			completedAt: new Date(),
		})
		.where(eq(flowSession.id, session.id))
		.returning();
	await recordFlowExecutionEvent({
		executionLogId: ctx.logId,
		flowId: ctx.flowId,
		deviceId: ctx.deviceId,
		contactNumber: ctx.contactNumber,
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
) {
	await persistProgress(session.executionLogId, nodeResults, error, "failed");
	const [updated] = await db
		.update(flowSession)
		.set({
			status: "failed",
			variables,
			nodeResults,
			completedAt: new Date(),
		})
		.where(eq(flowSession.id, session.id))
		.returning();
	await recordFlowExecutionEvent({
		executionLogId: session.executionLogId,
		flowId: session.flowId,
		deviceId: session.deviceId,
		contactNumber: session.contactNumber,
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
		session = sessionRow;
	}

	const nodes = (flowRow.nodes ?? []) as FlowNode[];
	const edges = (flowRow.edges ?? []) as FlowEdge[];
	const ctx: ExecutionContext = {
		flowId: input.flowId,
		contactNumber: input.contactNumber,
		replyJid: input.replyJid ?? `${input.contactNumber}@s.whatsapp.net`,
		incomingText: input.incomingText,
		deviceId: input.deviceId,
		logId: input.executionLogId,
		variables,
		nodeResults,
		triggerMessageKey: input.triggerMessageKey,
		triggerProviderMessageId: input.triggerProviderMessageId,
	};

	await persistProgress(ctx.logId, ctx.nodeResults, undefined, "running");
	await recordFlowExecutionEvent({
		executionLogId: ctx.logId,
		flowId: ctx.flowId,
		deviceId: ctx.deviceId,
		contactNumber: ctx.contactNumber,
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
				completedAt: new Date(),
			})
			.where(eq(flowSession.id, session.id))
			.returning();
		await recordFlowExecutionEvent({
			executionLogId: ctx.logId,
			flowId: ctx.flowId,
			deviceId: ctx.deviceId,
			contactNumber: ctx.contactNumber,
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

export async function executeFlow(
	flowRow: typeof flow.$inferSelect,
	contactNumber: string,
	incomingText: string,
	options: ExecutionOptions = {},
): Promise<ExecutionResult> {
	const triggerSource = options.triggerSource ?? "message";
	const replyJid = options.replyJid ?? `${contactNumber}@s.whatsapp.net`;
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
		(await hasActiveScheduleExecution(flowRow, contactNumber))
	) {
		return { status: "skipped", error: "Schedule execution already active" };
	}

	const logId = crypto.randomUUID();
	const ctx: ExecutionContext = {
		flowId: flowRow.id,
		contactNumber,
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
