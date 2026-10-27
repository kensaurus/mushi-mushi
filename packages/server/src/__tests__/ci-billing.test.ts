/**
 * FILE: ci-billing.test.ts
 * PURPOSE: `_shared/ci-billing.ts`, the real GitHub Actions bill:
 *            - usage items → (day, repo, SKU) rows: Actions only, lowercase
 *              product, timestamps bucketed to the UTC day, bare repo names
 *              given their owner, storage kept in money but not minutes;
 *            - fetchBillingUsage: the user / organization endpoint, 401 / 403
 *              / 404 as `unavailable` with the plain reason, a next page
 *              marked incomplete;
 *            - monthsToSync / nextCoveredFrom: which months to read and how
 *              far back the held bill reaches without a gap;
 *            - buildCiBill: totals, per repo / SKU / day, this month, the
 *              previous period only when fully held, the agent PR share.
 *          Fixtures are synthetic, in the shape GitHub returned on 2026-10-27.
 */

import { describe, expect, it } from 'vitest'
import {
  BILLING_UNAVAILABLE_REASON,
  billingRowsFromUsage,
  buildCiBill,
  fetchBillingUsage,
  isMushiAgentBranch,
  monthsToSync,
  nextCoveredFrom,
  NO_BILL_REASON,
  normalizeBillingRepo,
  type StoredBillRow,
} from '../../supabase/functions/_shared/ci-billing.ts'

const item = (over: Record<string, unknown>) => ({
  date: '2026-10-01T00:00:00Z',
  product: 'actions',
  sku: 'Actions Linux',
  quantity: 10,
  unitType: 'Minutes',
  pricePerUnit: 0.006,
  grossAmount: 0.06,
  discountAmount: 0,
  netAmount: 0.06,
  repositoryName: 'app',
  ...over,
})

describe('billingRowsFromUsage', () => {
  it('keeps Actions only, sums items of one day, repo and SKU, and names repos owner/repo', () => {
    const { rows, skipped, invalid } = billingRowsFromUsage('acme', [
      item({}),
      item({ date: '2026-10-01T13:47:27Z', quantity: 5, grossAmount: 0.03, netAmount: 0.03 }),
      item({ date: '2026-10-02T01:00:00Z' }),
      item({ product: 'Actions', repositoryName: 'docs', grossAmount: 0.5, discountAmount: 0.5, netAmount: 0 }),
      item({ sku: 'Actions storage', unitType: 'GigabyteHours', quantity: 15.09, grossAmount: 0.005, discountAmount: 0.005, netAmount: 0 }),
      item({ product: 'copilot', sku: 'Copilot Premium Request' }),
      item({ date: 'not a date' }),
      null,
    ])
    expect(skipped).toBe(1)
    expect(invalid).toBe(2)
    const day1 = rows.filter((r) => r.day === '2026-10-01' && r.repo === 'acme/app' && r.sku === 'Actions Linux')
    expect(day1).toEqual([{ owner: 'acme', day: '2026-10-01', repo: 'acme/app', sku: 'Actions Linux', unit: 'Minutes', quantity: 15, gross_usd: 0.09, discount_usd: 0, net_usd: 0.09 }])
    expect(rows.find((r) => r.repo === 'acme/docs')).toMatchObject({ gross_usd: 0.5, discount_usd: 0.5, net_usd: 0 })
    expect(rows.find((r) => r.sku === 'Actions storage')).toMatchObject({ unit: 'GigabyteHours', quantity: 15.09 })
    expect(rows.map((r) => r.day)).toEqual([...rows.map((r) => r.day)].sort())
  })

  it('keeps an organization endpoint repo name as it is and refuses malformed ones', () => {
    expect(normalizeBillingRepo('acme', 'acme/app')).toBe('acme/app')
    expect(normalizeBillingRepo('acme', 'other/app')).toBe('other/app')
    expect(normalizeBillingRepo('acme', 'a/b/c')).toBe('')
    expect(normalizeBillingRepo('acme', '')).toBe('')
    expect(normalizeBillingRepo('acme', null)).toBe('')
    expect(normalizeBillingRepo('acme', 'bad name')).toBe('')
  })
})

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers })
  }
  return { calls, impl }
}

