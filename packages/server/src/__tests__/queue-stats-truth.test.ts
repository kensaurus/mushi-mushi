/**
 * FILE: packages/server/src/__tests__/queue-stats-truth.test.ts
 * PURPOSE: /queue tells the truth (2026-10-04 console audit, glot.it).
 *
 *   - GET /v1/admin/queue/stats read `process_queue`, a table that does not
 *     exist. The error was dropped, so the snapshot read "Completed 0" next
 *     to "COMPLETED 2" and the banner said "Queue healthy" regardless.
 *   - "Recover stranded" showed with nothing stranded (strandedReports was
 *     hard-coded to 0).
 *   - Completed jobs offered Retry, which re-ran classification on a report
 *     that was already done.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => currentDb }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock('../../supabase/functions/api/helpers.ts', () => ({
  ingestReport: vi.fn(),
  triggerClassification: vi.fn(),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: vi.fn((c: Ctx, err: { message: string }) => c.json({ ok: false, error: { code: 'DB_ERROR', message: err.message } }, 500)),
  callerProjectIds: async () => ['p1'],
}))

interface Result { data?: unknown; count?: number; error?: { message: string } | null }
let currentDb: unknown = null
let tables: Record<string, Result> = {}
const tablesRead: string[] = []

/** Every builder method chains; awaiting resolves the table's canned result. */
function fakeDb() {
  return {
    from(table: string) {
      tablesRead.push(table)
      let head = false
      const chain: Record<string, unknown> = {}
      for (const m of ['eq', 'in', 'lt', 'gte', 'order', 'limit', 'is', 'update']) chain[m] = () => chain
      chain.select = (_cols?: string, opts?: { head?: boolean }) => {
        if (opts?.head) head = true
        return chain
      }
      chain.single = async () => tables[`${table}:single`] ?? { data: null, error: null }
      chain.maybeSingle = async () => tables[`${table}:single`] ?? { data: null, error: null }
      chain.then = (ok: (r: Result) => unknown) =>
        Promise.resolve(head ? tables[`${table}:count`] ?? { count: 0, error: null } : tables[table] ?? { data: [], error: null }).then(ok)
      return chain
    },
  }
}

type Routes = typeof import('../../supabase/functions/api/routes/queue.ts')
let routes: Routes

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  routes = await import('../../supabase/functions/api/routes/queue.ts')
})

beforeEach(() => {
  tables = {}
  tablesRead.length = 0
  currentDb = fakeDb()
})

type Handler = (c: Ctx, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Ctx {
  req: { param: (k: string) => string | undefined; query: (k: string) => string | undefined }
  get: (k: string) => unknown
  json: (body: Record<string, unknown>, status?: number) => { body: Record<string, unknown>; status: number }
}

async function call(method: 'get' | 'post', path: string, params: Record<string, string> = {}) {
  let found: Handler[] | null = null
  const app = {
    get: (p: string, ...h: Handler[]) => { if (method === 'get' && p === path) found = h },
    post: (p: string, ...h: Handler[]) => { if (method === 'post' && p === path) found = h },
    put: () => {}, patch: () => {}, delete: () => {},
  }
  routes.registerQueueRoutes(app as never)
  if (!found) throw new Error(`route ${path} not registered`)
  const handlers: Handler[] = found
  const c: Ctx = {
    req: { param: (k) => params[k], query: () => undefined },
    get: (k) => (k === 'userId' ? 'user-a' : undefined),
    json: (body, status = 200) => ({ body, status }),
  }
  let result: unknown
  const run = async (i: number): Promise<void> => {
    if (i === handlers.length - 1) { result = await handlers[i](c); return }
    await handlers[i](c, () => run(i + 1))
  }
  await run(0)
  return result as { body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }; status: number }
}

describe('GET /v1/admin/queue/stats', () => {
  it('reads processing_queue and reports glot\'s 2 completed jobs', async () => {
    tables = {
      projects: { data: { id: 'p1', name: 'glot.it' } },
      'projects:single': { data: { id: 'p1', name: 'glot.it' }, error: null },
      processing_queue: {
        data: [
          { id: 'q1', status: 'completed', stage: 'stage1', created_at: '2026-10-02T00:00:00Z' },
          { id: 'q2', status: 'completed', stage: 'stage1', created_at: '2026-10-03T00:00:00Z' },
        ],
        error: null,
      },
    }
    const res = await call('get', '/v1/admin/queue/stats')
    expect(tablesRead).toContain('processing_queue')
    expect(tablesRead).not.toContain('process_queue')
    expect(res.body.data).toMatchObject({ completed: 2, pending: 0, deadLetter: 0, recoverable: 0, topPriority: 'healthy' })
  })

  it('surfaces a read error instead of claiming an empty, healthy queue', async () => {
    tables = { processing_queue: { data: null, error: { message: 'relation does not exist' } } }
    const res = await call('get', '/v1/admin/queue/stats')
    expect(res.status).toBe(500)
    expect(res.body.ok).toBe(false)
  })

  it('counts what "Recover stranded" would act on', async () => {
    tables = {
      processing_queue: {
        data: [
          { id: 'f1', status: 'failed', stage: 'stage1', attempts: 1, max_attempts: 3, created_at: '2026-10-03T00:00:00Z' },
          { id: 'f2', status: 'failed', stage: 'stage1', attempts: 3, max_attempts: 3, created_at: '2026-10-03T00:00:00Z' },
        ],
        error: null,
      },
      'reports:count': { count: 2, error: null },
    }
    const res = await call('get', '/v1/admin/queue/stats')
    expect(res.body.data).toMatchObject({ retryableFailed: 1, recoverable: 3 })
  })
})

describe('POST /v1/admin/queue/:id/retry', () => {
  it('refuses a completed job with a plain message', async () => {
    tables = { 'processing_queue:single': { data: { id: 'q1', status: 'completed', report_id: 'r1', project_id: 'p1' }, error: null } }
    const res = await call('post', '/v1/admin/queue/:id/retry', { id: 'q1' })
    expect(res.status).toBe(409)
    expect(res.body.error).toEqual({ code: 'NOT_RETRYABLE', message: 'This job already finished — there is nothing to retry.' })
  })

  it('still retries a dead-letter job', async () => {
    tables = { 'processing_queue:single': { data: { id: 'q1', status: 'dead_letter', report_id: 'r1', project_id: 'p1' }, error: null } }
    const res = await call('post', '/v1/admin/queue/:id/retry', { id: 'q1' })
    expect(res.body.ok).toBe(true)
  })
})
