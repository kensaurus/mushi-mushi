/**
 * The pure parts of `mushi runner bill`: the month flag, the owner lookup,
 * the usage read (Actions only; refusals explain the permission), and the
 * per-repo summary and its terminal view.
 */
import { describe, expect, it } from 'vitest'
import { fetchActionsUsage, isGithubLogin, lookupOwner, parseMonth, renderBill, summarizeBill, type UsageItem } from './bill.js'

const item = (over: Partial<UsageItem>): UsageItem => ({
  date: '2026-10-01T00:00:00Z',
  product: 'actions',
  sku: 'Actions Linux',
  quantity: 10,
  unitType: 'Minutes',
  grossAmount: 0.06,
  discountAmount: 0,
  netAmount: 0.06,
  repositoryName: 'app',
  ...over,
})

function fetchFrom(table: Record<string, { status: number; body: unknown; link?: string }>) {
  const urls: string[] = []
  const fn = async (url: string) => {
    urls.push(url)
    const hit = Object.entries(table).find(([k]) => url.endsWith(k))?.[1] ?? { status: 404, body: {} }
    return new Response(JSON.stringify(hit.body), { status: hit.status, headers: hit.link ? { link: hit.link } : {} })
  }
  return { fn, urls }
}

describe('parseMonth', () => {
  it('reads YYYY-MM and defaults to this UTC month', () => {
    expect(parseMonth('2026-09')).toEqual({ year: 2026, month: 9 })
    expect(parseMonth(undefined, new Date('2026-10-27T00:00:00Z'))).toEqual({ year: 2026, month: 10 })
    expect(parseMonth('2026-13')).toBeNull()
    expect(parseMonth('Oct')).toBeNull()
    expect(isGithubLogin('acme-org')).toBe(true)
    expect(isGithubLogin('-bad')).toBe(false)
  })
})

describe('lookupOwner and fetchActionsUsage', () => {
  it('finds the signed-in login and its type, then reads the user endpoint and drops Copilot', async () => {
    const f = fetchFrom({
      '/user': { status: 200, body: { login: 'acme' } },
      '/users/acme': { status: 200, body: { type: 'User' } },
      '/users/acme/settings/billing/usage?year=2026&month=10': { status: 200, body: { usageItems: [item({}), item({ product: 'copilot', sku: 'Copilot' })] } },
    })
    const who = await lookupOwner(f.fn, 't', undefined)
    expect(who).toEqual({ owner: 'acme', ownerType: 'User' })
    const usage = await fetchActionsUsage(f.fn, 't', 'acme', 'User', 2026, 10)
    expect(usage).toEqual({ items: [item({})], incomplete: false })
  })

  it('uses the organization endpoint, marks a next page incomplete, and explains a refusal', async () => {
    const f = fetchFrom({
      '/organizations/acme-org/settings/billing/usage?year=2026&month=9': { status: 200, body: { usageItems: [] }, link: '<x?page=2>; rel="next"' },
    })
    expect(await fetchActionsUsage(f.fn, 't', 'acme-org', 'Organization', 2026, 9)).toEqual({ items: [], incomplete: true })
    const refused = await fetchActionsUsage(fetchFrom({}).fn, 't', 'acme', 'User', 2026, 9)
    expect(refused).toEqual({ error: expect.stringContaining('Plan: read') })
    // gh makes a classic token, which reads a personal bill only with the user scope.
    expect(refused).toEqual({ error: expect.stringContaining('gh auth refresh -s user') })
    const org = await fetchActionsUsage(fetchFrom({}).fn, 't', 'acme-org', 'Organization', 2026, 9)
    expect(org).toEqual({ error: expect.stringContaining('Administration: read') })
    expect(await lookupOwner(fetchFrom({}).fn, 't', 'acme')).toEqual({ error: expect.stringContaining('404') })
  })
})

describe('summarizeBill and renderBill', () => {
  it('totals per repo with gross, discount and net, minutes only for minute SKUs', () => {
    const b = summarizeBill('acme', 'User', 2026, 10, [
      item({}),
      item({ quantity: 5, grossAmount: 0.03, netAmount: 0.03 }),
      item({ repositoryName: 'site', grossAmount: 1, discountAmount: 1, netAmount: 0 }),
      item({ sku: 'Actions storage', unitType: 'GigabyteHours', quantity: 15, grossAmount: 0.01, discountAmount: 0, netAmount: 0.01, repositoryName: null }),
    ])
    expect(b).toMatchObject({ owner: 'acme', month: '2026-10', grossUsd: 1.1, discountUsd: 1, netUsd: 0.1, minutes: 25 })
    expect(b.repos.map((r) => [r.repo, r.netUsd, r.minutes])).toEqual([
      ['acme/app', 0.09, 15],
      ['(no repository)', 0.01, 0],
      ['acme/site', 0, 10],
    ])
    const text = renderBill(b).join('\n')
    expect(text).toContain('GitHub Actions bill for acme, 2026-10')
    expect(text).toContain('Net $0.10   gross $1.10   discount $1.00   25 min')
    expect(text).toMatch(/acme\/app\s+\$0\.09 net/)
    expect(renderBill(summarizeBill('acme', 'User', 2026, 10, [])).join('\n')).toContain('No Actions usage this month.')
  })
})