describe('fetchBillingUsage', () => {
  it('reads the user endpoint for a person and the organization endpoint for an org', async () => {
    const f = fakeFetch(200, { usageItems: [item({})] })
    const user = await fetchBillingUsage({ token: 't', owner: 'acme', ownerType: 'User', year: 2026, month: 10, fetchImpl: f.impl })
    expect(user).toEqual({ ok: true, items: [item({})], incomplete: false })
    expect(f.calls[0].url).toBe('https://api.github.com/users/acme/settings/billing/usage?year=2026&month=10')
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer t')
    await fetchBillingUsage({ token: 't', owner: 'acme-org', ownerType: 'Organization', year: 2026, month: 9, fetchImpl: f.impl })
    expect(f.calls[1].url).toBe('https://api.github.com/organizations/acme-org/settings/billing/usage?year=2026&month=9')
  })

  it.each([401, 403, 404])('turns %i into unavailable with the plain reason', async (status) => {
    const f = fakeFetch(status, { message: 'nope' })
    const res = await fetchBillingUsage({ token: 't', owner: 'acme', ownerType: 'User', year: 2026, month: 10, fetchImpl: f.impl })
    expect(res).toEqual({ ok: false, unavailable: true, status, reason: BILLING_UNAVAILABLE_REASON })
    expect(BILLING_UNAVAILABLE_REASON).toContain('mushi runner bill --push')
  })

  it('reports other failures as not unavailable, and a next page as incomplete', async () => {
    const err = await fetchBillingUsage({ token: 't', owner: 'acme', ownerType: 'User', year: 2026, month: 10, fetchImpl: fakeFetch(502, {}).impl })
    expect(err).toMatchObject({ ok: false, unavailable: false, status: 502 })
    const odd = await fetchBillingUsage({ token: 't', owner: 'acme', ownerType: 'User', year: 2026, month: 10, fetchImpl: fakeFetch(200, { nope: 1 }).impl })
    expect(odd).toMatchObject({ ok: false, unavailable: false })
    const paged = await fetchBillingUsage({
      token: 't',
      owner: 'acme',
      ownerType: 'User',
      year: 2026,
      month: 10,
      fetchImpl: fakeFetch(200, { usageItems: [] }, { link: '<https://api.github.com/x?page=2>; rel="next"' }).impl,
    })
    expect(paged).toEqual({ ok: true, items: [], incomplete: true })
    const thrown = await fetchBillingUsage({ token: 't', owner: 'acme', ownerType: 'User', year: 2026, month: 10, fetchImpl: async () => { throw new Error('offline') } })
    expect(thrown).toMatchObject({ ok: false, unavailable: false, status: 0 })
  })
})

describe('monthsToSync and nextCoveredFrom', () => {
  it('reads this month and last month, and the older month the comparison needs until it is held', () => {
    const now = new Date('2026-10-27T03:00:00Z')
    expect(monthsToSync(now, null)).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 9 }, { year: 2026, month: 8 }])
    expect(monthsToSync(now, '2026-08-01')).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 9 }])
    // 1 March: 60 days back is 31 December, so December and January are needed.
    expect(monthsToSync(new Date('2027-03-01T00:00:00Z'), null)).toEqual([
      { year: 2027, month: 3 },
      { year: 2027, month: 2 },
      { year: 2027, month: 1 },
      { year: 2026, month: 12 },
    ])
  })

  it('holds the bill from the oldest month of an unbroken chain that reaches today', () => {
    const now = new Date('2026-10-27T03:00:00Z')
    const ok = (month: number) => ({ year: 2026, month, ok: true })
    expect(nextCoveredFrom(null, [ok(10), ok(9), ok(8)], now)).toBe('2026-08-01')
    expect(nextCoveredFrom(null, [ok(10), { year: 2026, month: 9, ok: false }, ok(8)], now)).toBe('2026-10-01')
    expect(nextCoveredFrom('2026-08-01', [{ year: 2026, month: 10, ok: false }, ok(9)], now)).toBe('2026-08-01')
    // The older span counts only when the previous good read fell inside the chain.
    expect(nextCoveredFrom('2026-07-01', [ok(10), ok(9)], now, '2026-09-30T00:00:00Z')).toBe('2026-07-01')
    expect(nextCoveredFrom('2026-07-01', [ok(10), ok(9)], now, '2026-08-15T00:00:00Z')).toBe('2026-09-01')
    // A pushed past month joins the held bill only next to it.
    expect(nextCoveredFrom('2026-10-01', [ok(9)], now)).toBe('2026-09-01')
    expect(nextCoveredFrom('2026-10-01', [ok(7)], now)).toBe('2026-10-01')
    expect(nextCoveredFrom(null, [ok(9)], now)).toBeNull()
  })
})

describe('isMushiAgentBranch', () => {
  it('matches the three agent branch shapes only', () => {
    expect(isMushiAgentBranch('kenji/MUSHI-42-local-cursor')).toBe(true)
    expect(isMushiAgentBranch('cursor/mushi-fix-abc123')).toBe(true)
    expect(isMushiAgentBranch('mushi/train-2026-10-26')).toBe(true)
    expect(isMushiAgentBranch('main')).toBe(false)
    expect(isMushiAgentBranch('feature/mushi')).toBe(false)
    expect(isMushiAgentBranch(null)).toBe(false)
  })
})

