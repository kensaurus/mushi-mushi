/**
 * FILE: diagnosis-quota-count.test.ts
 * PURPOSE: Guard the async `checkDiagnosisQuota` count path and its fail-closed
 *          behaviour on a DB error.
 *
 * OVERVIEW:
 * Complements `diagnosis-quota.test.ts` (which covers the pure
 * `decideDiagnosisQuota` decision). The launch gate requires that *counting*
 * works — not just that the cap math fires — and that a transient count failure
 * never fails open into uncapped LLM spend.
 *
 * Covers:
 *   - the usage count is actually read and drives the verdict (under cap → allow,
 *     over cap → SPEND_CAP_REACHED)
 *   - a count error fails CLOSED with reason QUOTA_CHECK_UNAVAILABLE
 *   - the fail-closed verdict is NOT cached (a later healthy call recovers)
 *
 * DEPENDENCIES: vitest; mocks _shared/db.ts, _shared/logger.ts, _shared/plans.ts.
 * NOTES: each test uses a unique projectId so the success cache in quota.ts does
 *        not leak between cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({}),
}))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

// INDIE-equivalent plan: 500 included, $0.03/overage, $50 cap.
const TEST_PLAN = {
  id: 'indie',
  display_name: 'Indie',
  position: 11,
  monthly_price_usd: 15,
  base_price_lookup_key: 'mushi:indie:base:v1',
  overage_price_lookup_key: 'mushi:diagnoses:overage:indie:v1',
  included_reports_per_month: null,
  overage_unit_amount_decimal: null,
  included_diagnoses_per_month: 500,
  overage_unit_amount_decimal_diagnoses: 0.03,
  monthly_spend_cap_usd: 50,
  retention_days: 30,
  seat_limit: 1,
  is_self_serve: true,
  active: true,
  feature_flags: {},
}

vi.mock('../../supabase/functions/_shared/plans.ts', () => ({
  getPlan: async () => TEST_PLAN,
  resolvePlanFromSubscription: async () => TEST_PLAN,
}))

import {
  checkDiagnosisQuota,
  invalidateDiagnosisCache,
} from '../../supabase/functions/_shared/quota.ts'

/**
 * Minimal chainable Supabase query-builder stub. Every filter method returns the
 * same object; it is both awaitable (resolves to `result`) and exposes
 * `maybeSingle()` (resolves to `result`). That covers both the `.maybeSingle()`
 * subscription/project lookups and the directly-awaited usage-count query.
 */
function makeQuery(result: unknown, shadowResult?: unknown) {
  const q: Record<string, unknown> = {}
  let shadow = false
  for (const m of ['select', 'in', 'order', 'limit', 'not', 'gte', 'lt']) {
    q[m] = () => q
  }
  // `.eq('metadata->>shadow', 'true')` selects the shadow-only count.
  q.eq = (col: string, val: unknown) => {
    if (col === 'metadata->>shadow' && val === 'true') shadow = true
    return q
  }
  q.maybeSingle = async () => result
  q.then = (resolve: (v: unknown) => unknown) => resolve(shadow && shadowResult !== undefined ? shadowResult : result)
  return q
}

function makeDb(opts: {
  sub?: unknown
  project?: unknown
  count: { count: number | null; error: { message: string } | null }
  shadow?: { count: number | null; error: { message: string } | null }
}) {
  return {
    from: (table: string) => {
      if (table === 'billing_subscriptions') return makeQuery({ data: opts.sub ?? null })
      if (table === 'projects') return makeQuery({ data: opts.project ?? null })
      if (table === 'usage_events') return makeQuery(opts.count, opts.shadow ?? { count: 0, error: null })
      return makeQuery({ data: null })
    },
  } as unknown as Parameters<typeof checkDiagnosisQuota>[0]
}

beforeEach(() => invalidateDiagnosisCache())

