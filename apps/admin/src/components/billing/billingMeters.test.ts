/**
 * Team → Billing meters. Report 1c802df2: "Fixes · period 4/0" (succeeded of
 * attempted) because local fixes are counted when merged but never when
 * attempted. Fixes are now a plain merged count; no meter ever shows a
 * numerator above its denominator.
 */

import { describe, expect, it } from 'vitest'
import { billingMeters, fixesMeter, planLine, resetsIn } from './billingMeters'
import { EMPTY_BILLING_STATS, type BillingStats } from './types'

const NOW = Date.parse('2026-10-27T00:00:00Z')
const PERIOD_END = '2026-11-01T00:00:00Z'

function stats(over: Partial<BillingStats> = {}): BillingStats {
  return { ...EMPTY_BILLING_STATS, planDisplayName: 'Pro', periodEnd: PERIOD_END, ...over }
}

describe('fixesMeter (1c802df2)', () => {
  it('shows merged fixes as a count, never "4/0"', () => {
    const m = fixesMeter({ fixesSucceeded: 4, fixesAttempted: 0 })
    expect(m.value).toBe('4')
    expect(m.value).not.toContain('/')
    expect(m.pct).toBeNull()
    expect(m.detail).toBe('Fix PRs from Mushi merged this period, from any agent')
  })

  it("names the server agent's runs only when there are some", () => {
    expect(fixesMeter({ fixesSucceeded: 1, fixesAttempted: 3 }).detail).toBe("3 started by Mushi's server agent this period")
  })
})

describe('billingMeters', () => {
  it('a diagnoses meter with its bar, seats, fixes and charges', () => {
    const meters = billingMeters(
      stats({ diagnosesUsed: 47, diagnosesLimit: 2000, diagnosesUsagePct: 2, isComplimentary: true, fixesSucceeded: 4 }),
      { used: 2, limit: 5 },
      NOW,
    )
    expect(meters.map((m) => m.id)).toEqual(['diagnoses', 'seats', 'fixes', 'spend'])
    expect(meters[0]).toMatchObject({ value: '47 / 2,000', pct: 2, tone: 'ok', detail: '2% used · resets in 5 days' })
    expect(meters[1]).toMatchObject({ value: '2 / 5', pct: 40, detail: '3 left' })
    expect(meters[3]).toMatchObject({ label: 'Charges', value: 'None' })
  })

  it('warns near a limit and flags one that is over', () => {
    expect(billingMeters(stats({ diagnosesUsed: 1700, diagnosesLimit: 2000, diagnosesUsagePct: 85 }), null, NOW)[0].tone).toBe('warn')
    expect(billingMeters(stats({ reportsUsed: 1200, reportsLimit: 1000, overQuota: true }), null, NOW)[0]).toMatchObject({ tone: 'danger', pct: 100 })
  })

  it('no meter shows more used than its limit allows on the bar', () => {
    for (const m of billingMeters(stats({ reportsUsed: 5000, reportsLimit: 1000 }), { used: 9, limit: 5 }, NOW)) {
      if (m.pct != null) expect(m.pct).toBeLessThanOrEqual(100)
    }
  })

  it('a paid plan without a cap says to set one', () => {
    const spend = billingMeters(stats(), null, NOW).find((m) => m.id === 'spend')!
    expect(spend).toMatchObject({ value: 'Not set' })
  })
})

describe('planLine and resetsIn', () => {
  it('says what the plan costs in plain words', () => {
    expect(planLine(stats({ isComplimentary: true }), NOW)).toBe('Pro · admin account, no charges')
    expect(planLine(stats({ subscriptionStatus: 'active' }), NOW)).toBe('Pro · usage resets in 5 days')
    expect(planLine(stats({ subscriptionStatus: 'past_due' }), NOW)).toBe('Pro · payment needs attention (past due)')
  })

  it('handles a missing or past period end', () => {
    expect(resetsIn(null, NOW)).toBeNull()
    expect(resetsIn('2026-10-26T00:00:00Z', NOW)).toBe('resets today')
  })
})
