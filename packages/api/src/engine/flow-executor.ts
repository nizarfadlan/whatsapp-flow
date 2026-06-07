import { db } from "@whatsapp-flow/db";
import { type flow, flowExecutionLog } from "@whatsapp-flow/db/schema/device";
import type { OutgoingMessage } from "@whatsapp-flow/whatsapp";
import {
	connectionManager,
	sendWhatsAppMessage,
} from "@whatsapp-flow/whatsapp";
import { eq } from "drizzle-orm";

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
	contactNumber: string;
	incomingText: string;
	deviceId: string;
	logId: string;
	variables: Record<string, string>;
	nodeResults: NodeResult[];
};

type ExecutionStatus = "running" | "completed" | "failed";

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
	return nodes.find((node) => node.type?.startsWith("trigger-"));
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
	const jid = `${ctx.contactNumber}@s.whatsapp.net`;

	try {
		switch (type) {
			case "send-text": {
				const text = resolveTemplate(String(data.text ?? ""), ctx);
				await sendWhatsAppMessage(socket, jid, { type: "text", text });
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
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "error",
					error: "Reaction node needs incoming message key support",
				});
				return false;
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
			case "send-list":
			case "send-quick-reply": {
				const bodyText = resolveTemplate(String(data.bodyText ?? ""), ctx);
				await sendWhatsAppMessage(socket, jid, {
					type: "text",
					text: bodyText,
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
				const method = String(data.webhookMethod ?? "POST");
				const url = resolveTemplate(String(data.webhookUrl ?? ""), ctx);
				const response =
					method === "GET"
						? await fetch(url)
						: await fetch(url, {
								method,
								headers: { "content-type": "application/json" },
								body: JSON.stringify({
									contact: ctx.contactNumber,
									variables: ctx.variables,
								}),
							});
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
				if (target) {
					await sendWhatsAppMessage(socket, `${target}@s.whatsapp.net`, {
						type: "text",
						text: `Forwarded from ${ctx.contactNumber}`,
					});
				}
				ctx.nodeResults.push({
					nodeId: node.id,
					status: "success",
					output: target,
				});
				return true;
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
		if (status === "completed" || status === "failed")
			updates.completedAt = new Date();
		await db
			.update(flowExecutionLog)
			.set(updates)
			.where(eq(flowExecutionLog.id, logId));
	} catch {}
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

export async function executeFlow(
	flowRow: typeof flow.$inferSelect,
	contactNumber: string,
	incomingText: string,
) {
	const nodes = (flowRow.nodes ?? []) as FlowNode[];
	const edges = (flowRow.edges ?? []) as FlowEdge[];
	if (nodes.length === 0) return;

	const adjacency = buildAdjacencyMap(edges);
	const triggerNode = getTriggerNode(nodes);
	if (!triggerNode) return;

	const logId = crypto.randomUUID();
	const ctx: ExecutionContext = {
		contactNumber,
		incomingText,
		deviceId: flowRow.deviceId ?? "",
		logId,
		variables: {},
		nodeResults: [],
	};

	const connection = connectionManager.getConnection(ctx.deviceId);
	if (!connection?.socket) {
		await db.insert(flowExecutionLog).values({
			id: logId,
			flowId: flowRow.id,
			deviceId: ctx.deviceId,
			contactNumber,
			status: "failed",
			error: "Device not connected",
			nodeResults: [],
			startedAt: new Date(),
			completedAt: new Date(),
		});
		return;
	}

	await db.insert(flowExecutionLog).values({
		id: logId,
		flowId: flowRow.id,
		deviceId: ctx.deviceId,
		contactNumber,
		status: "running",
		nodeResults: [],
		startedAt: new Date(),
	});

	const visited = new Set<string>();
	const queue = getNextNodes(triggerNode.id, adjacency, nodes).map((node) => ({
		node,
	}));
	let hasError = false;

	while (queue.length > 0) {
		const item = queue.shift();
		if (!item || visited.has(item.node.id)) continue;
		visited.add(item.node.id);

		const ok = await executeNode(item.node, ctx, connection.socket);
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
			for (const node of getNextNodes(item.node.id, adjacency, nodes, branch))
				queue.push({ node });
			continue;
		}

		if (item.node.type === "random") {
			const next = getNextNodes(item.node.id, adjacency, nodes);
			const picked = next[Math.floor(Math.random() * next.length)];
			if (picked) queue.push({ node: picked });
			continue;
		}

		if (item.node.type !== "end") {
			for (const node of getNextNodes(item.node.id, adjacency, nodes))
				queue.push({ node });
		}
	}

	await persistProgress(
		logId,
		ctx.nodeResults,
		hasError ? "One or more nodes failed" : undefined,
		hasError ? "failed" : "completed",
	);
}
