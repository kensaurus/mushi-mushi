/**
 * Plan-aware report ingest quota gate.
 *
 * Behavior:
 *  - Free tier (no subscription / canceled): `pricing_plans.free_cloud.included_diagnoses_per_month`.
 *  - Subscribed (`status='active'|'trialing'|'past_due'`): the plan's
 *    `included_diagnoses_per_month`. NULL = unlimited.
 *  - When usage exceeds the included quota AND the plan has an overage
 *    price → `allowed=true`, `overage=true` (caller logs to usage_events,
 *    aggregator pushes to Stripe Meter).
 *  - When over included quota AND plan has NO overage (free_cloud, enterprise
 *    without overage SKU) → `allowed=false`, HTTP 402.
 *  - Hard spend cap: when the team's total overage spend this period
 *    exceeds the cap (plan default or per-sub override), `allowed=false`.
 *
 * Plans belong to the team (organization), not to one app: the plan comes
 * from `_shared/org-billing.ts` and usage is counted across every app in the
 * organization, so one Studio subscription gives the whole team 3,000
 * diagnoses a month (VISION.md §2.2).
 *
 * The check is hot-pathed on every `POST /v1/reports`, so we cache the
 * verdict per project for `CACHE_TTL_MS` to avoid an N+1 against
 * `usage_events`. The cache is invalidated by `invalidateQuotaCache` (called
 * after a successful checkout / plan change).
 */
import { getServiceClient } from './db.ts'
import { log } from './logger.ts'
import { getPlan, type PricingPlan } from './plans.ts'
import { diagnosisOverageBillable } from './billing-rules.ts'
import { countOrgUsage, resolveProjectBilling } from './org-billing.ts'

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

/**
 * The plan a project's team bills under (org-billing.ts: complimentary org →
 * its plan; else the org's live subscription; else organizations.plan_id;
 * else Free). Shared by the codebase index cap and the gates below. A read
 * error throws so a caller never mistakes "could not read" for the free plan.
 */
