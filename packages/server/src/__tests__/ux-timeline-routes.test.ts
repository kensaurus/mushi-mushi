/**
 * FILE: ux-timeline-routes.test.ts
 * PURPOSE: ADR 0072 through the real handlers on an in-memory database:
 *            - the scorecard's /score reuses an earlier verdict for the same
 *              capture with NO model call, stores it as cached at $0, and
 *              totals the run's cost;
 *            - a changed capture is scored by the model and priced;
 *            - the timeline reads for members only, pins only for non-viewers,
 *              and falls back to UX runs when the app has no releases;
 *            - start_ux_run's route starts nothing.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { scoreCacheKey } from '../../supabase/functions/_shared/ux-score-cache.ts'
import { UX_DIMENSIONS, UX_SCORECARD_PROMPT_VERSION } from '../../supabase/functions/_shared/ux-scorecard.ts'

const P = '1a000000-0000-4000-8000-000000000000'
const OTHER = '1b000000-0000-4000-8000-000000000000'
const RUN = '20261127-091500-ab3d'
const SHOT = 'a1b2c3d4e5f60718'

const state = vi.hoisted(() => ({
  db: null as unknown,
  members: new Set<string>(),
  role: null as string | null,
  modelCalls: 0,
}))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => null }))
vi.mock('../../supabase/functions/_shared/quota.ts', () => ({ checkIngestQuota: async () => ({ allowed: true }) }))
vi.mock('../../supabase/functions/_shared/report-classification.ts', () => ({ queueReportClassification: async () => null }))
vi.mock('../../supabase/functions/_shared/tenant-observability.ts', () => ({ claimTenantRateLimit: async () => ({ allowed: true }) }))
vi.mock('../../supabase/functions/_shared/llm-cost.ts', () => ({ priceLlmCall: async () => ({ costUsd: 0.0125 }) }))
vi.mock('../../supabase/functions/_shared/llm-failover.ts', () => ({
  withAnthropicOrOpenAi: async () => {
    state.modelCalls++
    const scores = Object.fromEntries(UX_DIMENSIONS.map((d) => [d, 8]))
    return { result: { text: JSON.stringify({ page: 'Settings', scores, issues: [], claims: [] }), usage: { inputTokens: 1000, outputTokens: 200 } }, model: 'claude-sonnet-5', usedProvider: 'anthropic' }
  },
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

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
type Handler = (c: unknown) => Promise<unknown>

/** A real Response (the routes test `instanceof Response`) that keeps the JSON payload readable. */
class JsonRes extends Response {
  constructor(
    readonly payload: unknown,
    status: number,
  ) {
    super(null, { status })
  }
}

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  private add(method: string) {
    return (path: string, ...handlers: Handler[]) => this.routes.push({ method, path, handler: handlers[handlers.length - 1] })
  }
  get = this.add('GET')
  post = this.add('POST')
  put = this.add('PUT')
  patch = this.add('PATCH')
  async call(method: string, path: string, params: Record<string, string>, body?: unknown, query: Record<string, string> = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const c = {
      req: { json: async () => body, param: (k: string) => params[k], query: (k: string) => query[k] },
      get: (k: string) => ({ userId: 'u1', authMethod: 'apiKey' })[k as 'userId'],
      json: (b: unknown, status = 200) => new JsonRes(b, status),
    }
    const r = (await route.handler(c)) as JsonRes
    return { status: r.status, body: r.payload as Res['body'] }
  }
}

const app = new FakeApp()
beforeAll(async () => {
  const sc = await import('../../supabase/functions/api/routes/ux-scorecard.ts')
  const tl = await import('../../supabase/functions/api/routes/ux-timeline.ts')
  sc.registerUxScorecardRoutes(app as never)
  tl.registerUxTimelineRoutes(app as never)
})

const facts = {
  key: '/settings',
  path: '/settings',
  label: 'Settings',
  title: 'Settings',
  headings: ['Settings'],
  text: 'Checks: 7 of 7 passed',
  controls: ['Save'],
  settleMs: 900,
  axe: { critical: 0, serious: 0, rules: [] },
  overflowX: false,
  consoleErrors: 0,
  cls: 0,
  viewport: { width: 1440, height: 900 },
}

let db: FakeDb
beforeEach(() => {
  db = makeFakeDb({
    ux_runs: [
      { id: 'run-new', project_id: P, local_run_id: RUN, kind: 'scorecard', status: 'running', start_url: 'https://app.example', findings: null, started_at: '2026-11-27T09:15:00Z' },
      { id: 'run-old', project_id: P, local_run_id: '20261120-091500-zz11', kind: 'scorecard', status: 'done', start_url: 'https://app.example', findings: null, started_at: '2026-11-20T09:15:00Z' },
    ],
    ux_surfaces: [],
    reports: [],
    releases: [],
    ux_baselines: [],
    ux_iterations: [],
    project_settings: [],
  })
  state.db = db
  state.members = new Set([P])
  state.role = null
  state.modelCalls = 0
})

