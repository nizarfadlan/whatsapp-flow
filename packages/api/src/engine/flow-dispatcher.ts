import { db } from "@whatsapp-flow/db";
import {
	chatGroup,
	contact,
	contactTag,
	groupTag,
} from "@whatsapp-flow/db/schema/contact";
import { flow, flowSession } from "@whatsapp-flow/db/schema/device";
import type { IncomingMessage } from "@whatsapp-flow/whatsapp";
import {
	connectionManager,
	derivePrivateIdentityKey,
	matchesKeywordTrigger,
} from "@whatsapp-flow/whatsapp";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { matchesCronExpression } from "./cron";
import { enqueueJob } from "./job-queue";
import {
	messageFlowJobIdempotencyKey,
	pollResumeJobIdempotencyKey,
	resumeFlowJobIdempotencyKey,
	scheduledFlowJobIdempotencyKey,
} from "./job-types";

type DispatcherState = {
	messageStarted: boolean;
	scheduleStarted: boolean;
	scheduleTimer: ReturnType<typeof setInterval> | null;
	lastScheduleMinute: string | null;
	scheduleRunning: boolean;
};

type ScheduleTriggerConfig = {
	cronExpression?: string;
	contactNumber?: string;
};

type ChatScope = "any" | "private" | "groups";

type MessageTriggerConfig = {
	keyword?: string;
	keywords?: string[];
	chatScope?: ChatScope;
	groupTagIds?: string[];
	senderTagIds?: string[];
};

type MessageTriggerContext = {
	chatType: "private" | "group" | "channel" | "broadcast";
	groupTagIds: ReadonlySet<string>;
	senderTagIds: ReadonlySet<string>;
};

const globalDispatcherState = globalThis as typeof globalThis & {
	__whatsappFlowDispatcher?: DispatcherState;
};

if (!globalDispatcherState.__whatsappFlowDispatcher) {
	globalDispatcherState.__whatsappFlowDispatcher = {
		messageStarted: false,
		scheduleStarted: false,
		scheduleTimer: null,
		lastScheduleMinute: null,
		scheduleRunning: false,
	};
}

const dispatcherState = globalDispatcherState.__whatsappFlowDispatcher;

export function startFlowDispatcher(): void {
	if (dispatcherState.messageStarted) return;
	dispatcherState.messageStarted = true;

	connectionManager.on("device:message", async (event: IncomingMessage) => {
		const { deviceId, message, contact } = event;
		const text = message.text ?? "";
		const contactKey =
			contact.identityKey ??
			derivePrivateIdentityKey({
				jid: contact.jid,
				number: contact.number,
				lid: contact.lid,
			});
		const contactNumber = contact.number ?? null;

		try {
			const activeSession = await findActiveSession(deviceId, contactKey);
			if (activeSession) {
				if (getIncomingMessageDispatchAction(activeSession) === "resume") {
					await enqueueJob({
						kind: "flow.resume",
						payload: {
							sessionId: activeSession.id,
							deviceId,
							contactNumber,
							contactKey,
							incomingText: text,
							reply: message.reply,
							replyJid: contact.jid,
							triggerMessageKey: message.messageKey,
							triggerProviderMessageId: message.providerMessageId,
						},
						idempotencyKey: resumeMessageIdempotencyKey(
							event,
							activeSession.id,
						),
					});
				}
				return;
			}

			const flows = await db
				.select()
				.from(flow)
				.where(and(eq(flow.deviceId, deviceId), eq(flow.status, "active")));
			const chatType = event.chat?.type ?? "private";
			const triggerConfigs = flows.map((flowRow) =>
				getMessageTriggerConfig(flowRow.triggerConfig),
			);
			const groupTagIds = await getIncomingGroupTagIds({
				deviceId,
				chatJid: event.chat?.jid ?? event.group?.jid ?? null,
				shouldQuery:
					chatType === "group" &&
					triggerConfigs.some((config) => config.groupTagIds.length > 0),
			});
			const sender = event.sender ?? contact;
			const senderIdentityKey =
				sender.identityKey ??
				derivePrivateIdentityKey({
					jid: sender.jid,
					number: sender.number,
					lid: sender.lid,
				});
			const senderTagIds = await getIncomingSenderTagIds({
				deviceId,
				identityKey: senderIdentityKey,
				shouldQuery: triggerConfigs.some(
					(config) => config.senderTagIds.length > 0,
				),
			});
			const triggerContext: MessageTriggerContext = {
				chatType,
				groupTagIds,
				senderTagIds,
			};

			for (const flowRow of flows) {
				if (!flowRow.deviceId) continue;
				if (!matchesFlowTrigger(flowRow, text, triggerContext)) continue;

				await enqueueJob({
					kind: "flow.execute",
					payload: {
						flowId: flowRow.id,
						deviceId,
						contactNumber,
						contactKey,
						incomingText: text,
						replyJid: contact.jid,
						triggerSource: "message",
						triggerMessageKey: message.messageKey,
						triggerProviderMessageId: message.providerMessageId,
					},
					idempotencyKey: flowMessageIdempotencyKey(event, flowRow.id),
				});
			}
		} catch (error) {
			console.error("Failed to dispatch incoming WhatsApp message", {
				deviceId,
				contactNumber,
				error,
			});
		}
	});

	connectionManager.on("device:poll-vote", async (event) => {
		try {
			await enqueueJob({
				kind: "flow.poll_resume",
				payload: {
					deviceId: event.deviceId,
					pollCreationKey: event.pollCreationKey,
					pollCreationMessageId: event.pollCreationMessageId,
					voterJid: event.voter.jid,
					voterNumber: event.voter.number,
					voterLid: event.voter.lid,
					voterIdentityKey: event.voter.identityKey,
					selectedOptionText: event.selectedOptionText,
					updateIdentity: event.updateIdentity,
				},
				idempotencyKey: pollResumeJobIdempotencyKey(event),
			});
		} catch (error) {
			console.error("Failed to dispatch poll vote", {
				deviceId: event.deviceId,
				error,
			});
		}
	});
}

