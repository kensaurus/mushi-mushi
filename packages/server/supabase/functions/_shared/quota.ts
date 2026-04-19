/**
 * Plan-aware report ingest quota gate.
 *
 * Behavior:
 *  - Free tier (no subscription / canceled): `pricing_plans.hobby.included_reports_per_month`.
 *  - Subscribed (`status='active'|'trialing'|'past_due'`): the plan's
 *    `included_reports_per_month`. NULL = unlimited.
 *  - When usage exceeds the included quota AND the plan has an overage
 *    price → `allowed=true`, `overage=true` (caller logs to usage_events,
 *    aggregator pushes to Stripe Meter).
 *  - When over included quota AND plan has NO overage (hobby, enterprise
 *    without overage SKU) → `allowed=false`, HTTP 402.
 *
 * The check is hot-pathed on every `POST /v1/reports`, so we cache the
 * verdict per project for `CACHE_TTL_MS` to avoid an N+1 against
 * `usage_events`. The cache is invalidated by `invalidateQuotaCache` (called
 * after a successful checkout / plan change).
 */
import { getServiceClient } from './db.ts'
import { log } from './logger.ts'
import { getPlan, resolvePlanFromSubscription, type PricingPlan } from './plans.ts'

const CACHE_TTL_MS = 60_000

interface CacheEntry {
  verdict: QuotaVerdict
  expiresAt: number
}

export interface QuotaVerdict {
  allowed: boolean
  /**
   * `true` when the request is being served against the metered overage
   * plan (i.e. caller MUST log a usage_event for revenue tracking).
   */
  overage: boolean
  reason?: 'OVER_INCLUDED_NO_OVERAGE' | 'NO_SUBSCRIPTION_OVER_FREE'
  used: number
  /** Included quota for the resolved plan. NULL = unlimited. */
  limit: number | null
  plan: { id: string; display_name: string }
  periodResetsAt: string
  retryAfterSeconds: number | null
}

const cache = new Map<string, CacheEntry>()

function periodWindow(): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start, end }
}

export function invalidateQuotaCache(projectId?: string): void {
  if (projectId) cache.delete(projectId)
  else cache.clear()
}

export async function checkIngestQuota(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<QuotaVerdict> {
  const cached = cache.get(projectId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.verdict
  }

  const { start, end } = periodWindow()
  const periodResetsAt = end.toISOString()

  const { data: sub } = await db
    .from('billing_subscriptions')
    .select('status, plan_id, current_period_end')
    .eq('project_id', projectId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  const plan = await resolvePlanFromSubscription(sub)
  const periodResetsActual = sub?.current_period_end ?? periodResetsAt

  // Unlimited plan (e.g. enterprise) → fast path, no usage count needed.
  if (plan.included_reports_per_month === null) {
    return finalize(projectId, {
      allowed: true,
      overage: false,
      used: 0,
      limit: null,
      plan: planRef(plan),
      periodResetsAt: periodResetsActual,
      retryAfterSeconds: null,
    })
  }

  const { count, error } = await db
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('event_name', 'reports_ingested')
    .gte('occurred_at', start.toISOString())
    .lt('occurred_at', end.toISOString())

  if (error) {
    log.warn('Quota usage count failed; allowing ingest', { projectId, err: error.message })
    return finalize(projectId, {
      allowed: true,
      overage: false,
      used: 0,
      limit: plan.included_reports_per_month,
      plan: planRef(plan),
      periodResetsAt: periodResetsActual,
      retryAfterSeconds: null,
    })
  }

  const used = count ?? 0
  return finalize(
    projectId,
    decideQuota({ plan, used, hasSubscription: !!sub, periodResetsAt: periodResetsActual, periodEnd: end }),
  )
}

function planRef(p: PricingPlan): QuotaVerdict['plan'] {
  return { id: p.id, display_name: p.display_name }
}

/**
 * Pure decision: given a resolved plan + current usage, what's the verdict?
 *
 * Extracted so the quota gate can be unit-tested without spinning up Supabase.
 * All side-effecty inputs (DB reads, current time) are gathered by
 * `checkIngestQuota` and passed in as plain values.
 */
export function decideQuota(input: {
  plan: PricingPlan
  used: number
  hasSubscription: boolean
  periodResetsAt: string
  /** End of the included-quota window — used to compute Retry-After. */
  periodEnd: Date
  /** Optional `now` injection so tests can pin retryAfterSeconds. */
  now?: Date
}): QuotaVerdict {
  const { plan, used, hasSubscription, periodResetsAt, periodEnd } = input
  const now = input.now ?? new Date()

  if (plan.included_reports_per_month === null) {
    return {
      allowed: true,
      overage: false,
      used,
      limit: null,
      plan: planRef(plan),
      periodResetsAt,
      retryAfterSeconds: null,
    }
  }

  if (used < plan.included_reports_per_month) {
    return {
      allowed: true,
      overage: false,
      used,
      limit: plan.included_reports_per_month,
      plan: planRef(plan),
      periodResetsAt,
      retryAfterSeconds: null,
    }
  }

  if (plan.overage_price_lookup_key) {
    return {
      allowed: true,
      overage: true,
      used,
      limit: plan.included_reports_per_month,
      plan: planRef(plan),
      periodResetsAt,
      retryAfterSeconds: null,
    }
  }

  return {
    allowed: false,
    overage: false,
    reason: hasSubscription ? 'OVER_INCLUDED_NO_OVERAGE' : 'NO_SUBSCRIPTION_OVER_FREE',
    used,
    limit: plan.included_reports_per_month,
    plan: planRef(plan),
    periodResetsAt,
    retryAfterSeconds: Math.max(1, Math.floor((periodEnd.getTime() - now.getTime()) / 1000)),
  }
}

function finalize(projectId: string, verdict: QuotaVerdict): QuotaVerdict {
  cache.set(projectId, { verdict, expiresAt: Date.now() + CACHE_TTL_MS })
  return verdict
}

/** Test-only helper to force the next checkIngestQuota to refetch the plan. */
export async function _testGetPlan(planId: string): Promise<PricingPlan> {
  return getPlan(planId)
}