const scorePath = '/v1/admin/projects/:pid/ux-scorecard/:runId/score'

describe('POST …/ux-scorecard/:runId/score (P8 verdict cache)', () => {
  async function seedEarlierVerdict(text = facts.text) {
    const scores = Object.fromEntries(UX_DIMENSIONS.map((d) => [d, 9]))
    db.table('ux_surfaces').push({
      id: 's-old',
      run_id: 'run-old',
      project_id: P,
      surface_key: 'settings',
      kind: 'page',
      path: '/settings',
      label: 'Settings',
      score: 9,
      scorecard: { key: '/settings', page: 'Settings', scores, why: {}, capped: {}, overall: 9, issues: [], claims: [], promptVersion: UX_SCORECARD_PROMPT_VERSION },
      capture_hash: await scoreCacheKey({ ...facts, text }, SHOT),
      judge_cached: false,
      cost_usd: 0.02,
      updated_at: new Date().toISOString(),
    })
  }

  it('reuses the earlier verdict with no model call, stores it as cached at $0, and totals the run', async () => {
    await seedEarlierVerdict()
    const res = await app.call('POST', scorePath, { pid: P, runId: RUN }, { facts, shots: [], shot_hash: SHOT })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ cached: true, cost_usd: 0, model: null })
    expect(state.modelCalls).toBe(0)
    const row = db.table('ux_surfaces').find((r) => r.run_id === 'run-new')
    expect(row).toMatchObject({ judge_cached: true, cost_usd: 0, score: 9, capture_hash: await scoreCacheKey(facts, SHOT) })
    expect(db.table('ux_runs').find((r) => r.id === 'run-new')).toMatchObject({ cost_usd: 0, cost: { judged: 0, cached: 1, unpriced: 0 } })
  })

  it('scores a changed page with the model and records its price', async () => {
    await seedEarlierVerdict('Checks: Not run yet')
    const res = await app.call('POST', scorePath, { pid: P, runId: RUN }, { facts, shots: [], shot_hash: SHOT })
    expect(res.status).toBe(200)
    expect(state.modelCalls).toBe(1)
    expect(res.body.data).toMatchObject({ cached: false, cost_usd: 0.0125 })
    expect(db.table('ux_surfaces').find((r) => r.run_id === 'run-new')).toMatchObject({ judge_cached: false, cost_usd: 0.0125, score: 8 })
    expect(db.table('ux_runs').find((r) => r.id === 'run-new')).toMatchObject({ cost_usd: 0.0125, cost: { judged: 1, cached: 0 } })
  })

  it('always calls the model when the CLI sends no shot hash, or asks to rescore', async () => {
    await seedEarlierVerdict()
    await app.call('POST', scorePath, { pid: P, runId: RUN }, { facts, shots: [] })
    await app.call('POST', scorePath, { pid: P, runId: RUN }, { facts, shots: [], shot_hash: SHOT, rescore: true })
    expect(state.modelCalls).toBe(2)
  })

  it('never reuses another app’s verdict', async () => {
    await seedEarlierVerdict()
    db.table('ux_surfaces')[0].project_id = OTHER
    await app.call('POST', scorePath, { pid: P, runId: RUN }, { facts, shots: [], shot_hash: SHOT })
    expect(state.modelCalls).toBe(1)
  })
})

describe('timeline routes', () => {
  it('reads for members only', async () => {
    state.members = new Set([OTHER])
    const res = await app.call('GET', '/v1/admin/projects/:pid/timeline', { pid: P })
    expect(res.status).toBe(403)
  })

  it('falls back to UX runs when the app has no releases', async () => {
    db.table('ux_runs')[1].cost_usd = 0.3
    const res = await app.call('GET', '/v1/admin/projects/:pid/timeline', { pid: P }, undefined, { compact: '1' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ rail: 'runs', settings: { keep_releases: 24 } })
    const points = res.body.data!.points as Array<{ id: string; runs: string[]; cost_usd: number | null }>
    expect(points.map((p) => p.id)).toEqual(['run:run-old'])
    expect(points[0]).toMatchObject({ runs: ['20261120-091500-zz11'], cost_usd: 0.3 })
  })

  it('refuses a viewer’s pin and a malformed version', async () => {
    state.role = 'viewer'
    expect((await app.call('POST', '/v1/admin/projects/:pid/timeline/baselines', { pid: P }, { version: '1.0.0' })).status).toBe(403)
    state.role = 'member'
    const bad = await app.call('POST', '/v1/admin/projects/:pid/timeline/baselines', { pid: P }, { version: '../etc' })
    expect(bad.status).toBe(400)
  })

  it('answers start_ux_run with the console link and commands, and starts nothing', async () => {
    const before = JSON.stringify(db.table('ux_runs'))
    const res = await app.call('GET', '/v1/admin/projects/:pid/timeline/run-plan', { pid: P }, undefined, { kind: 'loop' })
    expect(res.body.data).toMatchObject({ started: false, kind: 'loop', console_path: '/ux-runs' })
    expect(JSON.stringify(db.table('ux_runs'))).toBe(before)
  })
})

