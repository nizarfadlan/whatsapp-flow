import { decryptSecret, encryptSecret } from "@whatsapp-flow/auth/crypto";
import { flowNodeSecret } from "@whatsapp-flow/db/schema/device";
import { and, eq } from "drizzle-orm";

export const WEBHOOK_AUTH_SECRET_KEY = "webhook_auth";

type Db = ReturnType<typeof import("@whatsapp-flow/db").createDb>;

export async function upsertFlowNodeSecret(
	db: Db,
	input: { flowId: string; nodeId: string; key: string; value: string },
) {
	const encryptedValue = encryptSecret(input.value);
	await db
		.insert(flowNodeSecret)
		.values({
			id: crypto.randomUUID(),
			flowId: input.flowId,
			nodeId: input.nodeId,
			key: input.key,
			encryptedValue,
		})
		.onConflictDoUpdate({
			target: [
				flowNodeSecret.flowId,
				flowNodeSecret.nodeId,
				flowNodeSecret.key,
			],
			set: { encryptedValue, updatedAt: new Date() },
		});
}

export async function getFlowNodeSecret(
	db: Db,
	input: { flowId: string; nodeId: string; key: string },
) {
	const [row] = await db
		.select({ encryptedValue: flowNodeSecret.encryptedValue })
		.from(flowNodeSecret)
		.where(
			and(
				eq(flowNodeSecret.flowId, input.flowId),
				eq(flowNodeSecret.nodeId, input.nodeId),
				eq(flowNodeSecret.key, input.key),
			),
		)
		.limit(1);

	return row ? decryptSecret(row.encryptedValue) : null;
}

export async function hasFlowNodeSecret(
	db: Db,
	input: { flowId: string; nodeId: string; key: string },
) {
	const [row] = await db
		.select({ id: flowNodeSecret.id })
		.from(flowNodeSecret)
		.where(
			and(
				eq(flowNodeSecret.flowId, input.flowId),
				eq(flowNodeSecret.nodeId, input.nodeId),
				eq(flowNodeSecret.key, input.key),
			),
		)
		.limit(1);

	return Boolean(row);
}

export async function deleteFlowNodeSecret(
	db: Db,
	input: { flowId: string; nodeId: string; key: string },
) {
	await db
		.delete(flowNodeSecret)
		.where(
			and(
				eq(flowNodeSecret.flowId, input.flowId),
				eq(flowNodeSecret.nodeId, input.nodeId),
				eq(flowNodeSecret.key, input.key),
			),
		);
}

export async function deleteFlowNodeSecretsForMissingNodes(
	db: Db,
	flowId: string,
	nodeIds: Set<string>,
) {
	const rows = await db
		.select({ nodeId: flowNodeSecret.nodeId, key: flowNodeSecret.key })
		.from(flowNodeSecret)
		.where(eq(flowNodeSecret.flowId, flowId));

	for (const row of rows) {
		if (nodeIds.has(row.nodeId)) continue;
		await deleteFlowNodeSecret(db, {
			flowId,
			nodeId: row.nodeId,
			key: row.key,
		});
	}
}
