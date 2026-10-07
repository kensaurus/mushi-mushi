/**
 * FILE: ux-runs-routes.test.ts
 * PURPOSE: Plan 021 console mirror routes, driven through the real handlers on
 *          an in-memory database: a snapshot PUT is idempotent (run, screens
 *          and attempts upsert), a non-member is refused, screenshot names that
 *          try to leave the run are refused, the run reads back with signed
 *          image URLs, and "File as bug" files one ux_loop report per screen.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1a000000-0000-4000-8000-000000000000'
const OTHER = '1b000000-0000-4000-8000-000000000000'
const RUN = '20261006-011207-qafu'

const state = vi.hoisted(() => ({
  db: null as unknown,
  members: new Set<string>(),
  role: null as string | null,
  signedUploads: [] as string[],
}))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) =>
    c.json({ ok: false, error: { code, message } }, status),
  callerCanAccessProject: async (_c: unknown, _db: unknown, _u: string, projectId: string) => ({
    allowed: state.members.has(projectId),
    role: state.role,
  }),
}))

let routes: typeof import('../../supabase/functions/api/routes/ux-runs.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/ux-runs.ts')
})

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
type Handler = (c: unknown) => Promise<unknown>

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  private add(method: string) {
    return (path: string, ...handlers: Handler[]) => this.routes.push({ method, path, handler: handlers[handlers.length - 1] })
  }
  get = this.add('GET')
  post = this.add('POST')
  put = this.add('PUT')
  async call(method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const c = {
      req: { json: async () => body, param: (k: string) => params[k], query: () => undefined },
      get: (k: string) => ({ userId: 'u1', authMethod: 'apiKey' })[k as 'userId'],
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

const BASE = '/v1/admin/projects/:pid/ux-runs'

function snapshot(status: 'running' | 'done' = 'running') {
  return {
    status,
    agent: 'claude-code',
    model: null,
    judge_model: null,
    branch: `mushi-ux/${RUN}`,
    base_sha: '57cd809c',
    cli_version: null,
    started_at: '2026-10-06T01:12:07.000Z',
    finished_at: status === 'done' ? '2026-10-06T01:13:19.000Z' : null,
    surfaces: [
      {
        surface_key: 'about-69bbc6',
        kind: 'page',
        path: '/about',
        label: 'About',
        status: 'reverted',
        note: 'Rolled back: mobile: the page now scrolls sideways.',
        penalty_before: 6,
        penalty_after: null,
        probe_before: { axe: [{ id: 'color-contrast', impact: 'serious', help: 'Contrast', count: 2 }], overflowX: false, smallTargets: 1, consoleErrors: 0, cls: 0 },
        probe_after: null,
        judge: null,
        thumbs: { before: 'about-69bbc6/before-desktop.png', after: null, diff: null },
        iterations: [
          { n: 1, agent: 'claude-code', model: null, duration_ms: 20000, outcome: 'rejected', reason: 'scrolls sideways', commit_sha: null, pixel_diff: { desktop: 0.2 } },
        ],
      },
    ],
  }
}

function setup(): { db: FakeDb; app: FakeApp } {
  const db = makeFakeDb(
    { ux_runs: [], ux_surfaces: [], ux_iterations: [], reports: [] },
    { autoId: true, uniques: { ux_runs: ['project_id', 'local_run_id'], ux_surfaces: ['run_id', 'surface_key'], ux_iterations: ['surface_id', 'n'] } },
  )
  ;(db as unknown as { storage: unknown }).storage = {
    from: () => ({
      createSignedUploadUrl: async (path: string) => {
        state.signedUploads.push(path)
        return { data: { signedUrl: `https://storage.test/${path}?token=t`, token: 't' }, error: null }
      },
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://storage.test/read/${path}` })), error: null }),
    }),
  }
  state.db = db
  state.members = new Set([P])
  state.role = null
  state.signedUploads = []
  const app = new FakeApp()
  routes.registerUxRunsRoutes(app as never)
  return { db, app }
}

describe('ux-runs routes', () => {
  it('upserts a snapshot idempotently and reads it back with signed image URLs', async () => {
    const { db, app } = setup()
    expect((await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, snapshot())).status).toBe(200)
    expect((await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, snapshot('done'))).status).toBe(200)
    expect(db.table('ux_runs')).toHaveLength(1)
    expect(db.table('ux_runs')[0]).toMatchObject({ status: 'done', counts: { reverted: 1 } })
    expect(db.table('ux_surfaces')).toHaveLength(1)
    expect(db.table('ux_iterations')).toHaveLength(1)
    const runId = db.table('ux_runs')[0].id as string
    expect(db.table('ux_surfaces')[0].thumb_before).toBe(`${P}/${runId}/about-69bbc6/before-desktop.png`)

    const detail = await app.call('GET', `${BASE}/:runId`, { pid: P, runId: RUN })
    const surfaces = detail.body.data?.surfaces as Array<{ thumb_before_url: string | null }>
    expect(surfaces[0].thumb_before_url).toBe(`https://storage.test/read/${P}/${runId}/about-69bbc6/before-desktop.png`)
  })

  it('refuses a caller who is not a member, and a malformed snapshot', async () => {
    const { db, app } = setup()
    expect((await app.call('PUT', `${BASE}/:runId`, { pid: OTHER, runId: RUN }, snapshot())).status).toBe(403)
    expect((await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, { status: 'running' })).status).toBe(400)
    expect((await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: '../x' }, snapshot())).status).toBe(400)
    expect(db.table('ux_runs')).toHaveLength(0)
  })

  it('lets a viewer read runs but not sync, upload or file them', async () => {
    const { db, app } = setup()
    expect((await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, snapshot())).status).toBe(200)
    state.role = 'viewer'
    expect((await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, snapshot('done'))).status).toBe(403)
    expect((await app.call('POST', `${BASE}/:runId/uploads`, { pid: P, runId: RUN }, { names: ['about-69bbc6/before-desktop.png'] })).status).toBe(403)
    expect((await app.call('POST', `${BASE}/:runId/surfaces/:key/report`, { pid: P, runId: RUN, key: 'about-69bbc6' }, {})).status).toBe(403)
    expect((await app.call('GET', `${BASE}/:runId`, { pid: P, runId: RUN })).status).toBe(200)
    expect(db.table('ux_runs')[0]).toMatchObject({ status: 'running' })
    expect(db.table('reports')).toHaveLength(0)
  })

  it('stores live progress and every attempt’s screenshots, and signs them on read', async () => {
    const { db, app } = setup()
    const snap = snapshot()
    const progress = { steps: 7, last_step: '[edit] app/about/page.tsx', files: ['app/about/page.tsx'], started_at: '2026-10-06T09:00:00.000Z', timeout_ms: 900_000 }
    Object.assign(snap, { phase: 'working', phase_detail: 'About, attempt 1 of 2', current_surface: 'about-69bbc6', current_attempt: 1, current_progress: progress, skill: 'enhance-mobile-native-feel', base_ref: 'origin/main' })
    Object.assign(snap.surfaces[0], { shots: { 'before-mobile': 'about-69bbc6/before-mobile.png', 'before-desktop': 'evil/before-desktop.png' } })
    Object.assign(snap.surfaces[0].iterations[0], { penalty_after: 3, shots: { 'after-mobile': 'about-69bbc6/iter1-after-mobile.png' } })
    expect((await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, snap)).status).toBe(200)
    const run = db.table('ux_runs')[0]
    expect(run).toMatchObject({ phase: 'working', current_surface: 'about-69bbc6', current_attempt: 1, current_progress: progress, skill: 'enhance-mobile-native-feel', base_ref: 'origin/main' })
    // A progress line longer than the column allows is refused, not truncated silently.
    const tooLong = snapshot()
    Object.assign(tooLong, { current_progress: { ...progress, files: Array.from({ length: 21 }, (_, i) => `f${i}.ts`) } })
    expect((await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, tooLong)).status).toBe(400)
    const runId = run.id as string
    expect(db.table('ux_surfaces')[0].thumbs).toEqual({ 'before-mobile': `${P}/${runId}/about-69bbc6/before-mobile.png` })
    expect(db.table('ux_iterations')[0]).toMatchObject({ penalty_after: 3, thumbs: { 'after-mobile': `${P}/${runId}/about-69bbc6/iter1-after-mobile.png` } })
    const detail = await app.call('GET', `${BASE}/:runId`, { pid: P, runId: RUN })
    const s0 = (detail.body.data?.surfaces as Array<{ thumb_urls: Record<string, string> }>)[0]
    expect(s0.thumb_urls['before-mobile']).toBe(`https://storage.test/read/${P}/${runId}/about-69bbc6/before-mobile.png`)
    const i0 = (detail.body.data?.iterations as Array<{ thumb_urls: Record<string, string> }>)[0]
    expect(i0.thumb_urls['after-mobile']).toContain('iter1-after-mobile.png')
  })

  it('mints upload URLs only inside the run, never for names that escape it', async () => {
    const { db, app } = setup()
    await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, snapshot())
    const runId = db.table('ux_runs')[0].id as string
    const bad = await app.call('POST', `${BASE}/:runId/uploads`, { pid: P, runId: RUN }, { names: ['../../other/before-desktop.png'] })
    expect(bad.status).toBe(400)
    const ok = await app.call('POST', `${BASE}/:runId/uploads`, { pid: P, runId: RUN }, { names: ['about-69bbc6/before-desktop.png'] })
    expect(ok.status).toBe(200)
    expect(state.signedUploads).toEqual([`${P}/${runId}/about-69bbc6/before-desktop.png`])
  })

  it('files one ux_loop report per screen and reuses it after', async () => {
    const { db, app } = setup()
    await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, snapshot())
    const first = await app.call('POST', `${BASE}/:runId/surfaces/:key/report`, { pid: P, runId: RUN, key: 'about-69bbc6' })
    expect(first.status).toBe(201)
    expect(db.table('reports')[0]).toMatchObject({ source: 'ux_loop', category: 'visual', status: 'classified', project_id: P })
    const again = await app.call('POST', `${BASE}/:runId/surfaces/:key/report`, { pid: P, runId: RUN, key: 'about-69bbc6' })
    expect(again.body.data).toMatchObject({ reused: true })
    expect(db.table('reports')).toHaveLength(1)
  })

  it('keeps one report when two clicks race', async () => {
    const { db, app } = setup()
    await app.call('PUT', `${BASE}/:runId`, { pid: P, runId: RUN }, snapshot())
    db.table('reports').push({ id: 'winner', project_id: P, source: 'ux_loop' })
    // The other request links its report between this one's insert and link.
    const from = (db as unknown as { from: (t: string) => unknown }).from.bind(db)
    ;(db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = from(t) as { insert?: (...a: unknown[]) => unknown }
      if (t === 'reports' && q.insert) {
        const insert = q.insert.bind(q)
        q.insert = (...a: unknown[]) => {
          db.table('ux_surfaces')[0].report_id = 'winner'
          return insert(...a)
        }
      }
      return q
    }
    const res = await app.call('POST', `${BASE}/:runId/surfaces/:key/report`, { pid: P, runId: RUN, key: 'about-69bbc6' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ report_id: 'winner', reused: true })
    expect(db.table('reports').map((r) => r.id)).toEqual(['winner'])
  })
})
