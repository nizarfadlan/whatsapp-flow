const sensitiveKeyPattern =
	/(password|secret|token|accessToken|refreshToken|idToken|clientSecret|clientSecretEncrypted|appSecret|encryptedValue|sessionData|creds|keys|authorization|cookie|apiKey|privateKey)/i;

export function redactSensitiveValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactSensitiveValue);
	if (!value || typeof value !== "object") return value;
	if (value instanceof Date) return value.toISOString();

	const output: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		output[key] = sensitiveKeyPattern.test(key)
			? "[REDACTED]"
			: redactSensitiveValue(item);
	}
	return output;
}
