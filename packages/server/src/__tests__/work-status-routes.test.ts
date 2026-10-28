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

// ── "Switch account" (ADR 0048 amendment 2026-10-28) ────────────────────────

const LINK = 'https://cursor.com/loginDeepControl?challenge=abcDEF123_-xyz&uuid=1f95da85-6fc6-4e9c-8795-0ef1b7913f90&mode=login&redirectTarget=cli'
/** A heartbeat from a daemon that can switch (or an older one, can: undefined), with its switch report. */
const hbSwitch = (cursorLogin?: Record<string, unknown>, can: string[] | null = ['cursor_login']) => {
  const b = hb([], [], { cursor: { result: 'expected', ageSec: 30, detail: 'Logged in', account: 's***@g***.com' } }) as Record<string, any>
  return { ...b, host: { ...b.host, ...(can ? { can } : {}) }, status: { ...b.status, ...(cursorLogin ? { cursorLogin } : {}) } }
}

async function withSwitchableHost(can: string[] | null = ['cursor_login']) {
  const s = setup()
  const first = await s.app.call('POST', '/v1/worker/heartbeat', { body: hbSwitch(undefined, can) })
  expect(first.status).toBe(200)
  const hostId = s.db.table('work_hosts')[0]!.id as string
  return { ...s, hostId }
}

const switchTo = (s: { app: FakeApp; hostId: string }, account: unknown, who = 'u1', extra: Record<string, unknown> = {}) =>
  s.app.call('POST', '/v1/admin/work/hosts/:id/cursor-account', { params: { id: s.hostId }, body: { account, ...extra }, ...console_(who) })
const readSwitch = (s: { app: FakeApp; hostId: string }, who = 'u1') => s.app.call('GET', '/v1/admin/work/hosts/:id/cursor-login', { params: { id: s.hostId }, ...console_(who) })

