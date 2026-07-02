import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "@whatsapp-flow/db";
import { contact as contactTable } from "@whatsapp-flow/db/schema/contact";
import {
	flow,
	flowExecutionLog,
	flowSession,
} from "@whatsapp-flow/db/schema/device";
import { inboxMessage, inboxThread } from "@whatsapp-flow/db/schema/inbox";
import type { OutgoingMessage } from "@whatsapp-flow/whatsapp";
import {
	connectionManager,
	sendWhatsAppMessage,
} from "@whatsapp-flow/whatsapp";
import { and, eq, inArray } from "drizzle-orm";

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

type ExecutionContext = {
	flowId: string;
	contactNumber: string;
	replyJid: string;
	incomingText: string;
	deviceId: string;
	logId: string;
	variables: Record<string, string>;
	nodeResults: NodeResult[];
	triggerMessageKey?: import("baileys").WAMessageKey;
};

type ExecutionStatus = "running" | "waiting" | "completed" | "failed";
type TriggerSource = "message" | "schedule" | "webhook" | "session";

type ExecutionOptions = {
	replyJid?: string;
	triggerSource?: TriggerSource;
	triggerMessageKey?: import("baileys").WAMessageKey;
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

async function executeNode(
	node: FlowNode,
	ctx: ExecutionContext,
	socket: Parameters<typeof sendWhatsAppMessage>[0],
) {
	const type = node.type;
	const data = node.data;
	const jid = ctx.replyJid;

	try {
		switch (type) {
			case "send-text": {
				const text = resolveTemplate(String(data.text ?? ""), ctx);
				await sendWhatsAppMessage(socket, jid, { type: "text", text });
				void recordOutboundMessage(ctx, "text", text);
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
				await sendWhatsAppMessage(socket, jid, {
					type: messageType,
					url,
					caption,
				} as OutgoingMessage);
				void recordOutboundMessage(ctx, messageType, caption ?? url, { url });
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
				await sendWhatsAppMessage(socket, jid, {
					type: "document",
					url,
					fileName,
				});
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "success",
					output: fileName,
				});
				return true;
			}
			case "send-location": {
				await sendWhatsAppMessage(socket, jid, {
					type: "location",
					latitude: Number(data.latitude ?? 0),
					longitude: Number(data.longitude ?? 0),
					name: data.address ? String(data.address) : undefined,
				});
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
				if (!ctx.triggerMessageKey) {
					// Reaction requires the key of the triggering message.
					// Gracefully skip when triggered by schedule/webhook (no message key).
					ctx.nodeResults.push({
						nodeId: node.id,
						status: "success",
						output: "skipped:no_message_key",
					});
					return true;
				}
				await sendWhatsAppMessage(socket, jid, {
					type: "reaction",
					text: emoji,
					messageKey: ctx.triggerMessageKey,
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
				await sendWhatsAppMessage(socket, jid, {
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
				await sendWhatsAppMessage(socket, jid, {
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
				await sendWhatsAppMessage(socket, jid, {
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
					await sendWhatsAppMessage(socket, targetJid, { type: "text", text });
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

function resolveTemplate(text: string, ctx: ExecutionContext) {
	return text.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
		if (key === "contact.number") return ctx.contactNumber;
		if (key === "message.text") return ctx.incomingText;
		if (key.startsWith("variables.")) {
			return ctx.variables[key.slice("variables.".length)] ?? `{{${key}}}`;
		}
		return ctx.variables[key] ?? `{{${key}}}`;
	});
}

function normalizeNumber(value: string) {
	return value.replace(/[^\d]/g, "");
}

async function recordOutboundMessage(
	ctx: ExecutionContext,
	messageType: string,
	text?: string,
	raw?: Record<string, unknown>,
) {
	try {
		const now = new Date();
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
		}

		const [savedThread] = await db
			.insert(inboxThread)
			.values({
				id: crypto.randomUUID(),
				deviceId: ctx.deviceId,
				chatType,
				chatJid,
				contactId,
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
				raw: raw ?? null,
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
	socket,
	previousSessionId,
}: {
	nodes: FlowNode[];
	edges: FlowEdge[];
	startNodes: FlowNode[];
	ctx: ExecutionContext;
	socket: Parameters<typeof sendWhatsAppMessage>[0];
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

		const ok = await executeNode(item.node, ctx, socket);
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

	ctx.nodeResults.push({
		nodeId: node.id,
		status: "success",
		output: `waiting:${String(node.data.variableName ?? "reply")}`,
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
	triggerMessageKey?: import("baileys").WAMessageKey,
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

	if (waiting.expiresAt && waiting.expiresAt <= new Date()) {
		await db
			.update(flowSession)
			.set({ status: "expired", completedAt: new Date() })
			.where(eq(flowSession.id, waiting.id));
		await persistProgress(
			waiting.executionLogId,
			normalizeNodeResults(waiting.nodeResults),
			"Flow session expired",
			"failed",
		);
		return null;
	}

	const [claimed] = await db
		.update(flowSession)
		.set({ status: "running" })
		.where(
			and(eq(flowSession.id, waiting.id), eq(flowSession.status, "waiting")),
		)
		.returning();

	if (!claimed) return null;
	return resumeFlowSession(claimed, incomingText, replyJid, triggerMessageKey);
}

async function resumeFlowSession(
	session: typeof flowSession.$inferSelect,
	incomingText: string,
	replyJid: string,
	triggerMessageKey?: import("baileys").WAMessageKey,
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
	const variables = normalizeVariables(session.variables);
	variables[variableName || "reply"] = incomingText;

	const ctx: ExecutionContext = {
		flowId: flowRow.id,
		contactNumber: session.contactNumber,
		replyJid,
		incomingText,
		deviceId: session.deviceId,
		logId: session.executionLogId,
		variables,
		nodeResults: normalizeNodeResults(session.nodeResults),
		triggerMessageKey,
	};

	const connection = connectionManager.getConnection(ctx.deviceId);
	if (!connection?.socket) {
		await markSessionFailed(session, "Device not connected");
		return {
			status: "failed",
			logId: ctx.logId,
			sessionId: session.id,
			error: "Device not connected",
		};
	}

	const result = await runFlowNodes({
		nodes,
		edges,
		startNodes: getNodesByIds(normalizeNodeIds(session.nextNodeIds), nodes),
		ctx,
		socket: connection.socket,
		previousSessionId: session.id,
	});

	if (result.status === "waiting") {
		return { status: "waiting", logId: ctx.logId, sessionId: result.sessionId };
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
	await db
		.update(flowSession)
		.set({
			status,
			variables,
			nodeResults: ctx.nodeResults,
			completedAt: new Date(),
		})
		.where(eq(flowSession.id, session.id));

	return { status, logId: ctx.logId, sessionId: session.id };
}

async function markSessionFailed(
	session: typeof flowSession.$inferSelect,
	error: string,
	nodeResults = normalizeNodeResults(session.nodeResults),
	variables = normalizeVariables(session.variables),
) {
	await persistProgress(session.executionLogId, nodeResults, error, "failed");
	await db
		.update(flowSession)
		.set({
			status: "failed",
			variables,
			nodeResults,
			completedAt: new Date(),
		})
		.where(eq(flowSession.id, session.id));
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
	};

	const connection = connectionManager.getConnection(ctx.deviceId);
	if (!connection?.socket) {
		const [failedLog] = await db
			.insert(flowExecutionLog)
			.values({
				id: logId,
				flowId: flowRow.id,
				deviceId: ctx.deviceId,
				contactNumber,
				triggerSource,
				status: "failed",
				error: "Device not connected",
				nodeResults: [],
				startedAt: new Date(),
				completedAt: new Date(),
			})
			.returning({
				id: flowExecutionLog.id,
				flowId: flowExecutionLog.flowId,
				deviceId: flowExecutionLog.deviceId,
			});
		if (failedLog) emitLogCreated(failedLog);
		return { status: "failed", logId, error: "Device not connected" };
	}

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
	if (createdLog) emitLogCreated(createdLog);

	const adjacency = buildAdjacencyMap(edges);
	const result = await runFlowNodes({
		nodes,
		edges,
		startNodes: getNextNodes(triggerNode.id, adjacency, nodes),
		ctx,
		socket: connection.socket,
	});

	if (result.status === "waiting") {
		return { status: "waiting", logId, sessionId: result.sessionId };
	}

	if (result.status === "failed") {
		await persistProgress(logId, ctx.nodeResults, result.error, "failed");
		return { status: "failed", logId, error: result.error };
	}

	const status = result.hasError ? "failed" : "completed";
	await persistProgress(
		logId,
		ctx.nodeResults,
		result.hasError ? "One or more nodes failed" : undefined,
		status,
	);
	return { status, logId };
}
