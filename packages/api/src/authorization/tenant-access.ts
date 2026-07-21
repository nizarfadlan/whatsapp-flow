import { TRPCError } from "@trpc/server";
import {
	device,
	deviceAccessGrant,
	flow,
	flowAccessGrant,
} from "@whatsapp-flow/db/schema/device";
import { tenantMember } from "@whatsapp-flow/db/schema/tenant";
import { and, eq, or } from "drizzle-orm";

type Database = ReturnType<typeof import("@whatsapp-flow/db").createDb>;

export type FlowAccessCapability = "owner" | "editor" | "viewer";
type RequiredFlowAccess = Exclude<FlowAccessCapability, "owner">;

function canAccessFlow(
	capability: FlowAccessCapability,
	required: RequiredFlowAccess,
) {
	if (capability === "owner" || capability === "editor") return true;
	return required === "viewer";
}

export async function requireTenantMembership(
	db: Database,
	tenantId: string,
	userId: string,
) {
	const rows = await db
		.select()
		.from(tenantMember)
		.where(
			and(eq(tenantMember.tenantId, tenantId), eq(tenantMember.userId, userId)),
		)
		.limit(1);

	const membership = rows[0];
	if (!membership) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
	}

	return membership;
}

export async function getFlowAccess(
	db: Database,
	flowId: string,
	userId: string,
) {
	const rows = await db
		.select({ flow, grantCapability: flowAccessGrant.capability })
		.from(flow)
		.innerJoin(
			tenantMember,
			and(
				eq(tenantMember.tenantId, flow.tenantId),
				eq(tenantMember.userId, userId),
			),
		)
		.leftJoin(
			flowAccessGrant,
			and(
				eq(flowAccessGrant.flowId, flow.id),
				eq(flowAccessGrant.tenantId, flow.tenantId),
				eq(flowAccessGrant.userId, userId),
			),
		)
		.where(
			and(
				eq(flow.id, flowId),
				or(eq(flow.userId, userId), eq(flowAccessGrant.userId, userId)),
			),
		)
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	return {
		flow: row.flow,
		capability: (row.flow.userId === userId
			? "owner"
			: row.grantCapability) as FlowAccessCapability,
	};
}

export async function requireFlowAccess(
	db: Database,
	flowId: string,
	userId: string,
	required: RequiredFlowAccess,
) {
	const access = await getFlowAccess(db, flowId, userId);
	if (!access || !canAccessFlow(access.capability, required)) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
	}

	return access;
}

export async function requireFlowOwner(
	db: Database,
	flowId: string,
	userId: string,
) {
	const access = await requireFlowAccess(db, flowId, userId, "editor");
	if (access.capability !== "owner") {
		throw new TRPCError({ code: "NOT_FOUND", message: "Flow not found" });
	}

	return access.flow;
}

export async function requireDeviceDeployAccess(
	db: Database,
	deviceId: string,
	userId: string,
) {
	const rows = await db
		.select({
			id: device.id,
			tenantId: device.tenantId,
			provider: device.provider,
			status: device.status,
		})
		.from(device)
		.innerJoin(
			tenantMember,
			and(
				eq(tenantMember.tenantId, device.tenantId),
				eq(tenantMember.userId, userId),
			),
		)
		.leftJoin(
			deviceAccessGrant,
			and(
				eq(deviceAccessGrant.deviceId, device.id),
				eq(deviceAccessGrant.tenantId, device.tenantId),
				eq(deviceAccessGrant.userId, userId),
			),
		)
		.where(
			and(
				eq(device.id, deviceId),
				or(eq(device.userId, userId), eq(deviceAccessGrant.userId, userId)),
			),
		)
		.limit(1);

	const target = rows[0];
	if (!target) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
	}

	return target;
}
