/**
 * FILE: apps/admin/src/lib/fixVerification.ts
 * PURPOSE: Load and re-check the merge gates of a fix's current PR head
 *          (Plan 024, ADR 0035). The verification rides on
 *          GET /v1/admin/fixes/:id/timeline as `data.verification`; a server
 *          without it there answers GET /v1/admin/fixes/:id/verification.
 *          No verification (404 or null) is "Not checked yet", not an error.
 */

import { apiFetch } from './supabase'
import type { ApiResult } from './apiEnvelope'
import type { FixVerification } from './verifyTypes'
import { normalizeVerification } from './verifyView'

export type VerificationLoad = { ok: true; verification: FixVerification | null } | { ok: false; error: string }

export type VerificationRecheck =
  | { ok: true; verification: FixVerification | null }
  | { ok: false; error: string; rateLimited: boolean }

function isNotFound(res: ApiResult<unknown>): boolean {
  const code = res.error?.code ?? ''
  return /NOT_FOUND/i.test(code) || /^404\b/.test(res.error?.message ?? '')
}

function isRateLimited(res: ApiResult<unknown>): boolean {
  const code = res.error?.code ?? ''
  return /RATE_LIMIT|TOO_MANY/i.test(code) || /^429\b/.test(res.error?.message ?? '')
}

async function fetchVerificationRoute(fixId: string): Promise<VerificationLoad> {
  const res = await apiFetch<unknown>(`/v1/admin/fixes/${encodeURIComponent(fixId)}/verification`, {
    cache: 'no-store',
  })
  if (res?.ok) return { ok: true, verification: normalizeVerification(res.data) }
  if (res && isNotFound(res)) return { ok: true, verification: null }
  return { ok: false, error: res?.error?.message ?? 'Could not load the merge checks' }
}

export async function fetchFixVerification(fixId: string): Promise<VerificationLoad> {
  // Same request the review and the fix detail make: apiFetch shares it.
  const timeline = await apiFetch<{ verification?: unknown }>(`/v1/admin/fixes/${encodeURIComponent(fixId)}/timeline`)
  if (timeline?.ok && timeline.data && 'verification' in timeline.data) {
    return { ok: true, verification: normalizeVerification(timeline.data.verification) }
  }
  return fetchVerificationRoute(fixId)
}

/** POST /v1/admin/fixes/:id/verify (6 an hour per fix), then the fresh result. */
export async function recheckFixVerification(fixId: string): Promise<VerificationRecheck> {
  const res = await apiFetch<unknown>(`/v1/admin/fixes/${encodeURIComponent(fixId)}/verify`, {
    method: 'POST',
  })
  if (!res.ok) {
    if (isRateLimited(res)) {
      return {
        ok: false,
        rateLimited: true,
        error:
          'Mushi already re-checked this fix 6 times in the last hour. It checks again on its own every 10 minutes.',
      }
    }
    return {
      ok: false,
      rateLimited: false,
      error: res.error?.message ?? 'Could not re-check this fix',
    }
  }
  const fresh = normalizeVerification(res.data)
  if (fresh) return { ok: true, verification: fresh }
  const load = await fetchVerificationRoute(fixId)
  return load.ok ? load : { ...load, rateLimited: false }
}
