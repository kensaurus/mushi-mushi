/**
 * FILE: packages/server/supabase/functions/api/routes/ingest-budget.ts
 * PURPOSE: Per-project and per-client-IP rate budgets for the public SDK
 *          ingest routes (/v1/sdk/events, /v1/sdk/session).
 *
 * A public SDK key is in every visitor's browser, so a per-project budget
 * alone lets one host spend a whole project's allowance. Each request claims
 * one unit from the project budget and one from its client IP's budget. The IP
 * is only ever stored as a derived UUID (scoped_rate_limits.user_id), and the
 * UUID mixes in the project id so one shared NAT is not a single global row.
 *
 * A cap breach (P0001) or a database error rejects the request. A lock or
 * statement timeout on the counter does not: the row was contended, which is
 * not the same as the cap being spent, and session ingest is best-effort.
 */

import type { getServiceClient } from '../../_shared/db.ts'
import { classifyIngestRateLimitError, isScopedRateLimitContention } from './ingest-rate-limit.ts'

export interface IngestBudget {
  /** scoped_rate_limits scope for the project claim; the IP claim uses `${scope}_ip`. */
  scope: string
  perProjectPerMinute: number
  perIpPerMinute: number
}

/** The caller's IP as the edge sees it; null when unknown. */
export function clientIp(header: (name: string) => string | undefined): string | null {
  return (
    header('cf-connecting-ip') ??
    header('x-real-ip') ??
    header('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  )
}

/**
 * Deterministic UUID-shaped actor id for a client IP (the raw IP is never
 * stored). The project id is part of the hash so visitors of different apps
 * who share a NAT do not take turns on one counter row.
 */
export async function ipActorId(ip: string, projectId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ingest-ip:${projectId}:${ip}`)),
  )
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Claim one unit from the project's and the client IP's budget. Returns
 * 'ok', or 'limited' when either cap is spent or the claim failed for a
 * reason other than counter contention.
 *
 * Lock timeout (55P03 / rate_limit_busy) and statement timeout (57014) mean
 * the counter row was busy, not that the caller went over the cap. Session
 * and product-event ingest still accept the event. A real breach and any
 * other RPC error reject.
 */
export async function claimIngestBudget(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  ip: string | null,
  budget: IngestBudget,
  onFailClosed?: (scope: string, message: string | undefined) => void,
  onContention?: (scope: string, message: string | undefined) => void,
): Promise<'ok' | 'limited'> {
  const claims: Array<{ actor: string; scope: string; max: number }> = [
    { actor: projectId, scope: budget.scope, max: budget.perProjectPerMinute },
  ]
  if (ip) claims.push({ actor: await ipActorId(ip, projectId), scope: `${budget.scope}_ip`, max: budget.perIpPerMinute })
  for (const claim of claims) {
    const { error } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: claim.actor,
      p_scope: claim.scope,
      p_max_per_window: claim.max,
      p_window: '1 minute',
    })
    const outcome = classifyIngestRateLimitError(error)
    if (outcome === 'ok' || outcome === 'fail-open') continue
    if (outcome === 'breach') return 'limited'
    if (isScopedRateLimitContention(error)) {
      onContention?.(claim.scope, error?.message)
      continue
    }
    onFailClosed?.(claim.scope, error?.message)
    return 'limited'
  }
  return 'ok'
}