export async function resolveProjectPlan(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<PricingPlan> {
  return (await resolveProjectBilling(db, projectId)).plan
}

/**
 * Report ingest gate. The plan and the count are the team's: every app in
 * the organization shares `included_reports_per_month` (NULL on every plan
 * since the diagnoses meter, so the count is skipped).
 */
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

  let billing: Awaited<ReturnType<typeof resolveProjectBilling>>
  try {
    billing = await resolveProjectBilling(db, projectId, { includeProjectIds: true })
  } catch (err) {
    // Same posture as a failed count below: ingest is never refused because
    // a billing read blipped. Not cached, so the next report re-reads.
    log.warn('Quota plan read failed; allowing ingest', {
      projectId,
      err: err instanceof Error ? err.message : String(err),
    })
    const free = await getPlan('free_cloud')
    return {
      allowed: true,
      overage: false,
      used: 0,
      limit: free.included_reports_per_month,
      plan: planRef(free),
      periodResetsAt,
      retryAfterSeconds: null,
    }
  }
  const { plan, liveSub: sub } = billing
  const periodResetsActual = sub?.current_period_end ?? periodResetsAt

  // Unlimited ingest (every plan today) → no count needed.
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

  const { count: usageCount, error: countErr } = await countOrgUsage(db, billing.projectIds, 'reports_ingested', {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  })

  if (countErr) {
    log.warn('Quota usage count failed; allowing ingest', { projectId, err: countErr.message })
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

  return finalize(
    projectId,
    decideQuota({ plan, used: usageCount, hasSubscription: !!sub, periodResetsAt: periodResetsActual, periodEnd: end }),
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

/**
 * Pure decision: given a resolved plan + current diagnosis usage, what's the verdict?
 *
 * Extracted so the diagnosis quota gate can be unit-tested without Supabase.
 * Side-effecty inputs (DB reads) are gathered by `checkDiagnosisQuota`.
 */
export function decideDiagnosisQuota(input: {
  plan: PricingPlan
  used: number
  hasSubscription: boolean
  spendCapUsd: number | null
  periodResetsAt: string
  /**
   * False when the subscription has no metered overage item (annual plans).
   * Such a project stops at the included quota even though its plan row has
   * an overage rate, because nothing on the subscription could bill it.
   * Defaults to true. See `diagnosisOverageBillable` in billing-rules.ts.
   */
  overageBillable?: boolean
}): DiagnosisQuotaVerdict {
  const { plan, used, hasSubscription, spendCapUsd, periodResetsAt } = input
  const overageBillable = input.overageBillable ?? true

  if (plan.included_diagnoses_per_month === null) {
    return {
      allowed: true,
      overage: false,
      used: 0,
      limit: null,
      spendCapUsd,
      plan: planRef(plan),
      periodResetsAt,
    }
  }

  if (used < plan.included_diagnoses_per_month) {
    return {
      allowed: true,
      overage: false,
      used,
      limit: plan.included_diagnoses_per_month,
      spendCapUsd,
      plan: planRef(plan),
      periodResetsAt,
    }
  }

  if (!plan.overage_unit_amount_decimal_diagnoses || !overageBillable) {
    return {
      allowed: false,
      overage: false,
      reason: hasSubscription ? 'OVER_INCLUDED_NO_OVERAGE' : 'NO_SUBSCRIPTION_OVER_FREE',
      used,
      limit: plan.included_diagnoses_per_month,
      spendCapUsd,
      plan: planRef(plan),
      periodResetsAt,
    }
  }

  if (spendCapUsd !== null) {
    const overageCount = Math.max(0, used - plan.included_diagnoses_per_month)
    const overageSpend = overageCount * plan.overage_unit_amount_decimal_diagnoses
    if (overageSpend >= spendCapUsd) {
      return {
        allowed: false,
        overage: true,
        reason: 'SPEND_CAP_REACHED',
        used,
        limit: plan.included_diagnoses_per_month,
        spendCapUsd,
        plan: planRef(plan),
        periodResetsAt,
      }
    }
  }

  return {
    allowed: true,
    overage: true,
    used,
    limit: plan.included_diagnoses_per_month,
    spendCapUsd,
    plan: planRef(plan),
    periodResetsAt,
  }
}

// ── Diagnosis quota gate ────────────────────────────────────────────────────
//
// Called by classify-report BEFORE the Stage-2 Sonnet invocation.
// Determines whether the project's team may consume a diagnosis this period
// (diagnoses are pooled across the organization's apps). Hard spend caps are
// enforced here so classify-report never calls the LLM when the team is over
// cap. Verdicts are cached per project for 60 s, so a team can overshoot its
// quota by what its other apps diagnose inside that window.

export interface DiagnosisQuotaVerdict {
  allowed: boolean
  overage: boolean
  reason?:
    | 'OVER_INCLUDED_NO_OVERAGE'
    | 'NO_SUBSCRIPTION_OVER_FREE'
    | 'SPEND_CAP_REACHED'
    /**
     * Transient: the usage count could not be read (DB error). The caller MUST
     * treat this as retryable — never as a billing quota_exceeded — and MUST NOT
     * invoke the LLM. Deliberately fails closed so a transient error can never
     * become uncapped spend.
     */
    | 'QUOTA_CHECK_UNAVAILABLE'
  used: number
  /** Included diagnoses quota for the resolved plan. NULL = unlimited. */
  limit: number | null
  /** Active hard spend cap in USD. NULL = uncapped. */
  spendCapUsd: number | null
  plan: { id: string; display_name: string }
  periodResetsAt: string
}

const diagnosisCache = new Map<string, { verdict: DiagnosisQuotaVerdict; expiresAt: number }>()

export function invalidateDiagnosisCache(projectId?: string): void {
  if (projectId) diagnosisCache.delete(projectId)
  else diagnosisCache.clear()
}

/**
 * Check whether a project's team may produce a new diagnosis this billing period.
 *
 * This is the classify-level gate — it counts completed `diagnoses` events
 * (excluding Phase-1 shadow rows) and enforces:
 *  1. Included-quota limits (diagnosis count < plan.included_diagnoses_per_month).
 *  2. Overage-allowed flag (plan.overage_unit_amount_decimal_diagnoses is set AND
 *     the subscription carries the metered overage item; annual plans do not).
 *  3. Hard spend cap (plan default or per-sub override).
 */
export async function checkDiagnosisQuota(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<DiagnosisQuotaVerdict> {
  const cached = diagnosisCache.get(projectId)
  if (cached && cached.expiresAt > Date.now()) return cached.verdict

  const { start, end } = periodWindow()
  const periodResetsAt = end.toISOString()

  // The plan, the subscription and the count are the team's: the plan's
  // diagnoses are shared by every app in the organization (VISION.md §2.2).
  let billing: Awaited<ReturnType<typeof resolveProjectBilling>>
  try {
    billing = await resolveProjectBilling(db, projectId, { includeProjectIds: true })
  } catch (err) {
    // Spend-safety: same fail-closed, uncached, retryable answer as a failed
    // count below. Guessing Free could block a paying team; guessing paid
    // could run uncapped.
    log.error('Diagnosis quota plan read failed; failing closed (retryable)', {
      projectId,
      err: err instanceof Error ? err.message : String(err),
    })
    const free = await getPlan('free_cloud')
    return {
      allowed: false,
      overage: false,
      reason: 'QUOTA_CHECK_UNAVAILABLE',
      used: 0,
      limit: free.included_diagnoses_per_month,
      spendCapUsd: null,
      plan: planRef(free),
      periodResetsAt,
    }
  }
  const { plan, liveSub: sub } = billing

  // Real diagnoses = all − Phase-1 shadow rows (countOrgUsage). A single
  // `.not('metadata->>shadow','eq','true')` dropped every row WITHOUT a
  // shadow key, so the quota and spend cap never applied. Same rule as
  // billing-usage-counts.ts, so the gate and Billing agree.
  const { count: diagCount, error: diagErr } = await countOrgUsage(
    db,
    billing.projectIds,
    'diagnoses',
    { startIso: start.toISOString(), endIso: end.toISOString() },
    { excludeShadow: true },
  )

  // Annual subscriptions (no overage item) stop at the included quota, which
  // resets with the calendar-month window, not at the yearly renewal date.
  const overageBillable = diagnosisOverageBillable(sub)
  const periodResetsActual = overageBillable
    ? sub?.current_period_end ?? periodResetsAt
    : periodResetsAt

  // Effective spend cap: the team's override (on its subscription) wins, then
  // the plan default.
  const spendCapUsd = sub?.monthly_spend_cap_usd_override ?? plan.monthly_spend_cap_usd ?? null

  if (diagErr) {
    // Spend-safety: a transient count error must NOT fail open. Failing open
    // here would let unbounded LLM diagnoses through with the spend cap
    // un-enforced — a single DB blip becomes uncapped spend. Instead we fail
    // CLOSED for this one call and deliberately DO NOT cache the verdict, so the
    // next attempt re-reads the count. The caller treats QUOTA_CHECK_UNAVAILABLE
    // as retryable (never as billing quota_exceeded), so a brief blip neither
    // locks the project out nor bypasses the cap.
    log.error('Diagnosis quota count failed; failing closed (retryable)', {
      projectId,
      err: diagErr.message,
    })
    return {
      allowed: false,
      overage: false,
      reason: 'QUOTA_CHECK_UNAVAILABLE',
      used: 0,
      limit: plan.included_diagnoses_per_month,
      spendCapUsd,
      plan: planRef(plan),
      periodResetsAt: periodResetsActual,
    }
  }

  return finalizeDiagnosis(
    projectId,
    decideDiagnosisQuota({
      plan,
      used: diagCount,
      hasSubscription: !!sub,
      spendCapUsd,
      periodResetsAt: periodResetsActual,
      overageBillable,
    }),
  )
}

function finalizeDiagnosis(
  projectId: string,
  verdict: DiagnosisQuotaVerdict,
): DiagnosisQuotaVerdict {
  diagnosisCache.set(projectId, { verdict, expiresAt: Date.now() + CACHE_TTL_MS })
  return verdict
}
