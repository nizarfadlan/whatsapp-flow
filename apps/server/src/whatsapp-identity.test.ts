import { describe, expect, mock, test } from "bun:test";

function normalizeContactNumber(value: string | null | undefined) {
	return value?.replace(/[^\d]/g, "") || null;
}

function isLidJid(jid: string | null | undefined) {
	return jid?.endsWith("@lid") ?? false;
}

function phoneNumberFromJid(jid: string | null | undefined) {
	if (!jid?.endsWith("@s.whatsapp.net")) return null;
	return normalizeContactNumber(jid.split("@")[0]?.split(":")[0]);
}

mock.module("@whatsapp-flow/whatsapp", () => ({
	derivePrivateIdentityKey: ({
		jid,
		number,
		lid,
	}: {
		jid?: string | null;
		number?: string | null;
		lid?: string | null;
	}) => {
		const phoneNumber =
			normalizeContactNumber(number) ?? phoneNumberFromJid(jid);
		if (phoneNumber) return `phone:${phoneNumber}`;
		const lidJid = lid || (isLidJid(jid) ? jid : null);
		if (lidJid) return `lid:${lidJid}`;
		return `jid:${jid ?? "unknown"}`;
	},
	isLidJid,
	normalizeContactNumber,
	toPhoneJid: (phoneNumber: string) =>
		phoneNumber.includes("@") ? phoneNumber : `${phoneNumber}@s.whatsapp.net`,
}));

const {
	buildPrivateContactIdentity,
	buildPrivateThreadAliases,
	choosePrivateThreadSurvivor,
} = await import("./whatsapp-identity");

describe("private WhatsApp identity merging", () => {
	test("canonicalizes a LID message to the phone identity when the PN alias is known", () => {
		expect(
			buildPrivateContactIdentity({
				jid: "abc@lid",
				number: "+62 812-3456",
				lid: "abc@lid",
			}),
		).toEqual({
			phoneNumber: "628123456",
			lid: "abc@lid",
			identityKey: "phone:628123456",
		});
	});

	test("searches both PN and LID aliases before creating a private thread", () => {
		expect(
			buildPrivateThreadAliases({
				jid: "abc@lid",
				phoneNumber: "+62 812-3456",
				lid: "abc@lid",
			}),
		).toEqual(["abc@lid", "628123456@s.whatsapp.net"]);
	});

	test("reuses an existing LID-only thread when it becomes a phone-keyed thread", () => {
		const lidThread = {
			id: "thread_lid",
			threadKey: "lid:abc@lid",
			lastMessageAt: new Date("2026-01-01T00:00:00Z"),
		};

		expect(
			choosePrivateThreadSurvivor([lidThread], "phone:628123456")?.id,
		).toBe("thread_lid");
	});

	test("keeps the canonical phone-keyed thread when duplicate alias threads exist", () => {
		const canonicalThread = {
			id: "thread_phone",
			threadKey: "phone:628123456",
			lastMessageAt: new Date("2026-01-01T00:00:00Z"),
		};
		const aliasThread = {
			id: "thread_lid",
			threadKey: "lid:abc@lid",
			lastMessageAt: new Date("2026-01-02T00:00:00Z"),
		};

		expect(
			choosePrivateThreadSurvivor(
				[aliasThread, canonicalThread],
				"phone:628123456",
			)?.id,
		).toBe("thread_phone");
	});
});