describe('Switch the Cursor account from the console', () => {
  it('only the machine\'s owner, only from a console session, only with an e-mail address', async () => {
    const s = await withSwitchableHost()
    expect((await switchTo(s, 'kensaurus@gmail.com', 'u3')).status).toBe(403) // an admin of the app, not the machine's owner
    expect((await switchTo(s, 'kensaurus@gmail.com', 'u2')).status).toBe(403)
    const byKey = await s.app.call('POST', '/v1/admin/work/hosts/:id/cursor-account', { params: { id: s.hostId }, body: { account: 'kensaurus@gmail.com' } })
    expect(byKey.status).toBe(403)
    expect(byKey.body.error!.code).toBe('CONSOLE_ONLY')
    for (const bad of ['', 'kensaurus', 'a b@c.com', `${'x'.repeat(250)}@g.com`, 42]) expect((await switchTo(s, bad)).status).toBe(400)
    expect((await readSwitch(s, 'u3')).status).toBe(403)
    expect(s.db.table('work_hosts')[0]!.cursor_account ?? null).toBeNull()
  })

  it('a machine whose CLI cannot switch says to update it', async () => {
    const s = await withSwitchableHost(null)
    const res = await switchTo(s, 'kensaurus@gmail.com')
    expect(res.status).toBe(409)
    expect(res.body.error!.code).toBe('CLI_TOO_OLD')
    expect(res.body.error!.message).toMatch(/npm i -g @mushi-mushi\/cli@latest/)
    expect((await readSwitch(s)).body.data.canSwitch).toBe(false)
  })

  it('the whole switch: request → the machine picks it up → link (owner only) → signed in; audited without the link', async () => {
    const s = await withSwitchableHost()
    const asked = await switchTo(s, 'Kensaurus@Gmail.com')
    expect(asked.status).toBe(200)
    expect(asked.body.data.login).toMatchObject({ state: 'requested', account: 'kensaurus@gmail.com' })
    expect(s.audits).toEqual([expect.objectContaining({ action: 'worker.cursor_account_switch', resourceId: s.hostId, metadata: expect.objectContaining({ account: 'k***@g***.com' }) })])

    const pick = await s.app.call('POST', '/v1/worker/heartbeat', { body: hbSwitch() })
    expect(pick.body.data.cursorAccount).toBe('kensaurus@gmail.com')
    const requestId = pick.body.data.cursorLogin.requestId as string
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)

    await s.app.call('POST', '/v1/worker/heartbeat', { body: hbSwitch({ requestId, state: 'link_ready', url: LINK }) })
    const owner = await readSwitch(s)
    expect(owner.body.data.login).toMatchObject({ state: 'link_ready', url: LINK })
    // The link is nowhere else: not in the machine's status, the lanes read, the badge or the audit rows.
    expect(JSON.stringify(s.db.table('work_hosts')[0]!.status)).not.toContain('cursor.com')
    const lanes = await s.app.call('GET', '/v1/admin/work/lanes', console_('u1'))
    expect(JSON.stringify(lanes.body)).not.toContain('cursor.com/login')
    expect(lanes.body.data.hosts[0]).toMatchObject({ cursorAccount: 'kensaurus@gmail.com', canSwitchAccount: true, cursorLogin: { state: 'link_ready' } })
    const asAdmin = await s.app.call('GET', '/v1/admin/work/lanes', console_('u3'))
    expect(asAdmin.body.data.hosts[0].cursorAccount).toBe('k***@g***.com')
    const stats = await s.app.call('GET', '/v1/admin/work/stats', console_('u1'))
    expect(JSON.stringify(stats.body)).not.toContain('cursor.com')
    expect(JSON.stringify(s.audits)).not.toContain('cursor.com')

    const done = await s.app.call('POST', '/v1/worker/heartbeat', { body: hbSwitch({ requestId, state: 'signed_in', detail: 'Signed in as kensaurus@gmail.com.' }) })
    expect(done.body.data.cursorLogin).toBeNull()
    const after = await readSwitch(s)
    expect(after.body.data.login).toMatchObject({ state: 'signed_in', detail: 'Signed in as k***@g***.com.' })
    expect(after.body.data.login.url).toBeUndefined()
    expect(JSON.stringify(s.db.table('work_hosts')[0]!.cursor_login)).not.toContain('cursor.com')
  })

  it('one switch at a time: a second is refused until it ends, and Start again replaces it', async () => {
    const s = await withSwitchableHost()
    expect((await switchTo(s, 'kensaurus@gmail.com')).status).toBe(200)
    const second = await switchTo(s, 'other@example.com')
    expect(second.status).toBe(409)
    expect(second.body.error!.code).toBe('IN_PROGRESS')
    const first = (s.db.table('work_hosts')[0]!.cursor_login as { requestId: string }).requestId
    const again = await switchTo(s, 'other@example.com', 'u1', { restart: true })
    expect(again.status).toBe(200)
    const next = (s.db.table('work_hosts')[0]!.cursor_login as { requestId: string }).requestId
    expect(next).not.toBe(first)
    // The machine's report about the replaced request changes nothing.
    await s.app.call('POST', '/v1/worker/heartbeat', { body: hbSwitch({ requestId: first, state: 'signed_in' }) })
    expect((await readSwitch(s)).body.data.login).toMatchObject({ state: 'requested', account: 'other@example.com' })
    expect(s.audits.at(-1)!.metadata).toMatchObject({ restarted: true })
  })

  it('an offline machine keeps the request until it checks in, and it expires after an hour', async () => {
    const s = await withSwitchableHost()
    NOW = new Date(NOW.getTime() + 10 * 60_000) // the machine missed its heartbeats
    const asked = await switchTo(s, 'kensaurus@gmail.com')
    expect(asked.body.data.online).toBe(false)
    expect(asked.body.data.message).toMatch(/offline; it starts the switch when it checks in/)
    expect((await readSwitch(s)).body.data).toMatchObject({ online: false, login: { state: 'requested' } })
    NOW = new Date(NOW.getTime() + 61 * 60_000)
    const late = await readSwitch(s)
    expect(late.body.data.login).toMatchObject({ state: 'expired', detail: expect.stringMatching(/did not pick up the request within an hour/) })
    const beat = await s.app.call('POST', '/v1/worker/heartbeat', { body: hbSwitch() })
    expect(beat.body.data.cursorLogin).toBeNull()
    // An expired switch can be started again without "restart".
    expect((await switchTo(s, 'kensaurus@gmail.com')).status).toBe(200)
  })

  it('a wrong account or a failure ends the switch with why; a malformed report changes nothing', async () => {
    const s = await withSwitchableHost()
    await switchTo(s, 'kensaurus@gmail.com')
    const requestId = (s.db.table('work_hosts')[0]!.cursor_login as { requestId: string }).requestId
    await s.app.call('POST', '/v1/worker/heartbeat', { body: hbSwitch({ requestId, state: 'link_ready', url: 'https://evil.example/login' }) })
    expect((await readSwitch(s)).body.data.login.state).toBe('requested')
    await s.app.call('POST', '/v1/worker/heartbeat', { body: hbSwitch({ requestId, state: 'wrong_account', detail: 'Signed in as suzu.haruka1130@gmail.com, not kensaurus@gmail.com.' }) })
    expect((await readSwitch(s)).body.data.login).toMatchObject({ state: 'wrong_account', detail: 'Signed in as s***@g***.com, not k***@g***.com.' })
  })

  it('the account flag offers Switch account', async () => {
    const s = setup()
    await s.app.call('POST', '/v1/worker/heartbeat', { body: hb([], [], { cursor: { result: 'other_account', ageSec: 60, detail: 'Logged in as suzu.haruka1130@gmail.com', account: 'k***@g***.com' } }) })
    const lanes = await s.app.call('GET', '/v1/admin/work/lanes', console_('u1'))
    const flag = (lanes.body.data.flags as Array<{ kind: string; actions: Array<{ kind: string }> }>).find((f) => f.kind === 'account_check')!
    expect(flag.actions.map((a) => a.kind)).toEqual(['switch_account', 'recheck_account', 'copy_command'])
  })

  it('stays quiet about another account while the machine is switching on purpose', async () => {
    const s = setup()
    const body = hb([], [], { cursor: { result: 'other_account', ageSec: 60, detail: 'Logged in as suzu.haruka1130@gmail.com', account: 'k***@g***.com' } }) as Record<string, any>
    await s.app.call('POST', '/v1/worker/heartbeat', { body: { ...body, status: { ...body.status, state: 'switching-account' } } })
    const lanes = await s.app.call('GET', '/v1/admin/work/lanes', console_('u1'))
    expect((lanes.body.data.flags as Array<{ kind: string }>).some((f) => f.kind === 'account_check')).toBe(false)
  })
})
