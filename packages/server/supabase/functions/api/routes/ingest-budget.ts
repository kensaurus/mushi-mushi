/**
 * FILE: packages/server/supabase/functions/api/routes/ingest-budget.ts
 * PURPOSE: Per-project and per-client-IP rate budgets for the public SDK
 *          ingest routes (/v1/sdk/events, /v1/sdk/session).
 *
 * A public SDK key is in every visitor's browser, so a per-project budget
 * alone lets one host spend a whole project's allowance. Each request claims
 * one unit from the project budget and one from its client IP's budget. The IP
 * is only ever stored as a derived UUID (scoped_rate_limits.user_id).
 */

import type { getServiceClient } from '../../_shared/db.ts'
import { classifyIngestRateLimitError } from './ingest-rate-limit.ts'

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

/** Deterministic UUID-shaped actor id for a client IP (the raw IP is never stored). */
export async function ipActorId(ip: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ingest-ip:${ip}`)))
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Claim one unit from the project's and the client IP's budget. Returns
 * 'ok', or 'limited' when either is spent or the claim itself failed (fail
 * closed: ingest needs the same database for its real work).
 */
export async function claimIngestBudget(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  ip: string | null,
  budget: IngestBudget,
  onFailClosed?: (scope: string, message: string | undefined) => void,
): Promise<'ok' | 'limited'> {
  const claims: Array<{ actor: string; scope: string; max: number }> = [
    { actor: projectId, scope: budget.scope, max: budget.perProjectPerMinute },
  ]
  if (ip) claims.push({ actor: await ipActorId(ip), scope: `${budget.scope}_ip`, max: budget.perIpPerMinute })
  for (const claim of claims) {
    const { error } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: claim.actor,
      p_scope: claim.scope,
      p_max_per_window: claim.max,
      p_window: '1 minute',
    })
    const outcome = classifyIngestRateLimitError(error)
    if (outcome === 'fail-closed') onFailClosed?.(claim.scope, error?.message)
    if (outcome === 'breach' || outcome === 'fail-closed') return 'limited'
  }
  return 'ok'
}
