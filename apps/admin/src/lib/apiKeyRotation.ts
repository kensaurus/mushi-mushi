/**
 * FILE: apps/admin/src/lib/apiKeyRotation.ts
 * PURPOSE: Rotate ONE project API key (suspected-bugs entry 27). The console
 *          always names the key, so the server revokes only that one and the
 *          new key keeps its label and scopes. One wording for every place
 *          that rotates, so the warning never differs between screens.
 */

import { apiFetch } from './supabase'
import type { ApiResult } from './apiEnvelope'

export interface RotatedKey {
  key: string
  prefix: string
  label?: string | null
  scopes?: string[] | null
  revoked?: number
  revoked_prefixes?: string[]
}

/** The SDK install card only rotates bug-widget keys: their secret goes into a browser snippet. */
export function isSdkIngestKey(scopes: readonly string[] | null | undefined): boolean {
  return Array.isArray(scopes) && scopes.length === 1 && scopes[0] === 'report:write'
}

export const ROTATE_KEY_TITLE = 'Rotate this API key?'

/** What the confirm dialog says will happen. */
export function rotateKeyWarning(keyPrefix: string): string {
  return (
    `The key starting with ${keyPrefix}… is revoked right away, with no undo. ` +
    'Any live app still using it stops sending bug reports until you deploy the new key. ' +
    'Mushi shows the new key once, with the same access as the old one.'
  )
}

export function rotateProjectKey(projectId: string, keyPrefix: string): Promise<ApiResult<RotatedKey>> {
  return apiFetch<RotatedKey>(`/v1/admin/projects/${encodeURIComponent(projectId)}/keys/rotate`, {
    method: 'POST',
    body: JSON.stringify({ key_prefix: keyPrefix }),
  })
}
