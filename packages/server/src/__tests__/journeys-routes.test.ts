/**
 * FILE: journeys-routes.test.ts
 * PURPOSE: The Journey optimizer routes (api/routes/journeys.ts, served by
 *          api-ext) through the real handlers on an in-memory database:
 *            - GET builds the map from visits plus the newest finished scan,
 *              only confirmed broken pages count, a scan stuck "running"
 *              reads as failed, and another app's data never leaks in;
 *            - POST refuses viewers, a missing or unsafe address, a second
 *              scan while one runs and a re-scan inside 10 minutes;
 *            - the scan is a Firecrawl batch finished on a later read: it
 *              stores links and fingerprints (never page text), refuses a
 *              missing key in plain words, gives up after 20 minutes and
 *              keeps the newest 10 scans.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({
  db: null as unknown,
  accessible: [] as string[],
  roles: {} as Record<string, string>,
  mapLinks: [] as string[],
  pages: {} as Record<string, { title: string; markdown: string; links: string[] }>,
  batchSent: [] as string[],
  batchStatus: 'completed' as 'scraping' | 'completed' | 'failed',
  startError: null as Error | null,
  statusCalls: 0,
}))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next() }))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/firecrawl.ts', () => ({
  firecrawlMapOwnSite: async () => {
    if (state.startError) throw state.startError
    return state.mapLinks
  },
  firecrawlBatchScrapeOwnSite: async (_db: unknown, _p: string, urls: string[]) => {
    state.batchSent = urls
    return { id: 'batch-1', sent: urls.length }
  },
  firecrawlBatchStatus: async () => {
    state.statusCalls += 1
    if (state.batchStatus === 'scraping') return { status: 'scraping', completed: 1, total: 3 }
    if (state.batchStatus === 'failed') return { status: 'failed', error: 'FIRECRAWL_BATCH_FAILED' }
    return {
      status: 'completed',
      pages: state.batchSent.filter((u) => state.pages[u]).map((u) => ({ url: u, statusCode: 200, ...state.pages[u]! })),
    }
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) => c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  parseUuidParam: (c: { req: { param: (k: string) => string } }) => ({ ok: true, value: c.req.param('id') }),
  callerCanAccessProject: async (_c: unknown, _db: unknown, _user: string, projectId: string) => ({
    allowed: state.accessible.includes(projectId),
    role: state.accessible.includes(projectId) ? (state.roles[projectId] ?? 'member') : null,
  }),
}))

const P = '2000000a-0000-4000-8000-000000000000'
const OTHER = '3000000a-0000-4000-8000-000000000000'
const BASE = 'https://app.test'

let routes: typeof import('../../supabase/functions/api/routes/journeys.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/journeys.ts')
})

type Res = { status: number; body: { ok: boolean; data?: any; error?: { code: string; message?: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  headers: Record<string, string> = {}
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handlers: h }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handlers: h }) }
  put(path: string, ...h: Handler[]) { this.routes.push({ method: 'PUT', path, handlers: h }) }
  async call(method: string, path: string, opts: { id?: string; body?: string; query?: Record<string, string> } = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1' }
    const c = {
      req: {
        text: async () => opts.body ?? '',
        json: async () => JSON.parse(opts.body ?? 'null'),
        param: (k: string) => (k === 'id' ? opts.id ?? P : undefined),
        header: () => undefined,
        query: (k: string) => opts.query?.[k],
      },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      header: (k: string, v: string) => { this.headers[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

const now = Date.now()
const ago = (min: number) => new Date(now - min * 60_000).toISOString()

let db: FakeDb
let app: FakeApp

function pv(session: string, route: string, minAgo: number, project = P) {
  return { id: `${session}-${minAgo}`, project_id: project, session_id: session, route, ts: ago(minAgo) }
}

beforeEach(() => {
  db = makeFakeDb(
    {
      session_page_views: [
        ...Array.from({ length: 10 }, (_, i) => [pv(`s${i}`, '/', 100 + i), pv(`s${i}`, '/pricing', 99 + i)]).flat(),
        pv('x', '/secret', 50, OTHER),
      ],
      site_structure_scans: [],
      site_watch_pages: [
        { project_id: P, url: `${BASE}/pricing`, resolved_at: null, confirmed_at: ago(30), report_id: null },
        // A suspect seen once is not broken (ADR 0029).
        { project_id: P, url: `${BASE}/about`, resolved_at: null, confirmed_at: null, report_id: null },
      ],
      site_watches: [{ project_id: P, base_url: BASE }],
      site_audits: [],
      project_settings: [],
      story_map_runs: [],
    },
    { autoId: true },
  )
  state.db = db
  state.accessible = [P]
  state.roles = {}
  state.batchSent = []
  state.batchStatus = 'completed'
  state.startError = null
  state.statusCalls = 0
  state.mapLinks = [`${BASE}/`, `${BASE}/pricing`, `${BASE}/plans`, `${BASE}/logo.png`]
  const lorem = 'our pricing is simple you pay one flat fee each month for every project and every teammate you add there are no hidden costs and you can cancel at any time from the settings page with one click and keep your data for thirty days after'
  state.pages = {
    [`${BASE}/`]: { title: 'Home', markdown: '# Welcome\nStart here', links: [`${BASE}/pricing`, 'https://other.test/', '/pricing?ref=x'] },
    [`${BASE}/pricing`]: { title: 'Pricing', markdown: lorem, links: [`${BASE}/`] },
    [`${BASE}/plans`]: { title: 'Plans', markdown: lorem, links: [`${BASE}/`] },
  }
  app = new FakeApp()
  routes.registerJourneyRoutes(app as never)
})

describe('GET /v1/admin/projects/:id/journeys', () => {
  it('builds the map from this app\'s visits only, with confirmed broken pages', async () => {
    const res = await app.call('GET', '/v1/admin/projects/:id/journeys', { query: { days: '7' } })
    expect(res.status).toBe(200)
    expect(res.body.data.days).toBe(7)
    expect(res.body.data.liveUrl).toBe(BASE)
    const map = res.body.data.map
    expect(map.stats).toMatchObject({ sessions: 10, pageViews: 20 })
    expect(map.nodes.map((n: { path: string }) => n.path).sort()).toEqual(['/', '/pricing'])
    expect(map.findings.filter((f: { kind: string }) => f.kind === 'broken').map((f: { pages: string[] }) => f.pages)).toEqual([['/pricing']])
    expect(res.body.data.scan).toBeNull()
  })

  it('reads past the 1,000-row server cap', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `big-${String(i).padStart(4, '0')}`, project_id: P, session_id: `b${i}`, route: '/', ts: ago(10 + i / 100) }))
    state.db = makeFakeDb({ ...{ session_page_views: rows, site_structure_scans: [], site_watch_pages: [], site_watches: [], site_audits: [], project_settings: [], story_map_runs: [] } }, { maxRows: 1000 })
    const res = await app.call('GET', '/v1/admin/projects/:id/journeys')
    expect(res.body.data.map.stats).toMatchObject({ sessions: 1500, pageViews: 1500, sampled: false })
  })

  it('defaults to 30 days and 404s for an app the user cannot open', async () => {
    expect((await app.call('GET', '/v1/admin/projects/:id/journeys', { query: { days: '999' } })).body.data.days).toBe(30)
    expect((await app.call('GET', '/v1/admin/projects/:id/journeys', { id: OTHER })).status).toBe(404)
  })

  it('gives up on a batch still running after 20 minutes, and on a scan with no batch', async () => {
    db.table('site_structure_scans').push({ id: 'old', project_id: P, base_url: BASE, status: 'running', page_count: 0, error: null, created_at: ago(30), finished_at: null, pages: [], batch_id: 'b', checked_at: null })
    const res = await app.call('GET', '/v1/admin/projects/:id/journeys')
    expect(res.body.data.scan).toMatchObject({ id: 'old', status: 'failed' })
    expect(res.body.data.scan.error).toContain('20 minutes')
    db.table('site_structure_scans').push({ id: 'nobatch', project_id: P, base_url: BASE, status: 'running', page_count: 0, error: null, created_at: ago(2), finished_at: null, pages: [], batch_id: null, checked_at: null })
    expect((await app.call('GET', '/v1/admin/projects/:id/journeys')).body.data.scan).toMatchObject({ id: 'nobatch', status: 'failed' })
  })
})

describe('POST /v1/admin/projects/:id/journeys/scan', () => {
  const scan = (body?: unknown, id?: string) => app.call('POST', '/v1/admin/projects/:id/journeys/scan', { body: body === undefined ? '' : JSON.stringify(body), id })

  it('starts a batch, finishes it on a later read, and stores links and fingerprints, not page text', async () => {
    state.batchStatus = 'scraping'
    const res = await scan()
    expect(res.status).toBe(202)
    expect(res.body.data.scan).toMatchObject({ status: 'running', baseUrl: BASE })
    // Files are skipped; the start page is first.
    expect(state.batchSent).toEqual([`${BASE}/`, `${BASE}/pricing`, `${BASE}/plans`])
    expect(db.table('site_structure_scans')[0]).toMatchObject({ status: 'running', batch_id: 'batch-1', pages_sent: 3 })

    // While Firecrawl is still scraping, a read leaves the scan running.
    expect((await app.call('GET', '/v1/admin/projects/:id/journeys')).body.data.scan.status).toBe('running')
    // A read right after reuses that check instead of asking Firecrawl again.
    await app.call('GET', '/v1/admin/projects/:id/journeys')
    expect(state.statusCalls).toBe(1)

    state.batchStatus = 'completed'
    db.table('site_structure_scans')[0]!.checked_at = ago(1)
    const map = (await app.call('GET', '/v1/admin/projects/:id/journeys')).body.data
    const row = db.table('site_structure_scans')[0]!
    expect(row).toMatchObject({ status: 'done', page_count: 3, error: null })
    const pages = row.pages as Array<Record<string, unknown>>
    const home = pages.find((p) => p.path === '/')!
    expect(home.links).toEqual(['/pricing'])
    expect(JSON.stringify(pages)).not.toContain('pay one flat fee')

    // The same read already carries the scan: /plans duplicates /pricing and nothing links to it.
    expect(map.mapScan).toMatchObject({ status: 'done', pageCount: 3 })
    const kinds = map.map.findings.map((f: { kind: string; pages: string[] }) => `${f.kind}:${f.pages.join(',')}`)
    expect(kinds).toContain('duplicate_page:/plans,/pricing')
    expect(kinds).toContain('orphan:/plans')
  })

  it('refuses viewers, unsafe addresses and apps with no known address', async () => {
    state.roles[P] = 'viewer'
    expect((await scan()).status).toBe(403)
    state.roles[P] = 'admin'
    expect((await scan({ base_url: 'http://127.0.0.1:8080' })).body.error?.code).toBe('UNSAFE_URL')
    expect((await scan({ base_url: 'not a url' })).status).toBe(400)
    db.table('site_watches').length = 0
    expect((await scan()).body.error?.code).toBe('NO_LIVE_URL')
  })

  it('allows one scan at a time and none within 10 minutes of the last', async () => {
    db.table('site_structure_scans').push({ id: 'run', project_id: P, base_url: BASE, status: 'running', page_count: 0, error: null, created_at: ago(1), finished_at: null, pages: [], batch_id: 'b', checked_at: null })
    expect((await scan()).body.error?.code).toBe('SCAN_RUNNING')
    db.table('site_structure_scans')[0]!.status = 'done'
    db.table('site_structure_scans')[0]!.finished_at = ago(2)
    const res = await scan()
    expect(res.status).toBe(429)
    expect(res.body.error?.code).toBe('SCAN_TOO_SOON')
    expect(app.headers['Retry-After']).toBe('480')
  })

  it('says in plain words when there is no Firecrawl key, and stores no scan', async () => {
    state.startError = new Error('FIRECRAWL_NOT_CONFIGURED')
    const res = await scan()
    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ code: 'FIRECRAWL_NOT_CONFIGURED' })
    expect(res.body.error?.message).toContain('Settings → AI keys')
    expect(db.table('site_structure_scans')).toHaveLength(0)
  })

  it('records a batch Firecrawl stopped as a failed scan', async () => {
    state.batchStatus = 'failed'
    await scan()
    await app.call('GET', '/v1/admin/projects/:id/journeys')
    expect(db.table('site_structure_scans')[0]).toMatchObject({ status: 'failed' })
    expect(String(db.table('site_structure_scans')[0]!.error)).toContain('stopped the scan')
  })

  it('keeps the newest 10 scans', async () => {
    for (let i = 0; i < 12; i++) {
      db.table('site_structure_scans').push({ id: `old${i}`, project_id: P, base_url: BASE, status: 'done', page_count: 1, error: null, created_at: ago(60 + i), finished_at: ago(60 + i), pages: [] })
    }
    await scan()
    await app.call('GET', '/v1/admin/projects/:id/journeys')
    const left = db.table('site_structure_scans').filter((r) => r.project_id === P)
    expect(left).toHaveLength(10)
    expect(left.some((r) => r.id === 'old11')).toBe(false)
  })
})

describe('PUT /v1/admin/projects/:id/journeys/recording', () => {
  const record = (body: unknown) => app.call('PUT', '/v1/admin/projects/:id/journeys/recording', { body: JSON.stringify(body) })

  it('opens a window, shows it on the map, and stops it', async () => {
    const before = Date.now()
    const res = await record({ hours: 24, sample_rate: 0.25 })
    expect(res.status).toBe(200)
    expect(res.body.data.recording.sampleRate).toBe(0.25)
    const until = Date.parse(res.body.data.recording.until)
    expect(until).toBeGreaterThanOrEqual(before + 24 * 3_600_000)
    expect((await app.call('GET', '/v1/admin/projects/:id/journeys')).body.data.recording).toMatchObject({ sampleRate: 0.25 })

    const stopped = await record({ hours: 0 })
    expect(stopped.body.data.recording).toEqual({ until: null, sampleRate: 0.25 })
  })

  it('refuses viewers and windows longer than a week', async () => {
    state.roles[P] = 'viewer'
    expect((await record({ hours: 1 })).status).toBe(403)
    state.roles[P] = 'admin'
    expect((await record({ hours: 169 })).status).toBe(400)
    expect((await record({ hours: 1, sample_rate: 0 })).status).toBe(400)
  })

  it('reads a past window as off', () => {
    expect(routes.recordingOf({ journey_recording_until: ago(1), journey_recording_sample: 0.5 }, new Date())).toEqual({ until: null, sampleRate: 0.5 })
  })
})

describe('helpers', () => {
  it('finds the start page path, base path included', () => {
    expect(routes.rootPathOf('https://kensaur.us/glot-it/')).toBe('/glot-it')
    expect(routes.rootPathOf('https://app.test')).toBe('/')
  })
})
