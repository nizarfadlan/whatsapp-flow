import { redactSensitiveValue } from "../security/redaction";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

function writeLog(level: LogLevel, event: string, fields: LogFields = {}) {
	const entry = redactSensitiveValue({
		timestamp: new Date().toISOString(),
		level,
		event,
		...fields,
	});
	const line = JSON.stringify(entry);

	if (level === "error") {
		console.error(line);
		return;
	}
	if (level === "warn") {
		console.warn(line);
		return;
	}
	console.log(line);
}

export const logger = {
	debug: (event: string, fields?: LogFields) =>
		writeLog("debug", event, fields),
	info: (event: string, fields?: LogFields) => writeLog("info", event, fields),
	warn: (event: string, fields?: LogFields) => writeLog("warn", event, fields),
	error: (event: string, fields?: LogFields) =>
		writeLog("error", event, fields),
};
