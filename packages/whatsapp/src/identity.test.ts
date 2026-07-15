import { describe, expect, test } from "bun:test";
import { resolvePollUpdateVoter } from "./identity";

describe("resolvePollUpdateVoter", () => {
	test("prefers alternate voter JIDs while preserving PN and LID aliases", () => {
		expect(
			resolvePollUpdateVoter({
				id: "vote-1",
				participantAlt: "987654321@lid",
				remoteJidAlt: "15551234567@s.whatsapp.net",
				participant: "15550000000@s.whatsapp.net",
			}),
		).toEqual({
			jid: "987654321@lid",
			number: "15551234567",
			lid: "987654321@lid",
			identityKey: "phone:15551234567",
		});
	});

	test("does not treat a LID value as a phone number", () => {
		expect(
			resolvePollUpdateVoter({
				id: "vote-2",
				participantAlt: "987654321@lid",
			}),
		).toEqual({
			jid: "987654321@lid",
			number: undefined,
			lid: "987654321@lid",
			identityKey: "lid:987654321@lid",
		});
	});
});
