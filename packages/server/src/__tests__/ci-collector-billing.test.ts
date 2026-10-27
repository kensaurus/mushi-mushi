/**
 * FILE: ci-collector-billing.test.ts
 * PURPOSE: What the ci-jobs-collector tick adds for the cost work
 *          (2026-10-27):
 *            - closed pull requests listed once a day per repo (merged or
 *              not), and up to two PR file lists read per tick (docs only?);
 *            - each GitHub owner's Actions bill read once a day with the
 *              project's own token, from the calls the tick left over: this
 *              month, last month and the month the comparison needs; the
 *              organization endpoint for an organization; a refusal or a
 *              missing token recorded in plain words and retried tomorrow;
 *              nothing read without a billing token resolver, and nothing
 *              thrown before the tables exist.
 */

import { describe, expect, it } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import { NO_BILLING_TOKEN, runCiCollector, syncBilling, type CollectorDeps } from '../../supabase/functions/_shared/ci-collector.ts'
import { BILLING_UNAVAILABLE_REASON } from '../../supabase/functions/_shared/ci-billing.ts'

const NOW = new Date('2026-10-27T09:00:00Z')
const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'

const usage = (date: string, repo = 'app') => ({
  date,
  product: 'actions',
  sku: 'Actions Linux',
  quantity: 10,
  unitType: 'Minutes',
  grossAmount: 0.06,
  discountAmount: 0,
  netAmount: 0.06,
  repositoryName: repo,
})

function github(opts: { billing?: { status: number; body?: unknown }; owner?: { login: string; type: string }; files?: Record<number, string[]> } = {}) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    const u = new URL(url)
    if (u.pathname.includes('/settings/billing/usage')) {
      const b = opts.billing ?? { status: 200 }
      const month = Number(u.searchParams.get('month'))
      const body = b.body ?? { usageItems: [usage(`2026-${String(month).padStart(2, '0')}-02T03:00:00Z`)] }
      return new Response(JSON.stringify(body), { status: b.status })
    }
    if (u.pathname.endsWith('/pulls') && u.searchParams.get('state') === 'closed') {
      return new Response(
        JSON.stringify([
          { number: 7, state: 'closed', draft: false, merged_at: '2026-10-25T00:00:00Z', closed_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00Z', head: { ref: 'feature/a' } },
          { number: 8, state: 'closed', draft: true, merged_at: null, closed_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z', head: { ref: 'cursor/mushi-fix-1' } },
          { number: 9, state: 'closed', draft: false, merged_at: null, closed_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z', head: { ref: 'docs/x' } },
          { number: 1, state: 'closed', merged_at: null, closed_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', head: { ref: 'old' } },
        ]),
        { status: 200 },
      )
    }
    const files = /\/pulls\/(\d+)\/files/.exec(u.pathname)
    if (files) {
      const list = opts.files?.[Number(files[1])] ?? ['src/app.ts']
      return new Response(JSON.stringify(list.map((filename) => ({ filename }))), { status: 200 })
    }
    if (/^\/repos\/[^/]+\/[^/]+$/.test(u.pathname)) {
      return new Response(JSON.stringify({ private: true, owner: opts.owner ?? { login: 'acme', type: 'User' } }), { status: 200 })
    }
    if (u.pathname.includes('/actions/runs')) return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 })
    if (u.pathname.includes('/actions/runners')) return new Response(JSON.stringify({ runners: [] }), { status: 200 })
    return new Response('{}', { status: 404 })
  }
  return { calls, fetchImpl }
}

function seed(repo = 'acme/app') {
  return makeFakeDb({
    projects: [{ id: P1, organization_id: ORG }],
    project_repos: [{ project_id: P1, repo_url: `https://github.com/${repo}`, github_app_installation_id: null }],
  })
}

function deps(fetchImpl: CollectorDeps['fetchImpl'], over: Partial<CollectorDeps> = {}, now = NOW): CollectorDeps {
  return { resolveToken: async () => 'ghs_app', resolveBillingToken: async () => 'github_pat_own', fetchImpl, now: () => now, ...over }
}

describe('closed pull requests', () => {
  it('lists them once a day, stores merged and unmerged ones of the last 30 days, and reads two file lists a tick', async () => {
    const db = seed()
    const gh = github({ files: { 8: ['README.md', 'docs/setup.mdx'], 7: ['src/a.ts', 'README.md'] } })
    const summary = await runCiCollector(db as never, deps(gh.fetchImpl, { resolveBillingToken: undefined }))
    const prs = db.table('ci_pull_requests')
    expect(prs.map((p) => p.number).sort()).toEqual([7, 8, 9])
    expect(prs.find((p) => p.number === 7)).toMatchObject({ merged: true, head_ref: 'feature/a' })
    expect(prs.find((p) => p.number === 8)).toMatchObject({ merged: false, draft: true, docs_only: true })
    // Newest closed first: 8 and 7 this tick, 9 next tick.
    expect(prs.find((p) => p.number === 7)).toMatchObject({ docs_only: false })
    expect(prs.find((p) => p.number === 9)?.files_checked_at).toBeUndefined()
    expect(summary.prs).toEqual({ repos: 1, stored: 3, classified: 2 })

    gh.calls.length = 0
    await runCiCollector(db as never, deps(gh.fetchImpl, { resolveBillingToken: undefined }, new Date(NOW.getTime() + 10 * 60_000)))
    expect(gh.calls.some((u) => u.includes('/pulls?state=closed'))).toBe(false)
    expect(gh.calls.filter((u) => u.includes('/files'))).toEqual([expect.stringContaining('/pulls/9/files')])
    expect(db.table('ci_pull_requests').find((p) => p.number === 9)).toMatchObject({ docs_only: false })
  })
})

