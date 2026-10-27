/**
 * FILE: work-routes.test.ts
 * PURPOSE: Local worker routes (ADR 0048, api/routes/work.ts) through the
 *          real handlers on an in-memory database that enforces the
 *          one-active-claim-per-report index:
 *            - /v1/worker/* refuse a console session and an mcp key;
 *            - the heartbeat registers the host and its lanes (initial
 *              settings on first sight only), refuses a viewer's app, and
 *              answers each lane with the seven closed verbs only;
 *            - the lease race: two lanes claiming at once never share a report;
 *            - the queue goes first, then ranked reports; a report with a cloud
 *              dispatch in flight or a live attempt is skipped;
 *            - an expired lease is ended as infra and its report goes back to
 *              the front of the queue (once);
 *            - done: an infra failure is requeued once, a second one is not;
 *            - the console: a PATCH with an unknown setting is refused; a
 *              worker key is minted only for apps the caller reaches.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  callerProjectIds: async () => [],
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))

let work: typeof import('../../supabase/functions/api/routes/work.ts')
beforeAll(async () => {
  work = await import('../../supabase/functions/api/routes/work.ts')
})

const NOW = new Date('2026-10-27T12:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const KEY = '9000000a-0000-4000-8000-000000000000'
const HOST_HASH = 'a'.repeat(64)
const R = (n: number) => `2000000${n}-0000-4000-8000-000000000000`

type Res = { status: number; body: { ok: boolean; data?: any; error?: { code: string; message: string } } }
type Handler = (c: unknown) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handler: h[h.length - 1] }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handler: h[h.length - 1] }) }
  put(path: string, ...h: Handler[]) { this.routes.push({ method: 'PUT', path, handler: h[h.length - 1] }) }
  patch(path: string, ...h: Handler[]) { this.routes.push({ method: 'PATCH', path, handler: h[h.length - 1] }) }
  delete(path: string, ...h: Handler[]) { this.routes.push({ method: 'DELETE', path, handler: h[h.length - 1] }) }
  async call(method: string, path: string, opts: { body?: unknown; query?: Record<string, string>; params?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'apiKey', apiKeyScopes: ['worker:run'], apiKeyId: KEY, ...opts.vars }
    const c = {
      req: {
        json: async () => opts.body ?? {},
        param: (k: string) => opts.params?.[k],
        header: () => undefined,
        query: (k: string) => opts.query?.[k],
      },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      header: () => {},
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

function setup(seed: Record<string, Array<Record<string, unknown>>> = {}, roles: Record<string, string | null> = { [P1]: 'member', [P2]: 'member' }) {
  const db: FakeDb = makeFakeDb(
    {
      projects: [{ id: P1, name: 'glot.it' }, { id: P2, name: 'yen-yen' }],
      ...seed,
    },
    {
      autoId: true,
      uniques: { work_queue: ['lane_id', 'report_id'], work_lanes: ['host_id', 'name'] },
      partialUniques: { work_claims: { keys: ['report_id'], where: (r) => r.status === 'active' } },
    },
  )
  const app = new FakeApp()
  const inserted: Array<Record<string, unknown>> = []
  work.registerWorkRoutes(app as never, {
    ...work.defaultWorkRouteDeps,
    getServiceClient: () => db as never,
    access: async (_c, _db, _u, projectId) => {
      const role = roles[projectId] ?? null
      return { allowed: role !== null, role: role as never }
    },
    projectIds: async () => Object.keys(roles).filter((p) => roles[p]),
    claimRateLimit: async () => ({ allowed: true }),
    logAudit: (async () => {}) as never,
    now: () => NOW,
  })
  return { db, app, inserted }
}

const heartbeatBody = (lanes: Array<Record<string, unknown>>, claims: string[] = []) => ({
  host: { hostId: HOST_HASH, hostname: 'alienware', platform: 'wsl2', version: '0.31.0' },
  status: { state: 'working', agents: 0 },
  lanes,
  claims,
})

async function registered(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const s = setup(seed)
  const hb = await s.app.call('POST', '/v1/worker/heartbeat', {
    body: heartbeatBody([
      { name: 'glot-a', projectId: P1, status: {} },
      { name: 'glot-b', projectId: P1, status: {} },
    ]),
  })
  expect(hb.status).toBe(200)
  const lanes = hb.body.data.lanes as Array<{ id: string; name: string }>
  return { ...s, laneA: lanes.find((l) => l.name === 'glot-a')!.id, laneB: lanes.find((l) => l.name === 'glot-b')!.id }
}

const report = (n: number, over: Record<string, unknown> = {}) => ({
  id: R(n),
  project_id: P1,
  status: 'classified',
  severity: 'medium',
  summary: `bug ${n}`,
  created_at: `2026-10-2${n}T00:00:00Z`,
  ...over,
})

describe('worker routes take only a worker key', () => {
  it('refuses a console session and an mcp key', async () => {
    const { app } = setup()
    for (const vars of [{ authMethod: 'jwt', apiKeyScopes: undefined }, { authMethod: 'apiKey', apiKeyScopes: ['mcp:write'] }]) {
      for (const path of ['/v1/worker/heartbeat', '/v1/worker/claim', '/v1/worker/revoke']) {
        const res = await app.call('POST', path, { body: heartbeatBody([]), vars })
        expect(res.status).toBe(403)
        expect(res.body.error?.code).toBe('WORKER_KEY_REQUIRED')
      }
    }
  })
})

describe('POST /v1/worker/heartbeat', () => {
  it('registers the host and lanes, takes initial settings once, refuses a viewer app', async () => {
    const s = setup({}, { [P1]: 'member', [P2]: 'viewer' })
    const res = await s.app.call('POST', '/v1/worker/heartbeat', {
      body: heartbeatBody([
        { name: 'glot', projectId: P1, status: { state: 'idle' }, initial: { model: 'claude-opus-5-5-medium', paused: true } },
        { name: 'yen', projectId: P2, status: {} },
      ]),
    })
    expect(res.status).toBe(200)
    expect(s.db.table('work_hosts')).toHaveLength(1)
    expect(s.db.table('work_hosts')[0]).toMatchObject({ api_key_id: KEY, host_id: HOST_HASH, owner_user_id: 'u1' })
    expect(res.body.data.refused).toEqual([{ name: 'yen', reason: expect.stringMatching(/viewer/) }])
    const [lane] = res.body.data.lanes
    expect(Object.keys(lane.config).sort()).toEqual(['concurrency', 'drain', 'mode', 'model', 'paused', 'prune_own', 'stop_at'])
    expect(lane.config).toMatchObject({ model: 'claude-opus-5-5-medium', paused: true })
    expect(res.body.data.guards).toEqual({ max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 })

    // The console changed the model; a later heartbeat's initial settings do not override it.
    s.db.table('work_lanes')[0]!.model = 'grok-4.7-xhigh-fast'
    const again = await s.app.call('POST', '/v1/worker/heartbeat', {
      body: heartbeatBody([{ name: 'glot', projectId: P1, status: {}, initial: { model: 'claude-opus-5-5-medium' } }]),
    })
    expect(again.body.data.lanes[0].config.model).toBe('grok-4.7-xhigh-fast')
    expect(s.db.table('work_lanes').filter((l) => l.name === 'glot')).toHaveLength(1)
  })

  it('stops a revoked host', async () => {
    const s = setup({ work_hosts: [{ id: 'h1', owner_user_id: 'u1', api_key_id: KEY, host_id: HOST_HASH, hostname: 'x', platform: 'linux', revoked_at: '2026-10-27T11:00:00Z', guards: {}, status: {} }] })
    const res = await s.app.call('POST', '/v1/worker/heartbeat', { body: heartbeatBody([]) })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('HOST_REVOKED')
  })
})

describe('POST /v1/worker/claim', () => {
  it('the lease race: two lanes claiming at once never share a report', async () => {
    const s = await registered({ reports: [report(1, { severity: 'high' }), report(2)] })
    const [a, b] = await Promise.all([
      s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneA } }),
      s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneB } }),
    ])
    const got = [a.body.data.claim?.report.id, b.body.data.claim?.report.id]
    expect(new Set(got)).toEqual(new Set([R(1), R(2)]))
    expect(s.db.table('work_claims').filter((c) => c.status === 'active')).toHaveLength(2)
  })

  it('with one free report, one claimer wins and the other gets nothing', async () => {
    const s = await registered({ reports: [report(1)] })
    const [a, b] = await Promise.all([
      s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneA } }),
      s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneB } }),
    ])
    const claims = [a.body.data.claim, b.body.data.claim].filter(Boolean)
    expect(claims).toHaveLength(1)
    expect(claims[0].report.id).toBe(R(1))
    expect(s.db.table('work_claims')).toHaveLength(1)
  })

  it('takes the queue first, skips in-flight cloud dispatches and live attempts', async () => {
    const s = await registered({
      reports: [report(1, { severity: 'critical' }), report(2), report(3), report(4, { severity: 'low' })],
      fix_dispatch_jobs: [{ id: 'j1', report_id: R(1), project_id: P1, status: 'queued' }],
      fix_attempts: [{ id: 'f1', report_id: R(2), project_id: P1, status: 'running', agent: 'cursor_cloud', pr_url: null, pr_state: null, merged_at: null, error: null, created_at: '2026-10-27T10:00:00Z' }],
    })
    s.db.table('work_queue').push({ id: 'q1', lane_id: s.laneA, project_id: P1, report_id: R(4), position: 0, source: 'console', created_at: '2026-10-27T00:00:00Z' })
    const first = await s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneA } })
    expect(first.body.data.claim).toMatchObject({ fromQueue: true, report: { id: R(4) } })
    expect(s.db.table('work_queue')).toHaveLength(0)
    const second = await s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneB } })
    // R(1) has a cloud dispatch queued and R(2) a running agent: R(3) is next.
    expect(second.body.data.claim).toMatchObject({ fromQueue: false, report: { id: R(3) } })
  })

  it('a paused lane takes nothing', async () => {
    const s = await registered({ reports: [report(1)] })
    s.db.table('work_lanes').find((l) => l.id === s.laneA)!.paused = true
    const res = await s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneA } })
    expect(res.body.data).toEqual({ claim: null, reason: 'The lane is paused.' })
  })

  it('an expired lease ends as infra and its report goes back to the front of the queue', async () => {
    const s = await registered({ reports: [report(1), report(2, { severity: 'critical' })] })
    const hostId = s.db.table('work_hosts')[0]!.id
    s.db.table('work_claims').push({
      id: 'old', lane_id: s.laneA, host_id: hostId, project_id: P1, report_id: R(1), status: 'active', from_queue: false,
      claimed_at: '2026-10-27T10:00:00Z', lease_until: '2026-10-27T11:00:00Z', auto_requeued: false,
    })
    const res = await s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneA } })
    const old = s.db.table('work_claims').find((c) => c.id === 'old')!
    expect(old).toMatchObject({ status: 'expired', outcome: 'lease_expired', failure_kind: 'infra', auto_requeued: true })
    // Back at the front: it beats the critical report.
    expect(res.body.data.claim).toMatchObject({ fromQueue: true, report: { id: R(1) } })
  })
})

describe('POST /v1/worker/claims/:id/done', () => {
  it('requeues an infra failure once, and not a second one', async () => {
    const s = await registered({ reports: [report(1)] })
    const first = await s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneA } })
    const id1 = first.body.data.claim.id
    const done1 = await s.app.call('POST', '/v1/worker/claims/:id/done', { params: { id: id1 }, body: { outcome: 'failed', failureKind: 'infra', detail: 'git fetch: Permission denied' } })
    expect(done1.body.data).toEqual({ requeued: true })
    expect(s.db.table('work_queue').map((q) => q.report_id)).toEqual([R(1)])

    const second = await s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneA } })
    expect(second.body.data.claim.report.id).toBe(R(1))
    const done2 = await s.app.call('POST', '/v1/worker/claims/:id/done', { params: { id: second.body.data.claim.id }, body: { outcome: 'failed', failureKind: 'infra' } })
    expect(done2.body.data).toEqual({ requeued: false })
    expect(s.db.table('work_queue')).toHaveLength(0)

    // Ended claims cannot be ended twice.
    const again = await s.app.call('POST', '/v1/worker/claims/:id/done', { params: { id: id1 }, body: { outcome: 'no_change' } })
    expect(again.status).toBe(409)
  })

  it("refuses another worker's claim", async () => {
    const s = await registered({ reports: [report(1)] })
    const c = await s.app.call('POST', '/v1/worker/claim', { body: { laneId: s.laneA } })
    const res = await s.app.call('POST', '/v1/worker/claims/:id/done', { params: { id: c.body.data.claim.id }, body: { outcome: 'no_change' }, vars: { apiKeyId: '9000000b-0000-4000-8000-000000000000' } })
    expect([res.status, res.body.error?.code, res.body.error?.message]).toEqual([404, 'NOT_FOUND', expect.any(String)])
  })
})

describe('console routes', () => {
  it('PATCH refuses an unknown lane setting and a viewer', async () => {
    const s = await registered()
    const bad = await s.app.call('PATCH', '/v1/admin/work/lanes/:id', { params: { id: s.laneA }, body: { paused: true, command: 'echo hi' }, vars: { authMethod: 'jwt' } })
    expect(bad.status).toBe(400)
    const ok = await s.app.call('PATCH', '/v1/admin/work/lanes/:id', { params: { id: s.laneA }, body: { paused: true }, vars: { authMethod: 'jwt' } })
    expect(ok.body.data.config.paused).toBe(true)
  })

  it('PUT queue sets the order and refuses another app\'s report', async () => {
    const s = await registered({ reports: [report(1), report(2), report(3, { project_id: P2 })] })
    const res = await s.app.call('PUT', '/v1/admin/work/lanes/:id/queue', { params: { id: s.laneA }, body: { reportIds: [R(2), R(1)] }, vars: { authMethod: 'jwt' } })
    expect(res.body.data.reportIds).toEqual([R(2), R(1)])
    const foreign = await s.app.call('PUT', '/v1/admin/work/lanes/:id/queue', { params: { id: s.laneA }, body: { reportIds: [R(3)], append: true }, vars: { authMethod: 'jwt' } })
    expect(foreign.status).toBe(422)
  })

  it('mints a worker:run account key only for apps the caller reaches as a non-viewer', async () => {
    const s = setup({}, { [P1]: 'member', [P2]: null })
    const refused = await s.app.call('POST', '/v1/admin/work/key', { body: { projectIds: [P1, P2] }, vars: { authMethod: 'apiKey', apiKeyScopes: ['mcp:write'] } })
    expect(refused.status).toBe(403)
    expect(s.db.table('project_api_keys')).toHaveLength(0)
    const ok = await s.app.call('POST', '/v1/admin/work/key', { body: { projectIds: [P1], label: 'alienware' }, vars: { authMethod: 'jwt' } })
    expect(ok.status).toBe(201)
    expect(s.db.table('project_api_keys')[0]).toMatchObject({ scopes: ['worker:run'], is_org_scoped: true, allowed_project_ids: [P1], owner_user_id: 'u1', label: 'worker:alienware' })
    expect(ok.body.data.key).toMatch(/^mushi_/)
    expect(s.db.table('project_api_keys')[0]!.key_hash).not.toBe(ok.body.data.key)
  })
})
