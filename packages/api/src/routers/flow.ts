import { TRPCError } from "@trpc/server";
import { device, flow } from "@whatsapp-flow/db/schema/device";
import { connectionManager } from "@whatsapp-flow/whatsapp";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { validateCronExpression } from "../engine/cron";
import {
	deleteFlowNodeSecret,
	deleteFlowNodeSecretsForMissingNodes,
	hasFlowNodeSecret,
	upsertFlowNodeSecret,
	WEBHOOK_AUTH_SECRET_KEY,
} from "../engine/flow-node-secrets";
import { protectedProcedure, router } from "../index";

const jsonSchema = z.unknown();

type FlowNode = {
	id: string;
	type?: string;
	data?: Record<string, unknown>;
};

type FlowEdge = {
	source: string;
	target: string;
	sourceHandle?: string | null;
};

function getTriggerPayload(nodes: FlowNode[]) {
	const trigger = nodes.find((node) => node.type === "trigger");
	const data = (trigger?.data ?? {}) as Record<string, unknown>;
	const kind = data.triggerKind;

	switch (kind) {
		case "keyword":
			return {
				triggerType: "keyword" as const,
				triggerConfig: { keywords: parseTriggerKeywords(data) },
			};
		case "any_message":
			return { triggerType: "any_message" as const, triggerConfig: null };
		case "webhook":
			return {
				triggerType: "webhook" as const,
				triggerConfig: { webhookToken: String(data.webhookToken ?? "") },
			};
		case "schedule":
			return {
				triggerType: "schedule" as const,
				triggerConfig: {
					cronExpression: String(data.cronExpression ?? ""),
					contactNumber: String(data.contactNumber ?? ""),
				},
			};
		default:
			return null;
	}
}

function nonEmpty(value: unknown) {
	return typeof value === "string" && value.trim().length > 0;
}

