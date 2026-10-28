/**
 * FILE: work-status-routes.test.ts
 * PURPOSE: Worker visibility routes (ADR 0048 amendment 2026-10-28) through
 *          the real handlers on an in-memory database:
 *            - the heartbeat stores each run's stage and log lines, and
 *              answers `recheckAccount` only while a console request is newer
 *              than the machine's last account check;
 *            - GET /v1/admin/work/lanes carries the flags; GET …/stats counts
 *              the same ones for the sidebar badge;
 *            - "Stop this run" ends the claim (the next heartbeat reports it
 *              lost, so the machine stops the agent), only for the app's owner
 *              or an admin or the machine's owner, and is audited;
 *            - "Re-check the account" only for the machine's owner.
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

let NOW = new Date('2026-10-28T12:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const KEY = '9000000a-0000-4000-8000-000000000000'
const R1 = '20000001-0000-4000-8000-000000000000'
const CLAIM = '30000001-0000-4000-8000-000000000000'
const HOST_HASH = 'a'.repeat(64)

type Res = { status: number; body: { ok: boolean; data?: any; error?: { code: string; message: string } } }
type Handler = (c: unknown) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handler: h[h.length - 1] }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handler: h[h.length - 1] }) }
  put(path: string, ...h: Handler[]) { this.routes.push({ method: 'PUT', path, handler: h[h.length - 1] }) }
  patch(path: string, ...h: Handler[]) { this.routes.push({ method: 'PATCH', path, handler: h[h.length - 1] }) }
  delete(path: string, ...h: Handler[]) { this.routes.push({ method: 'DELETE', path, handler: h[h.length - 1] }) }
  async call(method: string, path: string, opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'apiKey', apiKeyScopes: ['worker:run'], apiKeyId: KEY, ...opts.vars }
    const c = {
      req: { json: async () => opts.body ?? {}, param: (k: string) => opts.params?.[k], header: () => undefined, query: (k: string) => opts.query?.[k] },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      header: () => {},
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

const console_ = (userId: string) => ({ vars: { userId, authMethod: 'jwt', apiKeyScopes: undefined } })

function setup(roles: Record<string, string> = { u1: 'member', u2: 'member', u3: 'admin' }) {
  const db: FakeDb = makeFakeDb(
    { projects: [{ id: P1, name: 'glot.it' }], reports: [{ id: R1, project_id: P1, status: 'classified', severity: 'high', summary: 'Total wrong', created_at: '2026-10-27T00:00:00Z' }] },
    { autoId: true, uniques: { work_queue: ['lane_id', 'report_id'], work_lanes: ['host_id', 'name'] }, partialUniques: { work_claims: { keys: ['report_id'], where: (r) => r.status === 'active' } } },
  )
  const app = new FakeApp()
  const audits: Array<{ action: string; resourceId?: string; metadata?: Record<string, unknown> }> = []
  let currentUser = 'u1'
  work.registerWorkRoutes(app as never, {
    ...work.defaultWorkRouteDeps,
    getServiceClient: () => db as never,
    access: async (c) => {
      currentUser = (c as { get: (k: string) => string }).get('userId')
      const role = roles[currentUser] ?? null
      return { allowed: role !== null, role: role as never }
    },
    projectIds: async () => [P1],
    claimRateLimit: async () => ({ allowed: true }),
    logAudit: (async (_db: unknown, _p: string, _u: string, action: string, _t: string, resourceId?: string, metadata?: Record<string, unknown>) => {
      audits.push({ action, resourceId, metadata })
    }) as never,
    now: () => NOW,
  })
  return { db, app, audits }
}

const hb = (runs: unknown[], claims: string[], checks: Record<string, unknown> = {}) => ({
  host: { hostId: HOST_HASH, hostname: 'alienware', platform: 'wsl2', version: '0.32.0' },
  status: { state: 'working', agents: runs.length, maxAgents: 4, load1: 37, cpus: 16, checks, slots: [] },
  lanes: [{ name: 'glot', projectId: P1, status: { state: 'working', runs: 3, inflight: runs } }],
  claims,
})

const stuckRun = { runId: CLAIM, kind: 'fix', reportId: R1, ageSec: 4 * 3600, stage: 'commit', stageSec: 4 * 3600 - 300, model: 'grok-4.7-xhigh-fast', log: ['commit: pnpm exec tsc --noEmit'] }

async function withStuckRun() {
  const s = setup()
  const first = await s.app.call('POST', '/v1/worker/heartbeat', { body: hb([], []) })
  const laneId = first.body.data.lanes[0].id as string
  const hostId = s.db.table('work_hosts')[0]!.id as string
  s.db.table('work_claims').push({
    id: CLAIM, lane_id: laneId, host_id: hostId, project_id: P1, report_id: R1, kind: 'fix', status: 'active', from_queue: false,
    claimed_at: new Date(NOW.getTime() - 4 * 3600_000).toISOString(), lease_until: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    finished_at: null, outcome: null, failure_kind: null, detail: null, pr_url: null, auto_requeued: false,
  })
  const second = await s.app.call('POST', '/v1/worker/heartbeat', { body: hb([stuckRun], [CLAIM], { cursor: { result: 'timed_out', ageSec: 300, detail: 'timed out after 90 s', account: null } }) })
  expect(second.body.data.renewed).toEqual([CLAIM])
  return { ...s, laneId, hostId }
}

describe('the heartbeat keeps the run telemetry', () => {
  it('stores the stage and log lines of each run', async () => {
    const s = await withStuckRun()
    const status = s.db.table('work_lanes')[0]!.status as { runs: number; inflight: Array<Record<string, unknown>> }
    expect(status.runs).toBe(3)
    expect(status.inflight[0]).toMatchObject({ runId: CLAIM, stage: 'commit', log: ['commit: pnpm exec tsc --noEmit'] })
    expect((s.db.table('work_hosts')[0]!.status as Record<string, unknown>).checks).toMatchObject({ cursor: { result: 'timed_out' } })
  })
})

describe('GET /v1/admin/work/lanes and /stats carry the same flags', () => {
  it('flags the run stuck in the commit hook, with Stop', async () => {
    const s = await withStuckRun()
    const res = await s.app.call('GET', '/v1/admin/work/lanes', console_('u1'))
    expect(res.status).toBe(200)
    const flags = res.body.data.flags as Array<{ kind: string; title: string; stage: string; actions: Array<{ kind: string }> }>
    const stuck = flags.find((f) => f.kind === 'run_stuck')!
    expect(stuck.title).toBe('glot: a run has held an agent space for 4 h')
    expect(stuck.stage).toBe('commit')
    expect(stuck.actions[0]).toMatchObject({ kind: 'stop_run', claimId: CLAIM })
    expect(flags.map((f) => f.kind)).toEqual(expect.arrayContaining(['run_stuck', 'account_check', 'machine_busy']))
    const stats = await s.app.call('GET', '/v1/admin/work/stats', console_('u1'))
    expect(stats.body.data).toEqual({ flags: flags.length, danger: flags.filter((f) => (f as { severity?: string }).severity === 'danger').length, top: (flags[0] as { title: string }).title })
  })
})

describe('POST /v1/admin/work/claims/:id/stop', () => {
  it('refuses a member who does not own the machine', async () => {
    const s = await withStuckRun()
    const res = await s.app.call('POST', '/v1/admin/work/claims/:id/stop', { params: { id: CLAIM }, ...console_('u2') })
    expect(res.status).toBe(403)
    expect(s.db.table('work_claims')[0]!.status).toBe('active')
  })

  it('an admin stops it: the claim ends, it is audited, and the next heartbeat tells the machine it lost the run', async () => {
    const s = await withStuckRun()
    const res = await s.app.call('POST', '/v1/admin/work/claims/:id/stop', { params: { id: CLAIM }, ...console_('u3') })
    expect(res.status).toBe(200)
    expect(s.db.table('work_claims')[0]).toMatchObject({ status: 'done', outcome: 'stopped', detail: 'Stopped from the console after 4 h (stage: commit).' })
    expect(s.audits).toEqual([expect.objectContaining({ action: 'fix_dispatch.cancelled', resourceId: CLAIM, metadata: expect.objectContaining({ source: 'worker_stop', stage: 'commit' }) })])
    NOW = new Date(NOW.getTime() + 60_000)
    const next = await s.app.call('POST', '/v1/worker/heartbeat', { body: hb([stuckRun], [CLAIM]) })
    expect(next.body.data.lost).toEqual([CLAIM])
    const again = await s.app.call('POST', '/v1/admin/work/claims/:id/stop', { params: { id: CLAIM }, ...console_('u3') })
    expect(again.status).toBe(409)
  })

  it('the machine\'s owner may stop it too', async () => {
    const s = await withStuckRun()
    const res = await s.app.call('POST', '/v1/admin/work/claims/:id/stop', { params: { id: CLAIM }, ...console_('u1') })
    expect(res.status).toBe(200)
  })
})

describe('POST /v1/admin/work/hosts/:id/recheck', () => {
  it('only the owner asks; the heartbeat answers recheckAccount until the machine checks again', async () => {
    const s = await withStuckRun()
    expect((await s.app.call('POST', '/v1/admin/work/hosts/:id/recheck', { params: { id: s.hostId }, ...console_('u3') })).status).toBe(404)
    const before = await s.app.call('POST', '/v1/worker/heartbeat', { body: hb([], [], { cursor: { result: 'timed_out', ageSec: 300, detail: '', account: null } }) })
    expect(before.body.data.recheckAccount).toBe(false)
    const asked = await s.app.call('POST', '/v1/admin/work/hosts/:id/recheck', { params: { id: s.hostId }, ...console_('u1') })
    expect(asked.status).toBe(200)
    NOW = new Date(NOW.getTime() + 60_000)
    // The machine's last check is older than the request: check again.
    const pending = await s.app.call('POST', '/v1/worker/heartbeat', { body: hb([], [], { cursor: { result: 'timed_out', ageSec: 400, detail: '', account: null } }) })
    expect(pending.body.data.recheckAccount).toBe(true)
    // It checked 20 s ago, after the request: done.
    const done = await s.app.call('POST', '/v1/worker/heartbeat', { body: hb([], [], { cursor: { result: 'expected', ageSec: 20, detail: '', account: null } }) })
    expect(done.body.data.recheckAccount).toBe(false)
  })
})