export function startScheduleDispatcher(): void {
	if (dispatcherState.scheduleStarted) return;
	dispatcherState.scheduleStarted = true;

	const tick = async () => {
		if (dispatcherState.scheduleRunning) return;

		const now = new Date();
		const minuteKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
		if (dispatcherState.lastScheduleMinute === minuteKey) return;

		dispatcherState.lastScheduleMinute = minuteKey;
		dispatcherState.scheduleRunning = true;

		try {
			const flows = await db
				.select()
				.from(flow)
				.where(
					and(eq(flow.status, "active"), eq(flow.triggerType, "schedule")),
				);

			for (const flowRow of flows) {
				const config = flowRow.triggerConfig as ScheduleTriggerConfig | null;
				const cronExpression = config?.cronExpression?.trim();
				const contactNumber = normalizeNumber(config?.contactNumber ?? "");

				if (!flowRow.deviceId) continue;
				if (!cronExpression || !contactNumber) continue;
				if (!matchesCronExpression(cronExpression, now)) continue;

				await enqueueJob({
					kind: "flow.execute",
					payload: {
						flowId: flowRow.id,
						deviceId: flowRow.deviceId,
						contactNumber,
						contactKey: derivePrivateIdentityKey({ number: contactNumber }),
						incomingText: "",
						triggerSource: "schedule",
					},
					idempotencyKey: scheduledFlowJobIdempotencyKey(flowRow.id, minuteKey),
				});
			}
		} catch (error) {
			console.error("Failed to dispatch scheduled flows", { error });
		} finally {
			dispatcherState.scheduleRunning = false;
		}
	};

	void tick();
	dispatcherState.scheduleTimer = setInterval(() => {
		void tick();
	}, 60_000);
}

export function getIncomingMessageDispatchAction(
	session: { status: string } | null,
) {
	if (!session) return "trigger";
	return session.status === "waiting" ? "resume" : "block";
}

async function findActiveSession(deviceId: string, contactKey: string) {
	const [waiting] = await db
		.select({ id: flowSession.id, status: flowSession.status })
		.from(flowSession)
		.where(
			and(
				eq(flowSession.deviceId, deviceId),
				eq(flowSession.contactKey, contactKey),
				or(
					eq(flowSession.status, "running"),
					and(
						eq(flowSession.status, "waiting"),
						or(
							isNull(flowSession.expiresAt),
							gt(flowSession.expiresAt, new Date()),
						),
					),
				),
			),
		)
		.limit(1);
	return waiting ?? null;
}

