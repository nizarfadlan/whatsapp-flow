import { describe, expect, test } from "bun:test";
import { matchesKeywordTrigger } from "./message-handler";

describe("matchesKeywordTrigger", () => {
	test("matches any keyword case-insensitively inside the message", () => {
		expect(
			matchesKeywordTrigger("Halo, saya mau ORDER sekarang", ["help", "order"]),
		).toBe(true);
	});

	test("keeps supporting the old single-keyword format", () => {
		expect(matchesKeywordTrigger("Need price info", "PRICE")).toBe(true);
	});

	test("ignores blank keywords and rejects non-matches", () => {
		expect(matchesKeywordTrigger("hello there", ["", "  ", "bye"])).toBe(false);
	});
});
