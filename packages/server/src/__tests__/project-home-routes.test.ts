/**
 * FILE: project-home-routes.test.ts
 * PURPOSE: The per-app Home routes (api/routes/project-home.ts, served by
 *          api-ext) through the real handlers on an in-memory database:
 *            - GET returns every section with exact counts; a failed read
 *              makes only its own section `error` (never "not connected",
 *              never "ok with 0") and the call still answers 200;
 *            - before the thumbnail table exists the app card falls back to
 *              the icon instead of failing the page;
 *            - "Needs you" carries the pipeline group's own label and count;
 *            - capture on view runs only with the watch on and the app's own
 *              Firecrawl key; Refresh is refused for viewers, without an
 *              own key, and inside the 10-minute gap.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({
  db: null as unknown,
  accessible: [] as string[],
  roles: {} as Record<string, string>,
  params: {} as Record<string, string>,
  firecrawl: null as null | { key: string; source: 'byok' | 'env' },
  background: [] as string[],
  captures: [] as string[],
  pipelineFails: false,
}))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ jwtAuth: async (_c: unknown, next: () => Promise<void>) => next() }))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/background.ts', () => ({
  runInBackground: (p: Promise<unknown>, label: string) => {
    state.background.push(label)
    void p.catch(() => {})
  },
}))
vi.mock('../../supabase/functions/_shared/firecrawl.ts', () => ({ resolveFirecrawl: async () => state.firecrawl }))
vi.mock('../../supabase/functions/_shared/sdk-observation.ts', () => ({
  fetchProjectSdkObservations: async () => [{ project_id: P, sdk_package: '@mushi-mushi/web', sdk_version: '1.30.0', source: 'heartbeat', observed_at: '2026-10-26T00:00:00Z' }],
  fetchLatestStampedSdkReports: async () => [],
  resolveProjectSdkIdentity: (o: { sdk_package: string; sdk_version: string } | undefined) => ({ sdk_package: o?.sdk_package ?? null, sdk_version: o?.sdk_version ?? null, sdk_observation_source: 'heartbeat' }),
}))
vi.mock('../../supabase/functions/api/routes/pipeline.ts', () => ({
  readPipeline: async () => {
    if (state.pipelineFails) throw new Error('fix_attempts: timeout')
    return {
      stages: [
        { id: 'review', label: 'Reviewed', count: 45, stuck: 45, oldestAt: null, groups: [{ id: 'hold', stage: 'review', tone: 'stuck', label: '45 PRs: Opus says hold; a person decides', count: 45, oldestAt: null, actions: [], settings: null, items: [] }] },
        { id: 'train', label: 'Release train', count: 2, stuck: 0, oldestAt: null, groups: [] },
        { id: 'merged', label: 'Merged', count: 3, stuck: 0, oldestAt: null, groups: [] },
      ],
      trains: [{ repo: 'kensaurus/glot.it', projectId: P, merged: 1, failed: 0, active: 1, topFailures: [], trains: [{ id: 't1', state: 'testing', prNumber: 812, members: 2, attempt: 1, detail: null, createdAt: '2026-10-27T10:00:00Z' }] }],
    }
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) => c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  OPEN_REPORT_STATUSES: ['new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'reopened'],
  parseUuidParam: (c: { req: { param: (k: string) => string } }) => ({ ok: true, value: c.req.param('id') }),
  userCanAccessProject: async (_db: unknown, _user: string, projectId: string) => ({
    allowed: state.accessible.includes(projectId),
    role: state.accessible.includes(projectId) ? (state.roles[projectId] ?? 'member') : null,
  }),
}))

const P = '1000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-27T12:00:00Z')
const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

let routes: typeof import('../../supabase/functions/api/routes/project-home.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/project-home.ts')
})

type Res = { status: number; body: { ok: boolean; data?: Record<string, any> | null; error?: { code: string; message?: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handlers: h }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handlers: h }) }
  async call(method: string, path: string): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1' }
    const c = {
      req: { json: async () => ({}), param: (k: string) => state.params[k], header: () => undefined, query: () => undefined },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

function seed(): Record<string, Array<Record<string, unknown>>> {
  const report = (i: number, over: Record<string, unknown>) => ({ id: `r${i}`, project_id: P, status: 'classified', severity: 'medium', created_at: ago(30), environment: { url: 'https://glot.it/lessons/1' }, ...over })
  return {
    projects: [{ id: P, name: 'glot.it', slug: 'glot-it', created_at: '2026-01-01T00:00:00Z', organization_id: null, owner_id: 'u1', icon_url: null, icon_source: 'app_store' }],
    project_api_keys: [
      { project_id: P, label: 'Web SDK', scopes: ['report:write'], is_active: true, created_at: ago(500), last_seen_at: ago(1), last_seen_origin: 'https://glot.it', last_seen_user_agent: 'Mozilla/5.0' },
      { project_id: P, label: 'Old', scopes: ['report:write'], is_active: false, created_at: ago(900), last_seen_at: ago(800), last_seen_origin: null, last_seen_user_agent: null },
    ],
    site_watches: [{ project_id: P, base_url: 'https://glot.it', status: 'active', last_checked_at: ago(2), last_error: null }],
    site_watch_pages: [
      { project_id: P, url: 'https://glot.it/pricing', resolved_at: null, confirmed_at: ago(3), report_id: null },
      // A suspect seen once is not broken yet (ADR 0029).
      { project_id: P, url: 'https://glot.it/about', resolved_at: null, confirmed_at: null, report_id: null },
    ],
    project_repos: [{ project_id: P, repo_url: 'https://github.com/kensaurus/glot.it', default_branch: 'main', is_primary: true, created_at: ago(900) }],
    ci_jobs: [{ project_id: P, repo: 'kensaurus/glot.it', head_branch: 'main', run_id: 9, run_attempt: 1, job_name: 'build', status: 'completed', conclusion: 'success', infra: false, gh_created_at: ago(5), completed_at: ago(4) }],
    reports: [
      report(1, { severity: 'critical', created_at: ago(2) }),
      report(2, { created_at: ago(30) }),
      report(3, { severity: 'high', created_at: ago(30), status: 'fixed' }),
      report(4, { severity: null, created_at: ago(24 * 9) }),
    ],
    fix_attempts: [{ id: 'f1', project_id: P, merged_at: ago(1), created_at: ago(20), pr_url: 'https://github.com/kensaurus/glot.it/pull/1' }],
    deploy_observations: [{ id: 'd1', project_id: P, observed_at: ago(3), observed_version: 'v1.103.0', ok: true }],
    session_page_views: [{ project_id: P, route: '/', ts: ago(1) }, { project_id: P, route: '/lessons/9', ts: ago(1) }],
    sdk_versions: [{ package: '@mushi-mushi/web', version: '1.33.0', deprecated: false }],
    project_members: [],
    project_settings: [],
    site_audits: [],
    synthetic_runs: [],
    end_user_sessions: [],
  }
}

function setup(opts: { failRead?: (t: string) => string | { code: string; message: string } | null; noThumbTable?: boolean } = {}) {
  const db: FakeDb = makeFakeDb(seed(), {
    failRead: (t) => (opts.noThumbTable && t === 'project_home_thumbnails' ? { code: '42P01', message: 'relation "project_home_thumbnails" does not exist' } : opts.failRead?.(t) ?? null),
  })
  ;(db as unknown as { storage: unknown }).storage = {
    from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://x.supabase.co/sign/${path}?token=t` }, error: null }) }),
  }
  state.db = db
  state.accessible = [P]
  state.roles = {}
  state.params = { id: P }
  state.background = []
  state.captures = []
  state.pipelineFails = false
  state.firecrawl = null
  const app = new FakeApp()
  routes.registerProjectHomeRoutes(app as never, {
    now: () => NOW,
    // The mocked pipeline.ts above.
    readPipeline: routes.defaultProjectHomeDeps.readPipeline,
    resolveFirecrawl: (async () => state.firecrawl) as never,
    captureThumbnail: (async (_db: unknown, _id: string, url: string) => {
      state.captures.push(url)
      return `${P}/home.png`
    }) as never,
    lookupUser: async () => ({ name: 'Kenji', avatarUrl: 'https://avatars.githubusercontent.com/u/1' }),
  })
  return { app, db }
}

describe('GET /v1/admin/projects/:id/home', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hides another team\'s app', async () => {
    const { app } = setup()
    state.accessible = []
    expect((await app.call('GET', '/v1/admin/projects/:id/home')).status).toBe(404)
  })

  it('returns every section with exact counts and plain links', async () => {
    const { app } = setup()
    const res = await app.call('GET', '/v1/admin/projects/:id/home')
    expect(res.status).toBe(200)
    const d = res.body.data!
    const health = Object.fromEntries((d.health.data as Array<{ id: string }>).map((h) => [h.id, h])) as Record<string, any>
    expect(health.site).toMatchObject({ light: 'bad', headline: '1 page broken' })
    expect(health.errors).toMatchObject({ light: 'bad', headline: '1 critical' })
    expect(health.sdk).toMatchObject({ light: 'good' })
    expect(health.ci).toMatchObject({ light: 'good', label: 'CI on main' })

    expect(d.app.data).toMatchObject({ name: 'glot.it', liveUrl: 'https://glot.it', platforms: ['web', 'ios'], version: { value: 'v1.103.0' } })
    expect(d.release.status).toBe('ok')
    expect(d.release.data.train).toMatchObject({ state: 'testing', prNumber: 812, active: true })
    // Open reports only (report 3 is fixed): 1 critical, 1 medium, 1 unrated.
    expect(d.release.data.waiting).toEqual({ counts: { critical: 1, high: 0, medium: 1, low: 0, unrated: 1 }, total: 3 })

    const needs = d.needsYou.data as Array<{ id: string; text: string }>
    expect(needs.map((n) => n.id)).toEqual(['site_broken', 'critical_waiting', 'pipeline_hold', 'sdk_upgrade'])
    expect(needs.find((n) => n.id === 'pipeline_hold')!.text).toBe('45 PRs: Opus says hold; a person decides.')

    expect(d.access.data).toMatchObject({
      repo: { url: 'https://github.com/kensaurus/glot.it', branch: 'main' },
      members: { total: 1, people: [{ name: 'Kenji', role: 'owner' }] },
      sdk: { version: '1.30.0', latest: '1.33.0', status: 'outdated' },
      keysTotal: 1,
    })
    // Labels and last use only: never a key, prefix or hash.
    expect(JSON.stringify(d.access.data.keys)).not.toMatch(/key_prefix|hash|mushi_/)
    expect(d.week.data.find((r: { id: string }) => r.id === 'reports')).toMatchObject({ thisWeek: 3, lastWeek: 1 })
    expect((d.activity.data as Array<{ text: string }>).map((l) => l.text)).toContain('1 fix merged today')
    expect(d.sitemap.status).toBe('ok')
  })

  it('a failed read makes only its own section an error', async () => {
    const { app } = setup({ failRead: (t) => (t === 'site_watches' ? 'site_watches: timeout' : null) })
    state.pipelineFails = true
    const res = await app.call('GET', '/v1/admin/projects/:id/home')
    expect(res.status).toBe(200)
    const d = res.body.data!
    const site = (d.health.data as Array<{ id: string; status: string; light: string }>).find((h) => h.id === 'site')!
    expect(site).toMatchObject({ status: 'error', light: 'off' })
    expect(d.release).toMatchObject({ status: 'error', data: null })
    expect(d.release.error).toContain('timeout')
    expect(d.partial).toEqual(['pipeline'])
    expect(d.access.status).toBe('ok')
    // Without a site signal, Needs you does not claim the site is fine or broken.
    expect((d.needsYou.data as Array<{ id: string }>).some((n) => n.id === 'site_broken')).toBe(false)
  })

  it('answers before the thumbnail table exists, falling back to the icon', async () => {
    const { app } = setup({ noThumbTable: true })
    state.firecrawl = { key: 'fc-own', source: 'byok' }
    const res = await app.call('GET', '/v1/admin/projects/:id/home')
    expect(res.status).toBe(200)
    expect(res.body.data!.app.data).toMatchObject({ thumbnail: null, thumbnailState: { available: false, canRefresh: false } })
    expect(state.background).toEqual([])
  })

  it('captures on view with the watch on and an own key; never on the platform key', async () => {
    const { app } = setup()
    state.firecrawl = { key: 'fc-platform', source: 'env' }
    await app.call('GET', '/v1/admin/projects/:id/home')
    expect(state.background).toEqual([])
    state.firecrawl = { key: 'fc-own', source: 'byok' }
    await app.call('GET', '/v1/admin/projects/:id/home')
    expect(state.background).toEqual(['home-thumbnail-auto'])
  })

  it('signs a stored thumbnail for the card', async () => {
    const { app, db } = setup()
    db.table('project_home_thumbnails').push({ project_id: P, storage_path: `${P}/home.png`, page_url: 'https://glot.it', captured_at: ago(1), last_attempt_at: ago(1), last_error: null })
    const res = await app.call('GET', '/v1/admin/projects/:id/home')
    expect(res.body.data!.app.data.thumbnail).toMatchObject({ url: `https://x.supabase.co/sign/${P}/home.png?token=t`, pageUrl: 'https://glot.it' })
  })
})

describe('POST /v1/admin/projects/:id/home/thumbnail', () => {
  it('refuses viewers and apps without their own Firecrawl key', async () => {
    const { app } = setup()
    state.roles[P] = 'viewer'
    expect((await app.call('POST', '/v1/admin/projects/:id/home/thumbnail')).status).toBe(403)
    state.roles[P] = 'member'
    state.firecrawl = { key: 'fc-platform', source: 'env' }
    const res = await app.call('POST', '/v1/admin/projects/:id/home/thumbnail')
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('FIRECRAWL_KEY_REQUIRED')
    expect(state.captures).toEqual([])
  })

  it('captures once, then waits out the 10-minute gap', async () => {
    const { app } = setup()
    state.firecrawl = { key: 'fc-own', source: 'byok' }
    const first = await app.call('POST', '/v1/admin/projects/:id/home/thumbnail')
    expect(first.status).toBe(200)
    expect(first.body.data).toMatchObject({ pageUrl: 'https://glot.it' })
    const second = await app.call('POST', '/v1/admin/projects/:id/home/thumbnail')
    expect(second.status).toBe(429)
    expect(state.captures).toEqual(['https://glot.it'])
  })
})