function flowMessageIdempotencyKey(event: IncomingMessage, flowId: string) {
	const providerMessageId = providerMessageIdFromEvent(event);
	if (!providerMessageId) return undefined;
	return messageFlowJobIdempotencyKey({
		provider: event.provider ?? "baileys",
		providerMessageId,
		flowId,
	});
}

function resumeMessageIdempotencyKey(
	event: IncomingMessage,
	sessionId: string,
) {
	const providerMessageId = providerMessageIdFromEvent(event);
	if (!providerMessageId) return undefined;
	return resumeFlowJobIdempotencyKey({
		provider: event.provider ?? "baileys",
		providerMessageId,
		sessionId,
	});
}

function providerMessageIdFromEvent(event: IncomingMessage) {
	return (
		event.message.providerMessageId ?? event.message.messageKey?.id ?? null
	);
}

function normalizeTagIds(value: unknown) {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(
			value.filter((item): item is string => typeof item === "string"),
		),
	];
}

function getMessageTriggerConfig(value: unknown) {
	const config =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as MessageTriggerConfig)
			: {};
	return {
		chatScope:
			config.chatScope === "private" || config.chatScope === "groups"
				? config.chatScope
				: "any",
		groupTagIds: normalizeTagIds(config.groupTagIds),
		senderTagIds: normalizeTagIds(config.senderTagIds),
	};
}

function hasAnyTag(
	requiredTagIds: string[],
	resourceTagIds: ReadonlySet<string>,
) {
	return requiredTagIds.some((tagId) => resourceTagIds.has(tagId));
}

export function matchesMessageTriggerConfig(
	config: unknown,
	context: MessageTriggerContext,
): boolean {
	const trigger = getMessageTriggerConfig(config);
	if (
		(trigger.chatScope === "private" && context.chatType !== "private") ||
		(trigger.chatScope === "groups" && context.chatType !== "group")
	) {
		return false;
	}
	if (
		trigger.groupTagIds.length > 0 &&
		!hasAnyTag(trigger.groupTagIds, context.groupTagIds)
	) {
		return false;
	}
	if (
		trigger.senderTagIds.length > 0 &&
		!hasAnyTag(trigger.senderTagIds, context.senderTagIds)
	) {
		return false;
	}
	return true;
}

async function getIncomingGroupTagIds({
	deviceId,
	chatJid,
	shouldQuery,
}: {
	deviceId: string;
	chatJid: string | null;
	shouldQuery: boolean;
}) {
	if (!shouldQuery || !chatJid) return new Set<string>();
	const rows = await db
		.select({ tagId: groupTag.tagId })
		.from(groupTag)
		.innerJoin(chatGroup, eq(groupTag.groupId, chatGroup.id))
		.where(and(eq(chatGroup.deviceId, deviceId), eq(chatGroup.jid, chatJid)));
	return new Set(rows.map((row) => row.tagId));
}

async function getIncomingSenderTagIds({
	deviceId,
	identityKey,
	shouldQuery,
}: {
	deviceId: string;
	identityKey: string;
	shouldQuery: boolean;
}) {
	if (!shouldQuery) return new Set<string>();
	const rows = await db
		.select({ tagId: contactTag.tagId })
		.from(contactTag)
		.innerJoin(contact, eq(contactTag.contactId, contact.id))
		.where(
			and(eq(contact.deviceId, deviceId), eq(contact.identityKey, identityKey)),
		);
	return new Set(rows.map((row) => row.tagId));
}

function matchesFlowTrigger(
	flowRow: typeof flow.$inferSelect,
	messageText: string,
	context: MessageTriggerContext,
): boolean {
	if (!matchesMessageTriggerConfig(flowRow.triggerConfig, context))
		return false;

	switch (flowRow.triggerType) {
		case "any_message":
			return true;

		case "keyword": {
			const config = flowRow.triggerConfig as MessageTriggerConfig | null;
			const keywords = config?.keywords?.length
				? config.keywords
				: config?.keyword;
			if (!keywords) return false;
			return matchesKeywordTrigger(messageText, keywords);
		}

		default:
			return false;
	}
}
function normalizeNumber(value: string) {
	return value.replace(/[^\d]/g, "");
}
