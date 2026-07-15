import { DisconnectReason } from "baileys";

export type DisconnectDisposition =
	| "restart"
	| "retry"
	| "replaced"
	| "terminal"
	| "forbidden"
	| "unknown";

export type DisconnectClassification = {
	disposition: DisconnectDisposition;
	reason: string;
};

export function classifyDisconnectReason(
	statusCode: number | undefined,
): DisconnectClassification {
	switch (statusCode) {
		case DisconnectReason.restartRequired:
			return { disposition: "restart", reason: "restart_required" };
		case DisconnectReason.connectionClosed:
			return { disposition: "retry", reason: "connection_closed" };
		case DisconnectReason.connectionLost:
			return { disposition: "retry", reason: "connection_lost" };
		case DisconnectReason.unavailableService:
			return { disposition: "retry", reason: "unavailable_service" };
		case DisconnectReason.connectionReplaced:
			return { disposition: "replaced", reason: "connection_replaced" };
		case DisconnectReason.loggedOut:
			return { disposition: "terminal", reason: "logged_out" };
		case DisconnectReason.badSession:
			return { disposition: "terminal", reason: "bad_session" };
		case DisconnectReason.multideviceMismatch:
			return { disposition: "terminal", reason: "multidevice_mismatch" };
		case DisconnectReason.forbidden:
			return { disposition: "forbidden", reason: "forbidden" };
		default:
			return { disposition: "unknown", reason: "unknown" };
	}
}

export function describeDisconnectOperation(
	classification: DisconnectClassification,
	statusCode: number | undefined,
) {
	const code = statusCode == null ? "no_status_code" : String(statusCode);
	return `connection.update:${classification.reason}:${code}`;
}