describe('checkDiagnosisQuota — counting works', () => {
  it('reads the usage count and allows when under the included quota', async () => {
    const db = makeDb({ sub: { status: 'active' }, count: { count: 10, error: null } })
    const v = await checkDiagnosisQuota(db, 'proj-count-under')
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(false)
    expect(v.used).toBe(10)
    expect(v.limit).toBe(500)
  })

  it('lets the count drive the spend cap (over-cap usage → SPEND_CAP_REACHED)', async () => {
    // 2167 used → 1667 overage × $0.03 = $50.01 ≥ $50 cap. A monthly
    // subscription carries the metered overage item (the webhook stores it).
    const db = makeDb({
      sub: { status: 'active', overage_subscription_item_id: 'si_overage' },
      count: { count: 2167, error: null },
    })
    const v = await checkDiagnosisQuota(db, 'proj-count-over-cap')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('SPEND_CAP_REACHED')
    expect(v.used).toBe(2167)
  })

  it('stops an annual subscription (no overage item) at the included quota, resetting monthly', async () => {
    const db = makeDb({
      sub: { status: 'active', overage_subscription_item_id: null, current_period_end: '2027-10-10T00:00:00Z' },
      count: { count: 500, error: null },
    })
    const v = await checkDiagnosisQuota(db, 'proj-count-annual')
    expect(v.allowed).toBe(false)
    expect(v.overage).toBe(false)
    expect(v.reason).toBe('OVER_INCLUDED_NO_OVERAGE')
    // The included quota resets with the calendar month, not the yearly renewal.
    expect(v.periodResetsAt).not.toBe('2027-10-10T00:00:00Z')
    expect(Date.parse(v.periodResetsAt) - Date.now()).toBeLessThanOrEqual(32 * 86_400_000)
  })
})

describe('checkDiagnosisQuota — fail closed on count error (spend safety)', () => {
  it('denies with QUOTA_CHECK_UNAVAILABLE instead of failing open', async () => {
    const db = makeDb({
      sub: { status: 'active' },
      count: { count: null, error: { message: 'connection reset' } },
    })
    const v = await checkDiagnosisQuota(db, 'proj-count-error')
    // The old bug returned allowed:true here → uncapped spend.
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('QUOTA_CHECK_UNAVAILABLE')
  })

  it('does NOT cache the fail-closed verdict — a later healthy call recovers', async () => {
    const projectId = 'proj-count-recover'
    const erroringDb = makeDb({
      sub: { status: 'active' },
      count: { count: null, error: { message: 'transient blip' } },
    })
    const first = await checkDiagnosisQuota(erroringDb, projectId)
    expect(first.allowed).toBe(false)
    expect(first.reason).toBe('QUOTA_CHECK_UNAVAILABLE')

    // Same project, DB now healthy: must re-read (no negative caching) and allow.
    const healthyDb = makeDb({ sub: { status: 'active' }, count: { count: 3, error: null } })
    const second = await checkDiagnosisQuota(healthyDb, projectId)
    expect(second.allowed).toBe(true)
    expect(second.used).toBe(3)
  })
})

describe('checkDiagnosisQuota — what counts as a real diagnosis', () => {
  it('counts rows with no shadow key and subtracts only shadow:true rows', async () => {
    // Prod 2026-10-04: 116 diagnoses, none with a shadow key. The old
    // `not.eq.true` filter counted 0 of them, so no quota or cap applied.
    const db = makeDb({ sub: { status: 'active' }, count: { count: 116, error: null }, shadow: { count: 6, error: null } })
    const v = await checkDiagnosisQuota(db, 'proj-count-shadow')
    expect(v.used).toBe(110)
  })

  it('fails closed when only the shadow count errors', async () => {
    const db = makeDb({
      sub: { status: 'active' },
      count: { count: 10, error: null },
      shadow: { count: null, error: { message: 'timeout' } },
    })
    const v = await checkDiagnosisQuota(db, 'proj-count-shadow-error')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('QUOTA_CHECK_UNAVAILABLE')
  })
})