describe('buildCiBill', () => {
  const now = new Date('2026-10-27T09:00:00Z')
  const row = (over: Partial<StoredBillRow>): StoredBillRow => ({
    owner: 'acme',
    day: '2026-10-20',
    repo: 'acme/app',
    sku: 'Actions Linux',
    unit: 'Minutes',
    quantity: 100,
    gross_usd: 0.6,
    discount_usd: 0,
    net_usd: 0.6,
    source: 'api',
    ...over,
  })
  const sync = (over: Record<string, unknown> = {}) => ({
    owner: 'acme',
    owner_type: 'User',
    last_ok_at: '2026-10-27T02:00:00Z',
    last_attempt_at: '2026-10-27T02:00:00Z',
    last_error: null,
    last_source: 'api',
    covered_from: '2026-08-01',
    ...over,
  })

  it('totals the window per repo, SKU and day, this month, and the change against a fully held previous period', () => {
    const bill = buildCiBill({
      now,
      days: 30,
      rows: [
        row({}),
        row({ day: '2026-10-27', repo: 'acme/docs', quantity: 50, gross_usd: 0.3, net_usd: 0.3 }),
        row({ day: '2026-10-21', repo: 'acme/site', gross_usd: 1, discount_usd: 1, net_usd: 0 }),
        row({ day: '2026-10-22', sku: 'Actions storage', unit: 'GigabyteHours', quantity: 15, gross_usd: 0.01, discount_usd: 0, net_usd: 0.01 }),
        row({ day: '2026-09-28', gross_usd: 2, net_usd: 2 }),
        row({ day: '2026-09-15', gross_usd: 1, net_usd: 1 }),
        row({ day: '2026-11-01' }),
      ],
      sync: [sync()],
      agent: { billedMinutes: 400, agentBilledMinutes: 100 },
    })
    expect(bill.window).toEqual({ days: 30, from: '2026-09-28', to: '2026-10-27' })
    expect(bill.previousWindow).toEqual({ from: '2026-08-29', to: '2026-09-27' })
    expect(bill.totals).toEqual({ grossUsd: 3.91, discountUsd: 1, netUsd: 2.91, minutes: 350 })
    expect(bill.month).toEqual({ label: '2026-10', from: '2026-10-01', grossUsd: 1.91, discountUsd: 1, netUsd: 0.91 })
    expect(bill.previousTotals).toEqual({ grossUsd: 1, discountUsd: 0, netUsd: 1, minutes: 100 })
    expect(bill.change).toEqual({ netUsd: 1.91, netPct: 1.91 })
    expect(bill.byRepo.map((r) => [r.repo, r.netUsd])).toEqual([['acme/app', 2.61], ['acme/docs', 0.3], ['acme/site', 0]])
    expect(bill.bySku.find((s) => s.sku === 'Actions storage')).toMatchObject({ unit: 'GigabyteHours', quantity: 15 })
    expect(bill.byDay).toHaveLength(30)
    expect(bill.byDay[0]).toEqual({ day: '2026-09-28', grossUsd: 2, discountUsd: 0, netUsd: 2 })
    expect(bill.dataThrough).toBe('2026-10-27')
    expect(bill.windowComplete).toBe(true)
    expect(bill.available).toBe(true)
    expect(bill.unavailableReason).toBeNull()
    expect(bill.provenance).toBe('measured')
    expect(bill.agentShare).toMatchObject({ provenance: 'estimated', share: 0.25, billedMinutes: 400, agentBilledMinutes: 100 })
  })

  it('gives no previous period or change when the bill is not held that far back', () => {
    const bill = buildCiBill({ now, days: 30, rows: [row({})], sync: [sync({ covered_from: '2026-10-01' })], agent: null })
    expect(bill.previousTotals).toBeNull()
    expect(bill.change).toBeNull()
    expect(bill.windowComplete).toBe(false)
    expect(bill.agentShare).toBeNull()
  })

  it('says how to connect when no bill was ever read, using the last refusal when there is one', () => {
    const empty = buildCiBill({ now, days: 7, rows: [], sync: [], agent: { billedMinutes: 0, agentBilledMinutes: 0 } })
    expect(empty.available).toBe(false)
    expect(empty.unavailableReason).toBe(NO_BILL_REASON)
    expect(empty.byDay).toHaveLength(7)
    expect(empty.agentShare).toBeNull()
    const refused = buildCiBill({ now, days: 7, rows: [], sync: [sync({ last_ok_at: null, last_error: BILLING_UNAVAILABLE_REASON, covered_from: null })], agent: null })
    expect(refused.unavailableReason).toBe(BILLING_UNAVAILABLE_REASON)
    expect(refused.owners[0]).toMatchObject({ owner: 'acme', ownerType: 'User', lastOkAt: null, lastSource: 'api' })
  })
})
