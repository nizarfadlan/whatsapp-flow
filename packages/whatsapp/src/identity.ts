import type { WAMessageKey } from "baileys";

export type PrivateIdentityInput = {
	jid?: string | null;
	number?: string | null;
	lid?: string | null;
};

export type ThreadIdentityInput = {
	chatType: "private" | "group" | "channel" | "broadcast";
	chatJid?: string | null;
	contactIdentityKey?: string | null;
	groupJid?: string | null;
	channelJid?: string | null;
};

export function normalizeContactNumber(value: string | null | undefined) {
	return value?.replace(/[^\d]/g, "") || null;
}

export function isPhoneJid(jid: string | null | undefined) {
	return jid?.endsWith("@s.whatsapp.net") ?? false;
}

export function isLidJid(jid: string | null | undefined) {
	return jid?.endsWith("@lid") ?? false;
}

export function phoneNumberFromJid(jid: string | null | undefined) {
	if (!jid || !isPhoneJid(jid)) return null;
	return normalizeContactNumber(jid.split("@")[0]?.split(":")[0]);
}

export function toPhoneJid(phoneNumber: string) {
	return phoneNumber.includes("@")
		? phoneNumber
		: `${phoneNumber}@s.whatsapp.net`;
}

export function derivePrivateIdentityKey(input: PrivateIdentityInput) {
	const number =
		normalizeContactNumber(input.number) ?? phoneNumberFromJid(input.jid);
	if (number) return `phone:${number}`;

	const lid = input.lid || (isLidJid(input.jid) ? input.jid : null);
	if (lid) return `lid:${lid}`;

	return `jid:${input.jid ?? "unknown"}`;
}

export function resolvePollUpdateVoter(
	updateKey: WAMessageKey | null | undefined,
) {
	const aliases = [
		updateKey?.participantAlt,
		updateKey?.remoteJidAlt,
		updateKey?.participant,
		updateKey?.remoteJid,
	].filter((jid): jid is string => Boolean(jid));
	const jid = aliases[0];
	if (!jid) return null;

	const phoneJid = aliases.find(isPhoneJid);
	const number = phoneNumberFromJid(phoneJid) ?? undefined;
	const lid = aliases.find(isLidJid);
	return {
		jid,
		number,
		lid,
		identityKey: derivePrivateIdentityKey({ jid, number, lid }),
	};
}

export function deriveThreadKey(input: ThreadIdentityInput) {
	if (input.chatType === "private") {
		return (
			input.contactIdentityKey ??
			derivePrivateIdentityKey({ jid: input.chatJid })
		);
	}
	if (input.chatType === "group") {
		return `group:${input.groupJid ?? input.chatJid ?? "unknown"}`;
	}
	if (input.chatType === "channel") {
		return `channel:${input.channelJid ?? input.chatJid ?? "unknown"}`;
	}
	return `broadcast:${input.chatJid ?? "unknown"}`;
}
