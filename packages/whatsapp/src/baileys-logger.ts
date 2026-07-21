import { env } from "@whatsapp-flow/env/server";

type BaileysLogLevel = "silent" | "error" | "warn" | "info" | "debug";
type DiagnosticFields = Record<
	string,
	boolean | number | string | null | undefined
>;

const logPriorities: Record<BaileysLogLevel, number> = {
	silent: Number.POSITIVE_INFINITY,
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

function shouldLog(level: Exclude<BaileysLogLevel, "silent">) {
	return logPriorities[level] <= logPriorities[env.BAILEYS_LOG_LEVEL];
}

function writeDiagnostic(
	level: Exclude<BaileysLogLevel, "silent">,
	event: string,
	fields: DiagnosticFields,
) {
	if (!shouldLog(level)) return;

	const line = JSON.stringify({
		timestamp: new Date().toISOString(),
		level,
		event,
		...fields,
	});
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

class SanitizedBaileysLogger {
	readonly level = env.BAILEYS_LOG_LEVEL;

	constructor(private readonly bindings: DiagnosticFields) {}

	child(_bindings: Record<string, unknown>) {
		return new SanitizedBaileysLogger(this.bindings);
	}

	trace(_obj: unknown, _message?: string) {
		writeDiagnostic("debug", "baileys.library.trace", this.bindings);
	}

	debug(_obj: unknown, _message?: string) {
		writeDiagnostic("debug", "baileys.library.debug", this.bindings);
	}

	info(_obj: unknown, _message?: string) {
		writeDiagnostic("info", "baileys.library.info", this.bindings);
	}

	warn(_obj: unknown, _message?: string) {
		writeDiagnostic("warn", "baileys.library.warn", this.bindings);
	}

	error(_obj: unknown, _message?: string) {
		writeDiagnostic("error", "baileys.library.error", this.bindings);
	}
}

export function createBaileysLogger(bindings: DiagnosticFields) {
	return new SanitizedBaileysLogger(bindings);
}

export function logBaileysDiagnostic(
	level: Exclude<BaileysLogLevel, "silent">,
	event: string,
	fields: DiagnosticFields,
) {
	writeDiagnostic(level, event, fields);
}
