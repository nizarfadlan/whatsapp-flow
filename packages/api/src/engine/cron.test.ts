import { describe, expect, test } from "bun:test";
import { matchesCronExpression, validateCronExpression } from "./cron";

describe("cron", () => {
	const monday = new Date(2026, 6, 6, 9, 15);

	test("validates five-field cron expressions", () => {
		expect(validateCronExpression("*/5 * * * *")).toEqual({ ok: true });
		expect(validateCronExpression("* * *")).toEqual({
			ok: false,
			message: "Cron expression must have 5 fields",
		});
		expect(validateCronExpression("60 * * * *")).toEqual({
			ok: false,
			message: 'minute field has invalid value "60"',
		});
	});

	test("matches exact and stepped schedules", () => {
		expect(matchesCronExpression("15 9 * * *", monday)).toBe(true);
		expect(matchesCronExpression("*/15 9 * * *", monday)).toBe(true);
		expect(matchesCronExpression("0 9 * * *", monday)).toBe(false);
	});

	test("treats day-of-week 7 as Sunday", () => {
		const sunday = new Date(2026, 6, 5, 9, 15);
		expect(matchesCronExpression("15 9 * * 7", sunday)).toBe(true);
		expect(matchesCronExpression("15 9 * * 0", sunday)).toBe(true);
	});
});
