import { describe, expect, test } from "bun:test";
import { DisconnectReason } from "baileys";
import {
	classifyDisconnectReason,
	describeDisconnectOperation,
} from "./disconnect-classification";

describe("classifyDisconnectReason", () => {
	test("retries transient documented disconnects", () => {
		expect(classifyDisconnectReason(DisconnectReason.connectionClosed)).toEqual(
			{
				disposition: "retry",
				reason: "connection_closed",
			},
		);
		expect(classifyDisconnectReason(DisconnectReason.connectionLost)).toEqual({
			disposition: "retry",
			reason: "connection_lost",
		});
		expect(classifyDisconnectReason(DisconnectReason.timedOut)).toEqual({
			disposition: "retry",
			reason: "connection_lost",
		});
		expect(
			classifyDisconnectReason(DisconnectReason.unavailableService),
		).toEqual({ disposition: "retry", reason: "unavailable_service" });
	});

	test("separates restart, terminal, replacement, forbidden, and unknown cases", () => {
		expect(classifyDisconnectReason(DisconnectReason.restartRequired)).toEqual({
			disposition: "restart",
			reason: "restart_required",
		});
		expect(
			classifyDisconnectReason(DisconnectReason.connectionReplaced),
		).toEqual({
			disposition: "replaced",
			reason: "connection_replaced",
		});
		expect(classifyDisconnectReason(DisconnectReason.loggedOut)).toEqual({
			disposition: "terminal",
			reason: "logged_out",
		});
		expect(classifyDisconnectReason(DisconnectReason.badSession)).toEqual({
			disposition: "terminal",
			reason: "bad_session",
		});
		expect(
			classifyDisconnectReason(DisconnectReason.multideviceMismatch),
		).toEqual({
			disposition: "terminal",
			reason: "multidevice_mismatch",
		});
		expect(classifyDisconnectReason(DisconnectReason.forbidden)).toEqual({
			disposition: "forbidden",
			reason: "forbidden",
		});
		expect(classifyDisconnectReason(999)).toEqual({
			disposition: "unknown",
			reason: "unknown",
		});
	});

	test("persists a safe operation context without error payloads", () => {
		expect(
			describeDisconnectOperation(classifyDisconnectReason(503), 503),
		).toBe("connection.update:unavailable_service:503");
	});
});
