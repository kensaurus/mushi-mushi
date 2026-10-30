/**
 * FILE: local-conflicts-routes.test.ts
 * PURPOSE: `mushi work --conflicts` done route (api/routes/local-conflicts.ts).
 *          A push with no commit sha is blocked. A push that lands after the
 *          90-minute free, or after another agent re-claimed the row, still
 *          records the resolved event and moves the queue onto the new head.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const requeued = vi.hoisted(() => [] as string[])

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

const state = vi.hoisted(() => ({ db: null as FakeDb | null }))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/fix-review-db.ts', () => ({
  requeueReviewForNewHead: async (_db: unknown, _target: unknown, head: string) => {
    requeued.push(head)
    return 'requeued'
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  callerCanAccessProject: async () => ({ allowed: true, role: 'owner' }),
}))

let routes: typeof import('../../supabase/functions/api/routes/local-conflicts.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/local-conflicts.ts')
})

const QUEUE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const FIX = 'ffffffff-1111-4222-8333-444444444444'
const TOKEN = '00000000-0000-4000-8000-0000000000aa'
const OLD = 'ab'.repeat(20)
const NEXT = 'cd'.repeat(20)

type Res = { status: number; body: { ok: boolean; data?: { state?: string; already?: boolean }; error?: { code: string } } }
type Handler = (c: unknown) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handlers: h }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handlers: h }) }
  async call(method: string, path: string, body?: unknown, params: Record<string, string> = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1' }
    const c = {
      req: { json: async () => body ?? {}, param: (k: string) => params[k] },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

function queueRow(over: Row = {}): Row {
  return {
    id: QUEUE,
    project_id: PROJECT,
    fix_attempt_id: FIX,
    repo: 'acme/app',
    pr_number: 7,
    state: 'resolving',
    detail: 'Merge conflict: `mushi work --conflicts` is merging the base branch into the pull request.',
    head_sha: OLD,
    conflict_agents: 1,
    cursor_agent_id: `local:${TOKEN}`,
    local_claim_id: null,
    claimed_until: null,
    queued_at: '2026-10-23T08:00:00Z',
    ...over,
  }
}

function setup(row: Row, wrap?: (db: FakeDb) => unknown) {
  requeued.length = 0
  const db = makeFakeDb({
    fix_merge_queue: [row],
    fix_attempts: [{ id: FIX, project_id: PROJECT, report_id: 'r1', pr_url: 'https://github.com/acme/app/pull/7' }],
    fix_events: [],
  })
  state.db = wrap ? (wrap(db) as FakeDb) : db
  const app = new FakeApp()
  routes.registerLocalConflictRoutes(app as never)
  return { app, db }
}

function done(app: FakeApp, body: Record<string, unknown>) {
  return app.call('POST', '/v1/admin/merge-queue/:id/local-conflict/done', { token: TOKEN, ...body }, { id: QUEUE })
}

describe('POST /v1/admin/merge-queue/:id/local-conflict/done', () => {
  it('a held push with no commit sha is blocked and does not re-queue the review', async () => {
    const { app, db } = setup(queueRow())
    const res = await done(app, { result: 'pushed', headAfter: null, detail: 'pushed' })
    expect(res.status).toBe(200)
    expect(res.body.data?.state).toBe('blocked')
    const row = db.table('fix_merge_queue')[0]
    expect(row?.state).toBe('blocked')
    expect(row?.head_sha).toBe(OLD)
    expect(String(row?.detail)).toContain('without a commit sha')
    expect(requeued).toEqual([])
  })

  it('a push after the 90-minute free records the new head and the resolved event', async () => {
    const { app, db } = setup(queueRow({
      state: 'blocked',
      cursor_agent_id: null,
      conflict_agents: 0,
      detail: '`mushi work --conflicts` did not push within 90 minutes.',
    }))
    const res = await done(app, { result: 'pushed', headAfter: NEXT, detail: 'merged' })
    expect(res.status).toBe(200)
    expect(res.body.error?.code).not.toBe('CONFLICT_NOT_HELD')
    expect(db.table('fix_merge_queue')[0]).toMatchObject({
      state: 'waiting',
      head_sha: NEXT,
      cursor_agent_id: null,
      conflict_agents: 0,
    })
    expect(db.table('fix_events').some((e) => e.dedupe_key === `mq-resolved:${QUEUE}:${NEXT}` && e.status === 'ok')).toBe(true)
    expect(requeued).toEqual([NEXT])
  })

  it('a push after another agent re-claimed the row still moves the queue onto the new head', async () => {
    const { app, db } = setup(queueRow({
      cursor_agent_id: 'local:99999999-9999-4999-8999-999999999999',
      conflict_agents: 1,
    }))
    const res = await done(app, { result: 'pushed', headAfter: NEXT })
    expect(res.status).toBe(200)
    expect(db.table('fix_merge_queue')[0]).toMatchObject({
      state: 'waiting',
      head_sha: NEXT,
      cursor_agent_id: null,
      local_claim_id: null,
      conflict_agents: 0,
    })
    expect(requeued).toEqual([NEXT])
  })

  it('a push that loses the compare-and-set to the 90-minute free still records the new head', async () => {
    const { app, db } = setup(queueRow(), (inner) => ({
      from(table: string) {
        const q = inner.from(table)
        if (table !== 'fix_merge_queue') return q
        const origUpdate = q.update.bind(q)
        q.update = (payload: Row) => {
          const updated = origUpdate(payload)
          const origEq = updated.eq.bind(updated)
          updated.eq = (col: string, value: unknown) => {
            if (col === 'cursor_agent_id' && value === `local:${TOKEN}`) {
              const row = inner.table('fix_merge_queue')[0]!
              row.state = 'blocked'
              row.cursor_agent_id = null
              row.conflict_agents = 0
            }
            return origEq(col, value)
          }
          return updated
        }
        return q
      },
    }))
    const res = await done(app, { result: 'pushed', headAfter: NEXT })
    expect(res.status).toBe(200)
    expect(db.table('fix_merge_queue')[0]).toMatchObject({ state: 'waiting', head_sha: NEXT, cursor_agent_id: null })
    expect(db.table('fix_events').some((e) => e.dedupe_key === `mq-resolved:${QUEUE}:${NEXT}`)).toBe(true)
    expect(requeued).toEqual([NEXT])
  })

  it('a row already waiting on that head is not written again', async () => {
    const { app, db } = setup(queueRow({ state: 'waiting', cursor_agent_id: null, head_sha: NEXT, conflict_agents: 1 }))
    const res = await done(app, { result: 'pushed', headAfter: NEXT })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ state: 'waiting', already: true })
    expect(db.table('fix_events')).toEqual([])
    expect(requeued).toEqual([])
  })

  it('a refusal after the hold ended is still not held', async () => {
    const { app, db } = setup(queueRow({ state: 'blocked', cursor_agent_id: null, conflict_agents: 0 }))
    const res = await done(app, { result: 'refused', headAfter: null, detail: 'markers' })
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('CONFLICT_NOT_HELD')
    expect(db.table('fix_merge_queue')[0]?.state).toBe('blocked')
    expect(requeued).toEqual([])
  })
})
