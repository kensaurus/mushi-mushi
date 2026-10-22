/**
 * FILE: report-file-route.test.ts
 * PURPOSE: POST /v1/admin/projects/:id/reports (file a free-form report from
 *          the console, `mushi reports file` or MCP `file_report`) through
 *          the real handler on an in-memory database:
 *            - validation (title 3..200, description 1..10000, severity enum,
 *              no unknown fields) answers 422 and writes nothing;
 *            - a caller without access gets 403, a viewer 403;
 *            - the per-app hourly limit answers 429, a limiter error 503;
 *            - a filed report is stored with source 'api', queued for
 *              stage-1 triage, classified, and audited with how it was filed.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({
  db: null as unknown,
  authMethod: 'jwt' as 'jwt' | 'apiKey',
  access: { allowed: true, role: 'member' as string | null },
  classified: [] as Array<{ reportId: string; projectId: string }>,
  audits: [] as Array<{ action: string; resourceId?: string; metadata?: Record<string, unknown>; actorType?: string }>,
  rpcError: null as null | { message: string },
}))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({
  logAudit: async (
    _db: unknown,
    _project: string,
    _actor: string,
    action: string,
    _type: string,
    resourceId?: string,
    metadata?: Record<string, unknown>,
    context?: { actorType?: string },
  ) => {
    state.audits.push({ action, resourceId, metadata, actorType: context?.actorType })
  },
}))
vi.mock('../../supabase/functions/api/helpers.ts', () => ({
  triggerClassification: (reportId: string, projectId: string) => {
    state.classified.push({ reportId, projectId })
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  callerCanAccessProject: async () => state.access,
}))

let routes: typeof import('../../supabase/functions/api/routes/report-file.ts')
let shared: typeof import('../../supabase/functions/_shared/report-file.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/report-file.ts')
  shared = await import('../../supabase/functions/_shared/report-file.ts')
})

const P1 = '1000000a-0000-4000-8000-000000000000'
const PATH = '/v1/admin/projects/:id/reports'

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  post(path: string, ...h: Handler[]) {
    this.routes.push({ method: 'POST', path, handlers: h })
  }
  async call(projectId: string, body: unknown, opts: { badJson?: boolean } = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === 'POST' && r.path === PATH)
    if (!route) throw new Error('route not registered')
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: state.authMethod }
    const c = {
      req: {
        json: async () => {
          if (opts.badJson) throw new SyntaxError('bad json')
          return body
        },
        param: (k: string) => (k === 'id' ? projectId : undefined),
        header: () => undefined,
      },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => {
        vars[k] = v
      },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

function setup(): { db: FakeDb; app: FakeApp } {
  const db = makeFakeDb({ reports: [], processing_queue: [] }, { autoId: true })
  const realRpc = db.rpc.bind(db)
  ;(db as unknown as { rpc: unknown }).rpc = async (fn: string, args: Record<string, unknown>) => {
    await realRpc(fn, args)
    return state.rpcError ? { data: null, error: state.rpcError } : { data: null, error: null }
  }
  state.db = db
  const app = new FakeApp()
  routes.registerReportFileRoutes(app as never)
  return { db, app }
}

beforeEach(() => {
  state.authMethod = 'jwt'
  state.access = { allowed: true, role: 'member' }
  state.classified = []
  state.audits = []
  state.rpcError = null
})

const rows = (db: FakeDb, table: string) => (db as unknown as { tables: Record<string, Array<Record<string, unknown>>> }).tables[table] ?? []

describe('parseFileReportBody', () => {
  it('trims, strips control characters and accepts the optional fields', () => {
    const r = shared.parseFileReportBody({ title: '  Login\u0007 fails  ', description: 'Steps:\r\n1. open', severity: 'high', component: ' auth ' })
    expect(r).toEqual({ ok: true, value: { title: 'Login fails', description: 'Steps:\n1. open', severity: 'high', component: 'auth' } })
  })

  it('names every bad field', () => {
    const r = shared.parseFileReportBody({ title: 'ab', description: '', severity: 'urgent' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('VALIDATION_ERROR')
      expect(r.error.message).toMatch(/title/)
      expect(r.error.message).toMatch(/description/)
      expect(r.error.message).toMatch(/severity/)
    }
  })

  it('caps lengths and refuses unknown fields', () => {
    expect(shared.parseFileReportBody({ title: 'x'.repeat(201), description: 'd' }).ok).toBe(false)
    expect(shared.parseFileReportBody({ title: 'ok title', description: 'd'.repeat(10_001) }).ok).toBe(false)
    expect(shared.parseFileReportBody({ title: 'ok title', description: 'd', project_id: P1 }).ok).toBe(false)
    expect(shared.parseFileReportBody(null).ok).toBe(false)
  })
})

describe('POST /v1/admin/projects/:id/reports', () => {
  it('files a report, queues and classifies it, and audits how it was filed', async () => {
    const { db, app } = setup()
    state.authMethod = 'apiKey'
    const res = await app.call(P1, { title: 'Checkout total wrong', description: 'Adds tax twice.', severity: 'high', component: 'checkout' })
    expect(res.status).toBe(201)
    const id = res.body.data?.reportId as string
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const [report] = rows(db, 'reports')
    expect(report).toMatchObject({
      id,
      project_id: P1,
      title: 'Checkout total wrong',
      description: 'Adds tax twice.',
      severity: 'high',
      component: 'checkout',
      source: 'api',
      status: 'new',
      reporter_token_hash: 'admin-filed',
      custom_metadata: { source: 'admin_file', filed_via: 'api_key', filed_by: 'u1', filed_severity: 'high', filed_component: 'checkout' },
    })
    expect(rows(db, 'processing_queue')).toEqual([expect.objectContaining({ report_id: id, project_id: P1, stage: 'stage1', status: 'pending' })])
    expect(state.classified).toEqual([{ reportId: id, projectId: P1 }])
    expect(state.audits).toEqual([
      expect.objectContaining({ action: 'report.created', resourceId: id, actorType: 'api_key', metadata: expect.objectContaining({ via: 'api_key' }) }),
    ])
    expect(db.rpcCalls).toEqual([
      { fn: 'scoped_rate_limit_claim', args: { p_user_id: P1, p_scope: 'admin_report_file', p_max_per_window: 30, p_window: '1 hour' } },
    ])
  })

  it('leaves severity and component to triage when not given', async () => {
    const { db, app } = setup()
    const res = await app.call(P1, { title: 'Blank page on /settings', description: 'White screen.' })
    expect(res.status).toBe(201)
    const [report] = rows(db, 'reports')
    expect(report.severity).toBeUndefined()
    expect(report.component).toBeUndefined()
    expect(report.custom_metadata).toEqual({ source: 'admin_file', filed_via: 'console', filed_by: 'u1' })
    expect(state.audits[0].actorType).toBe('user')
  })

  it('answers 422 on a bad body and 400 on bad JSON or a bad id, writing nothing', async () => {
    const { db, app } = setup()
    expect((await app.call(P1, { title: 'no' , description: 'x' })).status).toBe(422)
    expect((await app.call(P1, {}, { badJson: true })).status).toBe(400)
    expect((await app.call('not-a-uuid', { title: 'fine title', description: 'x' })).status).toBe(400)
    expect(rows(db, 'reports')).toHaveLength(0)
    expect(db.rpcCalls).toHaveLength(0)
    expect(state.classified).toHaveLength(0)
  })

  it('refuses callers without access and viewers', async () => {
    const { db, app } = setup()
    state.access = { allowed: false, role: null }
    expect((await app.call(P1, { title: 'fine title', description: 'x' })).status).toBe(403)
    state.access = { allowed: true, role: 'viewer' }
    const viewer = await app.call(P1, { title: 'fine title', description: 'x' })
    expect(viewer.status).toBe(403)
    expect(viewer.body.error?.message).toMatch(/read-only/)
    expect(rows(db, 'reports')).toHaveLength(0)
  })

  it('answers 429 over the hourly limit and 503 when the limiter fails, filing nothing', async () => {
    const { db, app } = setup()
    state.rpcError = { message: 'rate_limit_exceeded' }
    const limited = await app.call(P1, { title: 'fine title', description: 'x' })
    expect(limited.status).toBe(429)
    expect(limited.body.error?.code).toBe('RATE_LIMITED')
    state.rpcError = { message: 'connection reset' }
    const down = await app.call(P1, { title: 'fine title', description: 'x' })
    expect(down.status).toBe(503)
    expect(rows(db, 'reports')).toHaveLength(0)
    expect(state.classified).toHaveLength(0)
  })
})
