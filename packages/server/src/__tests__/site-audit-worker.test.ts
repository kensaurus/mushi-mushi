/**
 * FILE: site-audit-worker.test.ts
 * PURPOSE: The site-audit worker (ADR 0040) on an in-memory database and a
 *          fake Firecrawl: a due audit starts a batch; the next tick reads it,
 *          files one report per failing rule and schedules the next run; a
 *          rule whose report is still open is not filed twice; a fixed one
 *          that fails again is.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (_n: string, h: unknown) => h, reportError: vi.fn() }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/firecrawl.ts', () => ({ resolveFirecrawl: async () => null }))

type Worker = typeof import('../../supabase/functions/site-audit/index.ts')
let w: Worker
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = undefined
  w = await import('../../supabase/functions/site-audit/index.ts')
})

const P = '1000000c-0000-4000-8000-000000000000'
const A = '2000000c-0000-4000-8000-000000000000'
const BASE = 'https://tsumagoi.kensaur.us'

const PAGES = [
  {
    metadata: { sourceURL: `${BASE}/th/events`, statusCode: 200, title: 'イベント｜群馬・嬬恋 標高1,444mの牧場で過ごす夜', description: 'กิจกรรมที่ฟาร์ม', language: 'th' },
    html: '<img src="/a.jpg" alt="Camp">',
    markdown: '# กิจกรรม\n\n[泊まる](https://x) | [旅のプラン](https://y)',
    links: [`${BASE}/events/pizza`, 'https://firecrawl.dev/privacy'],
  },
  { metadata: { sourceURL: `${BASE}/th/events/pizza`, statusCode: 200, title: 'คืนพิซซ่า ที่ฟาร์ม Tsumagoi', description: 'คืนพิซซ่า', language: 'th' }, html: '', markdown: 'คืนพิซซ่า', links: [] },
]

function fakeFetch(statuses: Record<string, number>, batchStatus = { v: 'completed' }) {
  const calls: string[] = []
  const f = (async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    calls.push(`${init.method ?? 'GET'} ${url}`)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.endsWith('/v2/map')) return json({ links: [`${BASE}/th/events`, `${BASE}/th/events/pizza`, `${BASE}/sitemap.xml`, 'https://other.example/x'] })
    if (url.endsWith('/v2/batch/scrape')) return json({ id: 'batch-1' })
    if (url.includes('/v2/batch/scrape/batch-1')) return json(batchStatus.v === 'completed' ? { status: 'completed', creditsUsed: 2, data: PAGES } : { status: batchStatus.v })
    return new Response('', { status: statuses[url] ?? 200 })
  }) as unknown as typeof fetch
  return { f, calls }
}

function seed(over: Partial<Row> = {}): FakeDb {
  return makeFakeDb(
    {
      projects: [{ id: P, name: 'tsumagoi' }],
      site_audits: [{ id: A, project_id: P, enabled: true, base_url: BASE, page_limit: 200, cadence_days: 7, next_run_at: null, batch_id: null, batch_started_at: null, claimed_until: null, ...over }],
      site_audit_findings: [],
      reports: [],
    },
    { autoId: true, uniques: { site_audit_findings: ['audit_id', 'rule'] } },
  )
}

const T0 = new Date('2026-10-23T03:29:00Z')

describe('runSiteAudits', () => {
  it('starts a batch of the pages under the base URL, then files one report per failing rule', async () => {
    const db = seed()
    const { f, calls } = fakeFetch({ 'https://firecrawl.dev/privacy': 404 })
    const deps = { now: () => T0, fetch: f, resolveKey: async () => 'fc-test' }

    const first = await w.runSiteAudits(db as never, deps)
    expect(first).toEqual([{ auditId: A, outcome: 'started a batch of 3 pages' }])
    const start = calls.find((c) => c.startsWith('POST') && c.endsWith('/v2/batch/scrape'))
    expect(start).toBeTruthy()
    expect(db.table('site_audits')[0]).toMatchObject({ batch_id: 'batch-1', claimed_until: null })

    const later = { ...deps, now: () => new Date(T0.getTime() + 3_600_000) }
    const second = await w.runSiteAudits(db as never, later)
    expect(second[0].outcome).toMatch(/^audited 2 pages, filed 4$/)
    const reports = db.table('reports')
    expect(reports.map((r) => (r.custom_metadata as { rule: string }).rule).sort()).toEqual([
      'broken_external_link',
      'locale_link_drop',
      'locale_metadata_mismatch',
      'locale_text_leak',
    ])
    expect(reports.every((r) => r.source === 'site_audit' && r.status === 'new')).toBe(true)
    const audit = db.table('site_audits')[0]
    expect(audit).toMatchObject({ batch_id: null, last_error: null })
    expect(audit.next_run_at).toBe(new Date(T0.getTime() + 3_600_000 + 7 * 86_400_000).toISOString())
    expect((audit.last_summary as { pages: number }).pages).toBe(2)
  })

  it('keeps an open report, files again after a fix, and leaves a dismissed one alone', async () => {
    const db = seed()
    const { f } = fakeFetch({ 'https://firecrawl.dev/privacy': 404 })
    const deps = { now: () => T0, fetch: f, resolveKey: async () => 'fc-test' }
    await w.runSiteAudits(db as never, deps)
    await w.runSiteAudits(db as never, { ...deps, now: () => new Date(T0.getTime() + 3_600_000) })
    expect(db.table('reports')).toHaveLength(4)

    const byRule = (rule: string) => db.table('reports').find((r) => (r.custom_metadata as { rule: string }).rule === rule)!
    byRule('broken_external_link').status = 'fixed'
    byRule('locale_text_leak').status = 'dismissed'
    const audit = db.table('site_audits')[0]
    audit.next_run_at = null
    await w.runSiteAudits(db as never, { ...deps, now: () => new Date(T0.getTime() + 10 * 86_400_000) })
    const out = await w.runSiteAudits(db as never, { ...deps, now: () => new Date(T0.getTime() + 10 * 86_400_000 + 3_600_000) })
    expect(out[0].outcome).toBe('audited 2 pages, filed 1')
    expect(db.table('reports')).toHaveLength(5)
  })

  it('waits on a batch Firecrawl has not finished, and needs a Firecrawl key', async () => {
    const db = seed({ batch_id: 'batch-1', batch_started_at: T0.toISOString() })
    const { f } = fakeFetch({}, { v: 'scraping' })
    const out = await w.runSiteAudits(db as never, { now: () => new Date(T0.getTime() + 600_000), fetch: f, resolveKey: async () => 'fc-test' })
    expect(out).toEqual([{ auditId: A, outcome: 'batch scraping' }])
    expect(db.table('site_audits')[0]).toMatchObject({ batch_id: 'batch-1', claimed_until: null })

    const noKey = seed()
    const res = await w.runSiteAudits(noKey as never, { now: () => T0, fetch: f, resolveKey: async () => null })
    expect(res).toEqual([{ auditId: A, outcome: 'no key' }])
    expect(noKey.table('site_audits')[0].last_error).toBe('No Firecrawl key this app can use.')
  })

  it('auditUrls keeps documents under the base, base first, capped', () => {
    expect(w.auditUrls(BASE, [`${BASE}/a`, { url: `${BASE}/b#x` }, `${BASE}/c.png`, 'https://else.dev/'], 2)).toEqual([BASE, `${BASE}/a`])
  })
})