describe('the Actions bill', () => {
  it('reads this month, last month and the month the comparison needs with the project token, once a day', async () => {
    const db = seed()
    const gh = github()
    const summary = await runCiCollector(db as never, deps(gh.fetchImpl))
    const billCalls = gh.calls.filter((u) => u.includes('/settings/billing/usage'))
    expect(billCalls).toEqual([
      'https://api.github.com/users/acme/settings/billing/usage?year=2026&month=10',
      'https://api.github.com/users/acme/settings/billing/usage?year=2026&month=9',
      'https://api.github.com/users/acme/settings/billing/usage?year=2026&month=8',
    ])
    expect(summary.billing).toEqual({ owners: 1, calls: 3, rows: 3, unavailable: 0 })
    expect(db.table('ci_billing_daily').map((r) => [r.day, r.repo, r.source, r.organization_id])).toEqual([
      ['2026-10-02', 'acme/app', 'api', ORG],
      ['2026-09-02', 'acme/app', 'api', ORG],
      ['2026-08-02', 'acme/app', 'api', ORG],
    ])
    expect(db.table('ci_billing_sync')[0]).toMatchObject({ owner: 'acme', owner_type: 'User', last_ok_at: NOW.toISOString(), last_error: null, last_source: 'api', covered_from: '2026-08-01' })

    gh.calls.length = 0
    await runCiCollector(db as never, deps(gh.fetchImpl, {}, new Date(NOW.getTime() + 60 * 60_000)))
    expect(gh.calls.some((u) => u.includes('/settings/billing/usage'))).toBe(false)

    // A day later: this month and last month only, the older month is held.
    gh.calls.length = 0
    await runCiCollector(db as never, deps(gh.fetchImpl, {}, new Date(NOW.getTime() + 25 * 60 * 60_000)))
    expect(gh.calls.filter((u) => u.includes('/settings/billing/usage'))).toHaveLength(2)
    expect(db.table('ci_billing_sync')[0].covered_from).toBe('2026-08-01')
  })

  it('uses the organization endpoint for an organization owner', async () => {
    const db = seed('acme-org/app')
    const gh = github({ owner: { login: 'acme-org', type: 'Organization' } })
    await runCiCollector(db as never, deps(gh.fetchImpl))
    expect(gh.calls.filter((u) => u.includes('/settings/billing/usage'))[0]).toBe('https://api.github.com/organizations/acme-org/settings/billing/usage?year=2026&month=10')
    expect(db.table('ci_billing_sync')[0]).toMatchObject({ owner_type: 'Organization' })
  })

  it('records a refusal and a missing token in plain words, and retries a day later', async () => {
    const refused = seed()
    const gh = github({ billing: { status: 404, body: { message: 'Not Found' } } })
    const summary = await runCiCollector(refused as never, deps(gh.fetchImpl))
    expect(gh.calls.filter((u) => u.includes('/settings/billing/usage'))).toHaveLength(1)
    expect(summary.billing.unavailable).toBe(1)
    expect(refused.table('ci_billing_sync')[0]).toMatchObject({ last_attempt_at: NOW.toISOString(), last_ok_at: null, last_error: BILLING_UNAVAILABLE_REASON, covered_from: null })
    expect(refused.table('ci_billing_daily')).toHaveLength(0)

    const noToken = seed()
    const gh2 = github()
    await runCiCollector(noToken as never, deps(gh2.fetchImpl, { resolveBillingToken: async () => null }))
    expect(gh2.calls.some((u) => u.includes('/settings/billing/usage'))).toBe(false)
    expect(noToken.table('ci_billing_sync')[0]).toMatchObject({ last_error: NO_BILLING_TOKEN, last_ok_at: null })
  })

  it('reads nothing without a billing token resolver, waits for budget, and does not throw before the tables exist', async () => {
    const db = seed()
    const gh = github()
    await runCiCollector(db as never, deps(gh.fetchImpl, { resolveBillingToken: undefined }))
    expect(gh.calls.some((u) => u.includes('/settings/billing/usage'))).toBe(false)

    const tight = await syncBilling(seed() as never, deps(gh.fetchImpl), {
      calls: 2,
      now: NOW,
      bindings: [{ projectId: P1, repo: 'acme/app', installationId: null }],
      permissionsByProject: new Map(),
    })
    expect(tight).toEqual({ owners: 0, calls: 0, rows: 0, unavailable: 0 })

    const pending = makeFakeDb(
      { projects: [{ id: P1, organization_id: ORG }], project_repos: [{ project_id: P1, repo_url: 'https://github.com/acme/app', github_app_installation_id: null }] },
      { failRead: (t) => (t === 'ci_billing_sync' || t === 'ci_pull_requests' ? { code: '42P01', message: 'relation does not exist' } : null) },
    )
    const summary = await runCiCollector(pending as never, deps(github().fetchImpl))
    expect(summary.billing).toEqual({ owners: 0, calls: 0, rows: 0, unavailable: 0 })
  })
})
