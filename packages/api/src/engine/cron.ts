type CronField = {
	name: string;
	min: number;
	max: number;
};

const CRON_FIELDS: CronField[] = [
	{ name: "minute", min: 0, max: 59 },
	{ name: "hour", min: 0, max: 23 },
	{ name: "day of month", min: 1, max: 31 },
	{ name: "month", min: 1, max: 12 },
	{ name: "day of week", min: 0, max: 7 },
];

type ValidationResult = { ok: true } | { ok: false; message: string };

export function validateCronExpression(expression: string): ValidationResult {
	const fields = expression.trim().split(/\s+/).filter(Boolean);
	if (fields.length !== 5) {
		return { ok: false, message: "Cron expression must have 5 fields" };
	}

	for (let i = 0; i < fields.length; i += 1) {
		const field = fields[i];
		const config = CRON_FIELDS[i];
		if (!field || !config) continue;
		const error = validateCronField(field, config);
		if (error) return { ok: false, message: error };
	}

	return { ok: true };
}

export function matchesCronExpression(expression: string, date: Date) {
	if (!validateCronExpression(expression).ok) return false;

	const [minute, hour, dayOfMonth, month, dayOfWeek] = expression
		.trim()
		.split(/\s+/) as [string, string, string, string, string];

	return (
		matchesCronField(minute, date.getMinutes(), 0, 59) &&
		matchesCronField(hour, date.getHours(), 0, 23) &&
		matchesCronField(dayOfMonth, date.getDate(), 1, 31) &&
		matchesCronField(month, date.getMonth() + 1, 1, 12) &&
		matchesCronField(dayOfWeek, date.getDay(), 0, 7)
	);
}

function validateCronField(field: string, config: CronField) {
	if (!field) return `${config.name} field is empty`;
	for (const part of field.split(",")) {
		if (!part) return `${config.name} field has an empty list item`;
		if (!getCronBounds(part, config.min, config.max)) {
			return `${config.name} field has invalid value "${part}"`;
		}
	}
	return null;
}

function matchesCronField(
	field: string,
	value: number,
	min: number,
	max: number,
) {
	return field.split(",").some((part) => {
		if (matchesCronPart(part, value, min, max)) return true;
		return max === 7 && value === 0 && matchesCronPart(part, 7, min, max);
	});
}

function matchesCronPart(
	part: string,
	value: number,
	min: number,
	max: number,
) {
	const parsed = getCronBounds(part, min, max);
	if (!parsed) return false;
	const { start, end, step } = parsed;
	return value >= start && value <= end && (value - start) % step === 0;
}

function getCronBounds(part: string, min: number, max: number) {
	const [range, stepRaw] = part.split("/");
	if (!range || part.split("/").length > 2) return null;

	const step = stepRaw ? Number(stepRaw) : 1;
	if (!Number.isInteger(step) || step < 1) return null;

	if (range === "*") return { start: min, end: max, step };

	if (range.includes("-")) {
		const [startRaw, endRaw] = range.split("-");
		if (!startRaw || !endRaw || range.split("-").length > 2) return null;
		const start = Number(startRaw);
		const end = Number(endRaw);
		if (!isCronNumber(start, min, max) || !isCronNumber(end, min, max)) {
			return null;
		}
		if (start > end) return null;
		return { start, end, step };
	}

	const exact = Number(range);
	if (!isCronNumber(exact, min, max)) return null;
	return { start: exact, end: exact, step };
}

function isCronNumber(value: number, min: number, max: number) {
	return Number.isInteger(value) && value >= min && value <= max;
}
