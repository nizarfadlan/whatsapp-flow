import { decryptSecret, encryptSecret } from "@whatsapp-flow/auth/crypto";
import { db } from "@whatsapp-flow/db";
import { deviceProviderSecret } from "@whatsapp-flow/db/schema/device";
import { and, eq } from "drizzle-orm";
import type { WhatsAppProvider } from "./providers/types";

export async function upsertProviderSecret(input: {
	deviceId: string;
	provider: WhatsAppProvider;
	key: string;
	value: string;
}) {
	const encryptedValue = encryptSecret(input.value);
	await db
		.insert(deviceProviderSecret)
		.values({
			id: crypto.randomUUID(),
			deviceId: input.deviceId,
			provider: input.provider,
			key: input.key,
			encryptedValue,
		})
		.onConflictDoUpdate({
			target: [deviceProviderSecret.deviceId, deviceProviderSecret.key],
			set: { encryptedValue, updatedAt: new Date() },
		});
}

export async function getProviderSecret(deviceId: string, key: string) {
	const [row] = await db
		.select({ encryptedValue: deviceProviderSecret.encryptedValue })
		.from(deviceProviderSecret)
		.where(
			and(
				eq(deviceProviderSecret.deviceId, deviceId),
				eq(deviceProviderSecret.key, key),
			),
		)
		.limit(1);

	return row ? decryptSecret(row.encryptedValue) : null;
}

export async function deleteProviderSecrets(deviceId: string) {
	await db
		.delete(deviceProviderSecret)
		.where(eq(deviceProviderSecret.deviceId, deviceId));
}

export async function getProviderSecretSummary(deviceId: string) {
	const rows = await db
		.select({ key: deviceProviderSecret.key })
		.from(deviceProviderSecret)
		.where(eq(deviceProviderSecret.deviceId, deviceId));

	return new Set(rows.map((row) => row.key));
}