function parseTriggerKeywords(value: unknown) {
	const data = value && typeof value === "object" ? value : null;
	const keywords =
		data && "keywords" in data && Array.isArray(data.keywords)
			? data.keywords
			: String(data && "keyword" in data ? data.keyword : (value ?? "")).split(
					/[\n,]/,
				);
	const seen = new Set<string>();
	return keywords
		.map((keyword) => String(keyword).trim())
		.filter((keyword) => {
			const key = keyword.toLowerCase();
			if (!key || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

function normalizeNumber(value: unknown) {
	return typeof value === "string" ? value.replace(/[^\d]/g, "") : "";
}

function isValidLatitude(value: unknown) {
	const latitude = Number(value);
	return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

function isValidLongitude(value: unknown) {
	const longitude = Number(value);
	return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function getReplyWarnings(data: Record<string, unknown>) {
	return Array.isArray(data.replyWarnings) ? data.replyWarnings : [];
}

function validateReplyWarnings(
	data: Record<string, unknown>,
	timeoutMinutes: number,
) {
	const warnings = getReplyWarnings(data);
	for (const warning of warnings) {
		if (!warning || typeof warning !== "object") {
			return "Wait for Reply warnings must be valid objects";
		}
		const warningData = warning as Record<string, unknown>;
		const afterMinutes = Number(warningData.afterMinutes);
		if (
			!Number.isInteger(afterMinutes) ||
			afterMinutes < 1 ||
			afterMinutes >= timeoutMinutes
		) {
			return "Wait for Reply warning time must be before the timeout";
		}
		if (!nonEmpty(warningData.message)) {
			return "Wait for Reply warning message cannot be empty";
		}
	}
	return null;
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

function getWebhookAuth(value: unknown): WebhookAuthConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { type: "none" };
	}
	const data = value as Record<string, unknown>;
	const type = data.type;
	if (type === "bearer") {
		return {
			type,
			secretValue: typeof data.secretValue === "string" ? data.secretValue : "",
			hasSecret: data.hasSecret === true,
		};
	}
	if (type === "basic") {
		return {
			type,
			username: typeof data.username === "string" ? data.username : "",
			secretValue: typeof data.secretValue === "string" ? data.secretValue : "",
			hasSecret: data.hasSecret === true,
		};
	}
	if (type === "api_key") {
		return {
			type,
			apiKeyName: typeof data.apiKeyName === "string" ? data.apiKeyName : "",
			secretValue: typeof data.secretValue === "string" ? data.secretValue : "",
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
				const key = String(data.key ?? data.name ?? "").trim();
				const value = String(data.value ?? "");
				return {
					id: String(data.id ?? crypto.randomUUID()),
					key,
					value,
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

function validateWebhookCallConfig(data: Record<string, unknown>) {
	if (!nonEmpty(data.webhookUrl)) return "Webhook Call node needs a URL";
	const method = String(data.webhookMethod ?? "POST").toUpperCase();
	if (!["GET", "POST", "PUT"].includes(method)) {
		return "Webhook Call method must be GET, POST, or PUT";
	}

	const headers = normalizeWebhookHeaders(data.webhookHeaders);
	if (headers.length > 20) return "Webhook Call supports up to 20 headers";
	const seenHeaders = new Set<string>();
	for (const header of headers) {
		const key = header.key.trim();
		const lowerKey = key.toLowerCase();
		if (!validateWebhookHeaderName(key)) {
			return "Webhook Call header names must be valid HTTP header names";
		}
		if (BLOCKED_WEBHOOK_HEADERS.has(lowerKey)) {
			return `Webhook Call header ${key} must be configured through built-in settings`;
		}
		if (seenHeaders.has(lowerKey)) {
			return `Webhook Call header ${key} is duplicated`;
		}
		if (header.value.length > 4096 || /[\r\n]/.test(header.value)) {
			return `Webhook Call header ${key} has an invalid value`;
		}
		seenHeaders.add(lowerKey);
	}

	const auth = getWebhookAuth(data.webhookAuth);
	if (
		auth.type !== "none" &&
		String(data.webhookUrl ?? "")
			.trim()
			.toLowerCase()
			.startsWith("http://")
	) {
		return "Authenticated Webhook Call URLs must use HTTPS";
	}
	if (auth.type === "bearer" && !auth.hasSecret) {
		return "Webhook Call bearer token is required";
	}
	if (auth.type === "basic") {
		if (!auth.username?.trim())
			return "Webhook Call basic auth username is required";
		if (!auth.hasSecret) return "Webhook Call basic auth password is required";
	}
	if (auth.type === "api_key") {
		const apiKeyName = auth.apiKeyName?.trim() ?? "";
		if (!validateWebhookHeaderName(apiKeyName)) {
			return "Webhook Call API key header name is invalid";
		}
		if (BLOCKED_WEBHOOK_HEADERS.has(apiKeyName.toLowerCase())) {
			return "Webhook Call API key header name is reserved";
		}
		if (seenHeaders.has(apiKeyName.toLowerCase())) {
			return "Webhook Call API key header duplicates a custom header";
		}
		if (!auth.hasSecret) return "Webhook Call API key value is required";
	}

	return null;
}

function sanitizeWebhookAuthForClient(value: unknown): WebhookAuthConfig {
	const auth = getWebhookAuth(value);
	if (auth.type === "bearer") {
		return { type: "bearer", hasSecret: auth.hasSecret };
	}
	if (auth.type === "basic") {
		return {
			type: "basic",
			username: auth.username ?? "",
			hasSecret: auth.hasSecret,
		};
	}
	if (auth.type === "api_key") {
		return {
			type: "api_key",
			apiKeyName: auth.apiKeyName ?? "",
			hasSecret: auth.hasSecret,
		};
	}
	return { type: "none" };
}

function stripWebhookAuthSecretValue(node: FlowNode) {
	if (!node.data?.webhookAuth) return node;
	return {
		...node,
		data: {
			...node.data,
			webhookAuth: sanitizeWebhookAuthForClient(node.data.webhookAuth),
		},
	};
}

function isWebhookCallNode(node: FlowNode) {
	return node.type === "webhook-call" || node.data?.nodeType === "webhook-call";
}

function sanitizeFlowNodesForClient(value: unknown) {
	if (!Array.isArray(value)) return value;
	return value.map((node) => {
		if (!node || typeof node !== "object") return node;
		const flowNode = node as FlowNode;
		if (!isWebhookCallNode(flowNode))
			return stripWebhookAuthSecretValue(flowNode);
		return {
			...flowNode,
			data: {
				...flowNode.data,
				nodeType: "webhook-call",
				webhookAuth: sanitizeWebhookAuthForClient(flowNode.data?.webhookAuth),
				webhookHeaders: normalizeWebhookHeaders(flowNode.data?.webhookHeaders),
			},
		};
	});
}

async function sanitizeWebhookCallNodeForStorage(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	flowId: string,
	node: FlowNode,
	previousNode?: FlowNode,
) {
	const data = node.data ?? {};
	const auth = getWebhookAuth(data.webhookAuth);
	const previousAuth = getWebhookAuth(previousNode?.data?.webhookAuth);
	const sameAuthType = auth.type === previousAuth.type;
	const secretValue = "secretValue" in auth ? (auth.secretValue ?? "") : "";
	let hasSecret = false;

	if (auth.type === "none") {
		await deleteFlowNodeSecret(db, {
			flowId,
			nodeId: node.id,
			key: WEBHOOK_AUTH_SECRET_KEY,
		});
	} else if (secretValue) {
		await upsertFlowNodeSecret(db, {
			flowId,
			nodeId: node.id,
			key: WEBHOOK_AUTH_SECRET_KEY,
			value: secretValue,
		});
		hasSecret = true;
	} else if (
		sameAuthType &&
		previousAuth.type !== "none" &&
		previousAuth.hasSecret
	) {
		hasSecret = await hasFlowNodeSecret(db, {
			flowId,
			nodeId: node.id,
			key: WEBHOOK_AUTH_SECRET_KEY,
		});
	} else {
		await deleteFlowNodeSecret(db, {
			flowId,
			nodeId: node.id,
			key: WEBHOOK_AUTH_SECRET_KEY,
		});
	}

	const webhookAuth = (() => {
		if (auth.type === "bearer") return { type: "bearer" as const, hasSecret };
		if (auth.type === "basic") {
			return {
				type: "basic" as const,
				username: auth.username?.trim() ?? "",
				hasSecret,
			};
		}
		if (auth.type === "api_key") {
			return {
				type: "api_key" as const,
				apiKeyName: auth.apiKeyName?.trim() ?? "",
				hasSecret,
			};
		}
		return { type: "none" as const };
	})();

	return {
		...node,
		data: {
			...data,
			nodeType: "webhook-call",
			webhookMethod: String(data.webhookMethod ?? "POST").toUpperCase(),
			webhookAuth,
			webhookHeaders: normalizeWebhookHeaders(data.webhookHeaders),
		},
	};
}

async function sanitizeFlowNodesForStorage(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	flowId: string,
	nodes: FlowNode[],
	previousNodes: FlowNode[],
) {
	const previousById = new Map(previousNodes.map((node) => [node.id, node]));
	const sanitized: FlowNode[] = [];
	for (const node of nodes) {
		if (isWebhookCallNode(node)) {
			sanitized.push(
				await sanitizeWebhookCallNodeForStorage(
					db,
					flowId,
					node,
					previousById.get(node.id),
				),
			);
		} else {
			sanitized.push(stripWebhookAuthSecretValue(node));
		}
	}
	await deleteFlowNodeSecretsForMissingNodes(
		db,
		flowId,
		new Set(nodes.map((node) => node.id)),
	);
	return sanitized;
}

function sanitizeFlowForClient<T extends { nodes: unknown }>(row: T) {
	return { ...row, nodes: sanitizeFlowNodesForClient(row.nodes) };
}

function stripWebhookSecretsForCopy(value: unknown) {
	if (!Array.isArray(value)) return value;
	return value.map((node) => {
		if (!node || typeof node !== "object") return node;
		const flowNode = node as FlowNode;
		if (!isWebhookCallNode(flowNode))
			return stripWebhookAuthSecretValue(flowNode);
		const auth = sanitizeWebhookAuthForClient(flowNode.data?.webhookAuth);
		const nextAuth =
			auth.type === "none" ? auth : { ...auth, hasSecret: false };
		return {
			...flowNode,
			data: {
				...flowNode.data,
				nodeType: "webhook-call",
				webhookAuth: nextAuth,
				webhookHeaders: normalizeWebhookHeaders(flowNode.data?.webhookHeaders),
			},
		};
	});
}

function isInteractiveNode(type: string | undefined) {
	return (
		type === "send-button" ||
		type === "send-list" ||
		type === "send-quick-reply"
	);
}

function getInteractiveOptionHandles(node: FlowNode) {
	if (!isInteractiveNode(node.type)) return [];
	const data = node.data ?? {};
	const options =
		node.type === "send-list"
			? (
					(data.sections as
						| { rows?: { id?: string; title?: string }[] }[]
						| undefined) ?? []
				).flatMap((section) =>
					(section.rows ?? []).map((row) => ({
						id: String(row.id ?? "").trim(),
						text: String(row.title ?? "").trim(),
					})),
				)
			: (
					(data.buttons as { id?: string; text?: string }[] | undefined) ?? []
				).map((button) => ({
					id: String(button.id ?? "").trim(),
					text: String(button.text ?? "").trim(),
				}));

	return options
		.filter((option) => option.id && option.text)
		.map((option) => `option:${option.id}`);
}

export function validateFlowGraph(nodes: FlowNode[], edges: FlowEdge[]) {
	if (nodes.length === 0) return "Flow has no nodes";

	const triggers = nodes.filter((node) => node.type === "trigger");
	if (triggers.length === 0) return "Flow needs exactly one trigger node";
	if (triggers.length > 1) return "Flow can only have one trigger node";

	const trigger = triggers[0];
	if (!trigger) return "Flow needs exactly one trigger node";
	if (!edges.some((edge) => edge.source === trigger.id)) {
		return "Trigger node must connect to another node";
	}

	const triggerData = trigger.data ?? {};
	const triggerKind = triggerData.triggerKind;
	if (
		triggerKind === "keyword" &&
		parseTriggerKeywords(triggerData).length === 0
	) {
		return "Keyword trigger needs at least one keyword";
	}
	if (triggerKind === "webhook" && !nonEmpty(triggerData.webhookToken)) {
		return "Webhook trigger needs a secret token";
	}
	if (triggerKind === "schedule") {
		if (!nonEmpty(triggerData.cronExpression)) {
			return "Schedule trigger needs a cron expression";
		}
		const cronValidation = validateCronExpression(
			String(triggerData.cronExpression),
		);
		if (!cronValidation.ok) {
			return cronValidation.message;
		}
		if (!normalizeNumber(triggerData.contactNumber)) {
			return "Schedule trigger needs a recipient number";
		}
	}

	for (const node of nodes) {
		const data = node.data ?? {};
		switch (node.type) {
			case "send-text":
				if (!nonEmpty(data.text)) return "Send Text node needs message text";
				break;
			case "send-image":
			case "send-video":
			case "send-audio":
			case "send-document":
				if (!nonEmpty(data.mediaUrl)) {
					return `${node.type} node needs media URL`;
				}
				break;
			case "send-location":
				if (
					!isValidLatitude(data.latitude) ||
					!isValidLongitude(data.longitude)
				) {
					return "Send Location node needs valid latitude and longitude";
				}
				break;
			case "send-button":
			case "send-quick-reply":
			case "send-list": {
				const optionHandles = new Set(getInteractiveOptionHandles(node));
				if (optionHandles.size === 0) {
					return `${node.type} node needs at least one option`;
				}

				const outgoing = edges.filter((edge) => edge.source === node.id);
				for (const edge of outgoing) {
					if (!edge.sourceHandle) {
						return `${node.type} node branches must use option handles`;
					}
					if (!optionHandles.has(edge.sourceHandle)) {
						return `${node.type} node has a stale option branch`;
					}
				}
				if (outgoing.length === 0) {
					return `${node.type} node needs at least one connected option branch`;
				}
				break;
			}
			case "condition":
				if (!nonEmpty(data.field) || !nonEmpty(data.value)) {
					return "Condition node needs field and value";
				}
				if (
					!edges.some(
						(edge) => edge.source === node.id && edge.sourceHandle === "true",
					)
				) {
					return "Condition node needs a true branch";
				}
				if (
					!edges.some(
						(edge) => edge.source === node.id && edge.sourceHandle === "false",
					)
				) {
					return "Condition node needs a false branch";
				}
				break;
			case "wait-for-reply": {
				if (!nonEmpty(data.variableName)) {
					return "Wait for Reply node needs a variable name";
				}
				const timeoutMinutes = Number(data.timeoutMinutes ?? 1440);
				if (
					!Number.isInteger(timeoutMinutes) ||
					timeoutMinutes < 1 ||
					timeoutMinutes > 10_080
				) {
					return "Wait for Reply timeout must be between 1 and 10080 minutes";
				}
				const warningError = validateReplyWarnings(data, timeoutMinutes);
				if (warningError) return warningError;
				break;
			}
			case "webhook-call": {
				const webhookError = validateWebhookCallConfig(data);
				if (webhookError) return webhookError;
				break;
			}
			case "forward":
				if (!nonEmpty(data.targetNumber)) {
					return "Forward node needs a target number";
				}
				break;
		}
	}

	return null;
}

async function requireFlowOwnership(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	flowId: string,
	userId: string,
) {
	const rows = await db
		.select()
		.from(flow)
		.where(and(eq(flow.id, flowId), eq(flow.userId, userId)))
		.limit(1);

	const found = rows[0];
	if (!found) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
	}

	return found;
}

async function requireDeviceOwnership(
	db: ReturnType<typeof import("@whatsapp-flow/db").createDb>,
	deviceId: string,
	userId: string,
) {
	const rows = await db
		.select({ id: device.id, provider: device.provider, status: device.status })
		.from(device)
		.where(and(eq(device.id, deviceId), eq(device.userId, userId)))
		.limit(1);

	const found = rows[0];
	if (!found) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
	}

	return found;
}

export const flowRouter = router({
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select({
				id: flow.id,
				name: flow.name,
				description: flow.description,
				status: flow.status,
				triggerType: flow.triggerType,
				deviceId: flow.deviceId,
				deviceName: device.name,
				createdAt: flow.createdAt,
				updatedAt: flow.updatedAt,
			})
			.from(flow)
			.leftJoin(device, eq(flow.deviceId, device.id))
			.where(eq(flow.userId, ctx.session.user.id))
			.orderBy(desc(flow.updatedAt));
	}),

	getById: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const found = await requireFlowOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);
			return sanitizeFlowForClient(found);
		}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				description: z.string().optional(),
				triggerType: z
					.enum(["keyword", "any_message", "webhook", "schedule"])
					.optional(),
				triggerConfig: jsonSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const id = crypto.randomUUID();
			const rows = await ctx.db
				.insert(flow)
				.values({
					id,
					userId: ctx.session.user.id,
					name: input.name,
					description: input.description ?? null,
					triggerType: (input.triggerType ?? "keyword") as
						| "keyword"
						| "any_message"
						| "webhook"
						| "schedule",
					triggerConfig: input.triggerConfig ?? null,
				})
				.returning({
					id: flow.id,
					name: flow.name,
					status: flow.status,
				});

			return rows[0];
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1).optional(),
				description: z.string().nullable().optional(),
				nodes: jsonSchema.optional(),
				edges: jsonSchema.optional(),
				triggerType: z
					.enum(["keyword", "any_message", "webhook", "schedule"])
					.optional(),
				triggerConfig: jsonSchema.optional(),
				deviceId: z.string().min(1).nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const found = await requireFlowOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);
			if (input.deviceId) {
				await requireDeviceOwnership(
					ctx.db,
					input.deviceId,
					ctx.session.user.id,
				);
			}
			const persistUpdates = async (db: typeof ctx.db) => {
				const { id, ...updates } = input;
				delete updates.triggerType;
				delete updates.triggerConfig;

				if (Array.isArray(input.nodes)) {
					const previousNodes = Array.isArray(found.nodes)
						? (found.nodes as FlowNode[])
						: [];
					const sanitizedNodes = await sanitizeFlowNodesForStorage(
						db,
						id,
						input.nodes as FlowNode[],
						previousNodes,
					);
					updates.nodes = sanitizedNodes;

					const triggerPayload = getTriggerPayload(sanitizedNodes);
					if (triggerPayload) {
						updates.triggerType = triggerPayload.triggerType;
						updates.triggerConfig = triggerPayload.triggerConfig;
					}
				}

				if (Object.keys(updates).length === 0) {
					return sanitizeFlowForClient(found);
				}

				const rows = await db
					.update(flow)
					.set(updates)
					.where(eq(flow.id, id))
					.returning();

				const updated = rows[0] ?? found;
				return sanitizeFlowForClient(updated);
			};

			const dbWithTransaction = ctx.db as typeof ctx.db & {
				transaction?: <T>(
					callback: (tx: typeof ctx.db) => Promise<T>,
				) => Promise<T>;
			};

			return dbWithTransaction.transaction
				? dbWithTransaction.transaction(persistUpdates)
				: persistUpdates(ctx.db);
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireFlowOwnership(ctx.db, input.id, ctx.session.user.id);
			await ctx.db.delete(flow).where(eq(flow.id, input.id));
			return { success: true };
		}),

	toggleStatus: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				status: z.enum(["draft", "active", "paused"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const found = await requireFlowOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);

			if (input.status === "active") {
				const nodes = Array.isArray(found.nodes)
					? (found.nodes as FlowNode[])
					: [];
				const edges = Array.isArray(found.edges)
					? (found.edges as FlowEdge[])
					: [];
				const validationError = validateFlowGraph(nodes, edges);
				if (validationError) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: validationError,
					});
				}

				if (!found.deviceId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Deploy flow to a device before activating",
					});
				}

				const targetDevice = await requireDeviceOwnership(
					ctx.db,
					found.deviceId,
					ctx.session.user.id,
				);
				const deviceStatus =
					targetDevice.provider === "baileys"
						? (connectionManager.getConnection(found.deviceId)?.status ??
							targetDevice.status)
						: targetDevice.status;
				if (deviceStatus !== "connected") {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Device must be connected before activation",
					});
				}

				const [existing] = await ctx.db
					.select({ id: flow.id })
					.from(flow)
					.where(
						and(eq(flow.deviceId, found.deviceId), eq(flow.status, "active")),
					)
					.limit(1);
				if (existing && existing.id !== input.id) {
					await ctx.db
						.update(flow)
						.set({ status: "paused" })
						.where(eq(flow.id, existing.id));
				}
			}

			await ctx.db
				.update(flow)
				.set({ status: input.status })
				.where(eq(flow.id, input.id));

			return { success: true };
		}),

	deploy: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				deviceId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const found = await requireFlowOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);

			const nodes = Array.isArray(found.nodes)
				? (found.nodes as FlowNode[])
				: [];
			const edges = Array.isArray(found.edges)
				? (found.edges as FlowEdge[])
				: [];
			const validationError = validateFlowGraph(nodes, edges);
			if (validationError) {
				throw new TRPCError({ code: "BAD_REQUEST", message: validationError });
			}

			const targetDevice = await requireDeviceOwnership(
				ctx.db,
				input.deviceId,
				ctx.session.user.id,
			);

			const deviceStatus =
				targetDevice.provider === "baileys"
					? (connectionManager.getConnection(input.deviceId)?.status ??
						targetDevice.status)
					: targetDevice.status;
			if (deviceStatus !== "connected") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Device must be connected before deploy",
				});
			}

			const triggerPayload = getTriggerPayload(nodes);
			if (!triggerPayload) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Flow needs a trigger node",
				});
			}

			const [existing] = await ctx.db
				.select({ id: flow.id })
				.from(flow)
				.where(
					and(eq(flow.deviceId, input.deviceId), eq(flow.status, "active")),
				)
				.limit(1);
			if (existing && existing.id !== input.id) {
				await ctx.db
					.update(flow)
					.set({ status: "paused" })
					.where(eq(flow.id, existing.id));
			}

			await ctx.db
				.update(flow)
				.set({
					deviceId: input.deviceId,
					status: "active",
					triggerType: triggerPayload.triggerType,
					triggerConfig: triggerPayload.triggerConfig,
				})
				.where(eq(flow.id, input.id));

			return { success: true };
		}),

	duplicate: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const original = await requireFlowOwnership(
				ctx.db,
				input.id,
				ctx.session.user.id,
			);

			const newId = crypto.randomUUID();
			const rows = await ctx.db
				.insert(flow)
				.values({
					id: newId,
					userId: ctx.session.user.id,
					name: `${original.name} (Copy)`,
					description: original.description,
					nodes: stripWebhookSecretsForCopy(original.nodes),
					edges: original.edges,
					triggerType: original.triggerType,
					triggerConfig: original.triggerConfig,
					status: "draft",
				})
				.returning({
					id: flow.id,
					name: flow.name,
				});

			return rows[0];
		}),
});
