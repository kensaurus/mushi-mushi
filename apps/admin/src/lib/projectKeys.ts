/**
 * FILE: apps/admin/src/lib/projectKeys.ts
 * PURPOSE: Rotate ONE project API key (POST /v1/admin/projects/:id/keys/rotate
 *          with `{ keyId }`) and the confirm copy that lists exactly what
 *          will stop working. "Rotate key" used to revoke every key on the
 *          project with no confirm (QA bug 31).
 */
import { apiFetch } from './supabase'
import { describeActionError } from './actionError'

export interface RotatableKey {
  id: string
  key_prefix: string
  label?: string | null
  scopes?: string[] | null
  last_seen_at?: string | null
}

export interface RotatedKey {
  id: string | null
  key: string
  prefix: string
  scopes: string[]
  label: string | null
  /** The replacement exists but the old key could not be revoked. */
  oldKeyStillActive: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Only a row with a real key id can be rotated (fallback rows carry the prefix as id). */
export function canRotateKey(key: Pick<RotatableKey, 'id'>): boolean {
  return UUID_RE.test(key.id)
}

/** Body and bullet lines for the rotate confirm. */
export function rotateKeyConfirmCopy(key: RotatableKey): {
  title: string
  body: string
  lines: string[]
} {
  const scopes = key.scopes?.length ? key.scopes.join(', ') : 'report:write'
  const lastUsed = key.last_seen_at
    ? `last used ${new Date(key.last_seen_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
    : 'never used by an app yet'
  return {
    title: `Rotate key ${key.key_prefix}…?`,
    body:
      'Mushi creates a replacement with the same access and revokes this key immediately. ' +
      'Every app, CI build or editor still using it stops working (bug reports from a live app stop arriving) ' +
      'until you paste the new key in and redeploy. Your other keys keep working.',
    lines: [
      `Revoked: ${key.key_prefix}…${key.label ? ` (${key.label})` : ''}`,
      `Access: ${scopes}`,
      `Status: ${lastUsed}`,
    ],
  }
}

export async function rotateProjectKey(
  projectId: string,
  keyId: string,
): Promise<{ ok: true; data: RotatedKey } | { ok: false; message: string }> {
  const res = await apiFetch<{
    id?: string | null
    key: string
    prefix: string
    scopes?: string[]
    label?: string | null
    old_key_still_active?: boolean
  }>(`/v1/admin/projects/${projectId}/keys/rotate`, {
    method: 'POST',
    body: JSON.stringify({ keyId }),
    idempotencyKey: crypto.randomUUID(),
  })
  if (!res.ok || !res.data?.key) {
    return { ok: false, message: describeActionError(res.error, 'Could not rotate the key. Try again in a moment.') }
  }
  return {
    ok: true,
    data: {
      id: res.data.id ?? null,
      key: res.data.key,
      prefix: res.data.prefix,
      scopes: res.data.scopes ?? ['report:write'],
      label: res.data.label ?? null,
      oldKeyStillActive: res.data.old_key_still_active === true,
    },
  }
}
