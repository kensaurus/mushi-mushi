/**
 * FILE: edge-canary.test.ts
 * PURPOSE: Edge canaries (ADR 0061): a no-redirect request judged against
 *          an expected status and Location, filed on the second failing run
 *          in a row, one report per canary or one for a burst.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase'

const mod = await import('../../supabase/functions/_shared/edge-canary.ts')

const PROJECT = '84f3eba2-058f-48c9-97a1-43d20561e118'

const BARE_ROOT = {
  url: 'https://kensaur.us/glot-it?utm_source=canary',
  expect_status: [301],
  expect_location: 'https://kensaur.us/glot-it/?utm_source=canary',
}

describe('evaluateCanary', () => {
  it('resolves a relative Location against the request URL before comparing', () => {
    const o = { status: 301, location: mod.resolveLocation('/glot-it/?utm_source=canary', BARE_ROOT.url) }
    expect(o.location).toBe('https://kensaur.us/glot-it/?utm_source=canary')
    expect(mod.evaluateCanary(BARE_ROOT, o).pass).toBe(true)
  })

  it('fails a redirect that drops the query (the #1095 regression)', () => {
    const v = mod.evaluateCanary(BARE_ROOT, { status: 301, location: 'https://kensaur.us/glot-it/' })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('it answered 301 to https://kensaur.us/glot-it/')
  })

  it('fails the right Location with the wrong status (302 for 301)', () => {
    expect(mod.evaluateCanary(BARE_ROOT, { status: 302, location: BARE_ROOT.expect_location }).pass).toBe(false)
  })

  it('a missing asset passes on 403 or 404 and fails on 200 HTML or a 5xx', () => {
    const asset = { url: 'https://kensaur.us/glot-it/_next/static/chunks/does-not-exist-canary.js', expect_status: [403, 404], expect_location: null }
    expect(mod.evaluateCanary(asset, { status: 403, location: null }).pass).toBe(true)
    expect(mod.evaluateCanary(asset, { status: 404, location: null }).pass).toBe(true)
    expect(mod.evaluateCanary(asset, { status: 200, location: null }).pass).toBe(false)
    expect(mod.evaluateCanary(asset, { status: 503, location: null }).pass).toBe(false)
  })

  it('an unreachable URL fails with its error', () => {
    const v = mod.evaluateCanary({ url: 'https://kensaur.us/yen-yen/', expect_status: [200], expect_location: null }, { status: -1, location: null, error: 'timed out' })
    expect(v).toEqual({ pass: false, detail: 'https://kensaur.us/yen-yen/ should answer 200; it answered no answer (timed out).' })
  })
})

describe('observeCanary', () => {
  it('never follows a redirect and sends the MushiSiteWatch User-Agent', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 301, headers: { Location: '/glot-it/?utm_source=canary' } }))
    const o = await mod.observeCanary(BARE_ROOT.url, fetchImpl as never)
    expect(o).toEqual({ status: 301, location: 'https://kensaur.us/glot-it/?utm_source=canary' })
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(init.redirect).toBe('manual')
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('MushiSiteWatch')
  })

  it('turns a network failure into status -1', async () => {
    const o = await mod.observeCanary('https://kensaur.us/x/', (async () => { throw new Error('ECONNRESET') }) as never)
    expect(o).toMatchObject({ status: -1, error: 'ECONNRESET' })
  })
})

function canary(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    project_id: PROJECT,
    label: `canary ${id}`,
    url: `https://kensaur.us/${id}/`,
    expect_status: [200],
    expect_location: null,
    enabled: true,
    fail_streak: 0,
    report_id: null,
    failing_since: null,
    ...over,
  }
}

function run(db: ReturnType<typeof makeFakeDb>, answer: (url: string) => number) {
  const classify = vi.fn()
  const sleep = vi.fn(async () => {})
  const fetchImpl = vi.fn(async (url: string) => new Response(null, { status: answer(url) }))
  return {
    classify,
    sleep,
    fetchImpl,
    result: mod.runEdgeCanaries(db as never, { fetch: fetchImpl as never, now: () => new Date('2026-11-13T11:14:00Z'), sleep, classify }),
  }
}

describe('runEdgeCanaries', () => {
  it('a passing canary records its answer and files nothing', async () => {
    const db = makeFakeDb({ edge_canaries: [canary('glot-it')], reports: [] })
    const r = run(db, () => 200)
    expect(await r.result).toEqual({ checked: 1, failing: 0, filed: 0, reports: 0 })
    expect(db.tables.edge_canaries[0]).toMatchObject({ last_status: 200, fail_streak: 0 })
    expect(r.sleep).not.toHaveBeenCalled()
  })

  it('a failure is re-checked in the same run; one that recovers counts as passing', async () => {
    const db = makeFakeDb({ edge_canaries: [canary('glot-it')], reports: [] })
    let calls = 0
    const r = run(db, () => (++calls === 1 ? 503 : 200))
    expect(await r.result).toMatchObject({ failing: 0, filed: 0 })
    expect(r.sleep).toHaveBeenCalledWith(mod.CANARY_RECHECK_DELAY_MS)
    expect(db.tables.edge_canaries[0].fail_streak).toBe(0)
  })

  it('the first failing run is a suspect; the second files one report', async () => {
    const db = makeFakeDb({ edge_canaries: [canary('glot-it')], reports: [] })
    expect(await run(db, () => 503).result).toMatchObject({ failing: 1, filed: 0 })
    expect(db.tables.edge_canaries[0]).toMatchObject({ fail_streak: 1, failing_since: '2026-11-13T11:14:00.000Z' })
    expect(db.tables.reports).toHaveLength(0)

    const second = run(db, () => 503)
    expect(await second.result).toMatchObject({ failing: 1, filed: 1, reports: 1 })
    const [report] = db.tables.reports
    expect(report).toMatchObject({ project_id: PROJECT, source: 'site_watch', severity: 'high', status: 'new' })
    expect(report.custom_metadata).toMatchObject({ source: 'edge_canary', observed: { status: 503 } })
    expect(db.tables.edge_canaries[0].report_id).toBe(report.id)
    expect(second.classify).toHaveBeenCalledTimes(1)
  })

  it('a canary with an open report does not file again; after it is closed, a new failure does', async () => {
    const db = makeFakeDb({ edge_canaries: [canary('glot-it', { fail_streak: 3, report_id: 'r1' })], reports: [{ id: 'r1', status: 'classified' }] })
    expect(await run(db, () => 503).result).toMatchObject({ filed: 0 })
    db.tables.reports[0].status = 'fixed'
    expect(await run(db, () => 503).result).toMatchObject({ filed: 1 })
    expect(db.tables.reports).toHaveLength(2)
  })

  it('passing again resets the streak and leaves the report for a person', async () => {
    const db = makeFakeDb({ edge_canaries: [canary('glot-it', { fail_streak: 4, report_id: 'r1', failing_since: '2026-11-13T08:00:00Z' })], reports: [{ id: 'r1', status: 'new' }] })
    await run(db, () => 200).result
    expect(db.tables.edge_canaries[0]).toMatchObject({ fail_streak: 0, failing_since: null, report_id: 'r1' })
    expect(db.tables.reports[0].status).toBe('new')
  })

  it('a burst of failures in one project becomes one outage report', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const db = makeFakeDb({ edge_canaries: ids.map((id) => canary(id, { fail_streak: 1 })), reports: [] })
    const r = run(db, () => 502)
    expect(await r.result).toMatchObject({ failing: 6, filed: 6, reports: 1 })
    expect(db.tables.reports).toHaveLength(1)
    expect(db.tables.reports[0]).toMatchObject({ severity: 'critical', custom_metadata: { outage: true, canaryCount: 6 } })
    expect(new Set(db.tables.edge_canaries.map((c) => c.report_id)).size).toBe(1)
  })

  it('skips disabled canaries and reads only one project when asked', async () => {
    const db = makeFakeDb({
      edge_canaries: [canary('on'), canary('off', { enabled: false }), canary('other', { project_id: 'p2' })],
      reports: [],
    })
    expect(await run(db, () => 200).result).toMatchObject({ checked: 2 })
    const one = mod.runEdgeCanaries(db as never, { fetch: (async () => new Response(null, { status: 200 })) as never, now: () => new Date(), sleep: async () => {}, classify: () => {} }, { projectId: PROJECT })
    expect(await one).toMatchObject({ checked: 1 })
  })
})
