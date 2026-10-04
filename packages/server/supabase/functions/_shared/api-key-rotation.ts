/**
 * FILE: _shared/api-key-rotation.ts
 * PURPOSE: Which key `POST /v1/admin/projects/:id/keys/rotate` replaces.
 *
 * The console names one key (by id, or by its 12-character prefix when the
 * row it shows has no id yet). Only that key is revoked, and its successor
 * keeps the same label and scopes, so rotating an MCP key gives an MCP key
 * and a `ci-auto:*` key keeps the label its dedupe depends on. A request
 * with no key named keeps the old behaviour (revoke every active key), which
 * the CLI and the auth manifest's `rotation_endpoint` rely on.
 *
 * Imported only by api/routes/project-keys.ts.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A stored key prefix (`mushi_` + 6 chars today). Only ever compared, scoped to the project's active keys. */
const PREFIX_RE = /^mushi_[A-Za-z0-9_-]{2,26}$/

export interface RotateTarget {
  keyId?: string
  keyPrefix?: string
}

export interface RotatableKeyRow {
  id: string
  key_prefix: string
  label: string | null
  scopes: string[] | null
}

/**
 * `{ key_id }` or `{ key_prefix }` from the body. `null` means no key was
 * named (rotate every key). A named key that is malformed is an error, never
 * a silent fall-through to rotating everything.
 */
export function parseRotateTarget(body: unknown): RotateTarget | null | { error: string } {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const keyId = typeof b.key_id === 'string' ? b.key_id.trim() : undefined
  const keyPrefix = typeof b.key_prefix === 'string' ? b.key_prefix.trim() : undefined
  if (b.key_id !== undefined && b.key_id !== null && !keyId) return { error: 'key_id must be a key id.' }
  if (b.key_prefix !== undefined && b.key_prefix !== null && !keyPrefix) return { error: 'key_prefix must be a key prefix.' }
  if (!keyId && !keyPrefix) return null
  if (keyId && !UUID_RE.test(keyId)) {
    // Rows minted moments ago carry the prefix as their id.
    if (PREFIX_RE.test(keyId)) return { keyPrefix: keyId }
    return { error: 'That is not a key Mushi recognises. Refresh the key list and pick it again.' }
  }
  if (keyPrefix && !PREFIX_RE.test(keyPrefix)) {
    return { error: 'That is not a key Mushi recognises. Refresh the key list and pick it again.' }
  }
  return keyId ? { keyId } : { keyPrefix }
}

export type RotationPick =
  | { ok: true; row: RotatableKeyRow }
  | { ok: false; code: 'NOT_FOUND' | 'AMBIGUOUS'; message: string; status: 404 | 409 }

/** Exactly one active key, or a plain-English refusal. Never more than one. */
export function pickRotationTarget(activeRows: RotatableKeyRow[], target: RotateTarget): RotationPick {
  const matches = activeRows.filter((r) =>
    target.keyId ? r.id === target.keyId : r.key_prefix === target.keyPrefix,
  )
  if (matches.length === 0) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      status: 404,
      message: 'That key is no longer active, so there is nothing to rotate. Refresh the key list.',
    }
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS',
      status: 409,
      message: `More than one active key starts with ${target.keyPrefix}. Rotate it from Projects, where each key has its own row.`,
    }
  }
  return { ok: true, row: matches[0]! }
}
