/**
 * Pure ID format validators for API route params.
 * Kept free of Hono imports so vitest can pin contracts without Deno.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC 4122 UUID (version nibble 1–5, variant 8/9/a/b). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