describe('timeline settings and the opt-in pin on publish (ADR 0072)', () => {
  it('saves auto-pin (off by default) and reads it back', async () => {
    db.table('project_settings').push({ project_id: P, ux_baseline_keep_releases: 24 })
    let res = await app.call('GET', '/v1/admin/projects/:pid/timeline', { pid: P }, undefined, { compact: '1' })
    expect(res.body.data).toMatchObject({ settings: { keep_releases: 24, auto_pin: false } })
    res = await app.call('PATCH', '/v1/admin/projects/:pid/timeline/settings', { pid: P }, { auto_pin: true })
    expect(res.status).toBe(200)
    expect(db.table('project_settings')[0]).toMatchObject({ ux_baseline_auto_pin: true, ux_baseline_keep_releases: 24 })
    res = await app.call('GET', '/v1/admin/projects/:pid/timeline', { pid: P }, undefined, { compact: '1' })
    expect(res.body.data).toMatchObject({ settings: { auto_pin: true } })
  })

  it('refuses a viewer’s settings change and an empty one', async () => {
    state.role = 'viewer'
    expect((await app.call('PATCH', '/v1/admin/projects/:pid/timeline/settings', { pid: P }, { auto_pin: true })).status).toBe(403)
    state.role = 'member'
    expect((await app.call('PATCH', '/v1/admin/projects/:pid/timeline/settings', { pid: P }, {})).status).toBe(400)
  })

  it('pins nothing on publish unless the app opted in, and never throws', async () => {
    const { autoPinOnPublish } = await import('../../supabase/functions/_shared/ux-baseline-pin.ts')
    const pin = vi.fn(async () => ({ ok: true as const, pinned: 3, failed: 0, screens: 2 }))
    const release = { id: 'rel-1', project_id: P, version: '1.4.0' }
    expect(await autoPinOnPublish(db as never, release, pin)).toEqual({ pinned: 0, skipped: 'off' })
    expect(pin).not.toHaveBeenCalled()
    db.table('project_settings').push({ project_id: P, ux_baseline_auto_pin: true })
    expect(await autoPinOnPublish(db as never, release, pin)).toEqual({ pinned: 3 })
    expect(pin).toHaveBeenCalledWith(db, { projectId: P, version: '1.4.0', releaseId: 'rel-1', userId: null })
    const failing = vi.fn(async () => {
      throw new Error('storage down')
    })
    expect(await autoPinOnPublish(db as never, release, failing)).toEqual({ pinned: 0, skipped: 'error' })
  })

  it('copies each screen’s newest capture under baselines/ and records the release', async () => {
    const { pinBaselines } = await import('../../supabase/functions/_shared/ux-baseline-pin.ts')
    const copies: Array<[string, string]> = []
    ;(db as unknown as { storage: unknown }).storage = {
      from: () => ({
        copy: async (from: string, to: string) => (copies.push([from, to]), { error: null }),
        remove: async () => ({ error: null }),
      }),
    }
    db.table('ux_surfaces').push({
      run_id: 'run-old',
      project_id: P,
      surface_key: 'settings',
      kind: 'page',
      path: '/settings',
      label: 'Settings',
      status: 'baseline',
      score: 8,
      thumbs: { scorecard: ['settings/early.png', 'settings/settled.png'] },
      facts: { viewport: { width: 1440 } },
      cost_usd: 0.01,
    })
    const out = await pinBaselines(db as never, { projectId: P, version: '1.4.0', releaseId: 'rel-1', userId: null })
    expect(out).toEqual({ ok: true, pinned: 1, failed: 0, screens: 1 })
    expect(copies[0][0]).toBe(`${P}/run-old/scorecard/settings/settled.png`)
    expect(copies[0][1]).toMatch(new RegExp(`^${P}/baselines/settings/desktop/1\.4\.0-`))
    expect(db.table('ux_baselines')[0]).toMatchObject({ project_id: P, surface_key: 'settings', viewport: 'desktop', version: '1.4.0', release_id: 'rel-1', score: 8, created_by: null })
  })
})
