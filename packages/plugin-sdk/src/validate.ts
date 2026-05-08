/**
 * packages/plugin-sdk/src/validate.ts
 *
 * Lightweight runtime payload validation for Mushi plugins.
 *
 * We intentionally avoid zod (not a dependency of plugin-sdk) and use plain
 * TypeScript type guards. The bundle impact is near-zero and tree-shaking
 * removes whichever helper you don't use.
 *
 * The two exported helpers cover the common plugin I/O boundary pattern:
 * "does this inbound object contain the required top-level keys?" For deeper
 * structural validation, callers should add their own narrowing on top.
 */

/**
 * Asserts that `payload` is a non-null plain object containing every key
 * listed in `required`. Narrows `payload` to `T` on success; throws a
 * descriptive `TypeError` on failure.
 *
 * Intended for early-exit guards in handler/webhook code where a missing
 * required field is a programming error and an exception is appropriate.
 */
export function assertFields<T extends object>(
  payload: unknown,
  required: (keyof T)[],
): asserts payload is T {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError(
      `Expected plain object, received ${
        payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload
      }`,
    )
  }
  for (const key of required) {
    if (!(key as string in (payload as object))) {
      throw new TypeError(`Missing required field: "${String(key)}"`)
    }
  }
}

/**
 * Non-throwing variant of `assertFields`.
 *
 * Returns `{ ok: true, data }` if every required key is present on `payload`,
 * or `{ ok: false, error }` with a descriptive message otherwise. Use this at
 * external I/O boundaries (webhook handlers, API routes) where you want to
 * surface a structured error rather than letting an exception propagate.
 */
export function safeParseInbound<T extends object>(
  payload: unknown,
  required: (keyof T)[],
): { ok: true; data: T } | { ok: false; error: string } {
  try {
    assertFields<T>(payload, required)
    return { ok: true, data: payload }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
