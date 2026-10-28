/**
 * ABOUTME: Shared parsing helpers for Beads CLI JSON output.
 * Handles legacy payloads and Beads' optional JSON envelope.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Unwrap bd's { schema_version, data } envelope when it is present.
 *
 * bd uses this envelope for --json output when BD_JSON_ENVELOPE=1 and makes
 * it the default in v2.0, so parsing detects it by shape rather than config.
 */
export function unwrapBeadsEnvelope(parsed: unknown): unknown {
  if (isRecord(parsed) && 'schema_version' in parsed && 'data' in parsed) {
    return parsed.data;
  }
  return parsed;
}

export function parseBeadsJsonArray<T>(stdout: string): T[] {
  const parsed: unknown = JSON.parse(stdout);
  const unwrapped = unwrapBeadsEnvelope(parsed);

  if (Array.isArray(unwrapped)) {
    return unwrapped as T[];
  }

  if (isRecord(unwrapped) && typeof unwrapped.error === 'string') {
    const details = [
      unwrapped.error,
      typeof unwrapped.code === 'string' ? `code: ${unwrapped.code}` : undefined,
      typeof unwrapped.hint === 'string' ? `hint: ${unwrapped.hint}` : undefined,
    ].filter((detail): detail is string => detail !== undefined);
    throw new Error(`Beads JSON error: ${details.join('; ')}`);
  }

  const received = JSON.stringify(unwrapped) ?? String(unwrapped);
  throw new Error(
    `parseBeadsJsonArray expected an array or Beads error object but received: ${received}`
  );
}
