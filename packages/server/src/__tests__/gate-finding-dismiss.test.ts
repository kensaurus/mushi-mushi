/**
 * POST /v1/admin/projects/:pid/gate-findings/:id/dismiss — the only way to
 * close a stale gate finding without a new run (glot.it, 2026-10-07). It sets
 * the existing allowlisted / allowlist_reason columns, needs a reason of
 * 3..300 characters, refuses viewers, never reaches another project's finding,
 * and writes an audit row.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

type Handler = (c: Ctx, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Res { body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }; status: number }
interface Ctx {
  req: { param: (k: string) => string | undefined; query: (k: string) => string | undefined; header: (k: string) => string | undefined; json: () => Promise<unknown> }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  json: (body: unknown, status?: number) => Res
}

const P = '10000001-0000-4000-8000-000000000000'
const OTHER = '20000002-0000-4000-8000-000000000000'
const F = '30000003-0000-4000-8000-000000000000'
const F_OTHER = '40000004-0000-4000-8000-000000000000'
const ORG = '50000005-0000-4000-8000-000000000000'

let db: FakeDb
let handlers: Handler[] = []

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  const { registerGateFindingDismissRoutes } = await import('../../supabase/functions/api/routes/gate-finding-dismiss.ts')
  const app = {
    post: (path: string, ...h: Handler[]) => {
      expect(path).toBe('/v1/admin/projects/:pid/gate-findings/:id/dismiss')
      handlers = h
    },
  }
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  registerGateFindingDismissRoutes(app as never, { getServiceClient: () => db as never, jwtAuth: pass })
})

function seed(role: 'owner' | 'member' | 'viewer') {
  db = makeFakeDb({
    projects: [
      { id: P, owner_id: role === 'owner' ? 'user-a' : 'someone-else', organization_id: ORG },
      { id: OTHER, owner_id: 'someone-else', organization_id: null },
    ],
    organization_members: role === 'owner' ? [] : [{ organization_id: ORG, user_id: 'user-a', role }],
    project_members: [],
    gate_findings: [
      { id: F, project_id: P, gate_run_id: 'run-1', rule_id: 'crawl-fetch-failed', allowlisted: false, allowlist_reason: null },
      { id: F_OTHER, project_id: OTHER, gate_run_id: 'run-9', rule_id: 'x', allowlisted: false, allowlist_reason: null },
    ],
    audit_logs: [],
  })
}

async function call(pid: string, id: string, body: unknown): Promise<Res> {
  const vars: Record<string, unknown> = { userId: 'user-a', authMethod: 'jwt' }
  const params: Record<string, string> = { pid, id }
  const c: Ctx = {
    req: { param: (k) => params[k], query: () => undefined, header: () => undefined, json: async () => body },
    get: (k) => vars[k],
    set: (k, v) => { vars[k] = v },
    json: (b, status = 200) => ({ body: b as Res['body'], status }),
  }
  let result: unknown
  const run = async (i: number): Promise<void> => {
    if (i === handlers.length - 1) { result = await handlers[i](c); return }
    const short = await handlers[i](c, () => run(i + 1))
    if (result === undefined && short !== undefined) result = short
  }
  await run(0)
  return result as Res
}

const row = (id: string) => db.table('gate_findings').find((r) => r.id === id)!

describe('dismiss a gate finding', () => {
  beforeEach(() => seed('member'))

  it('a member dismisses with a reason; the row is allowlisted and audited', async () => {
    const res = await call(P, F, { reason: '  Crawler fetched localhost; fixed in settings.  ' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: F, allowlisted: true, alreadyDismissed: false })
    expect(row(F)).toMatchObject({ allowlisted: true, allowlist_reason: 'Crawler fetched localhost; fixed in settings.' })
    const audit = db.table('audit_logs')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ project_id: P, action: 'gate_finding.dismissed', resource_type: 'gate_finding', resource_id: F })
  })

  it('a repeat dismiss changes nothing', async () => {
    await call(P, F, { reason: 'first reason' })
    const res = await call(P, F, { reason: 'second reason' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ alreadyDismissed: true, allowlistReason: 'first reason' })
    expect(row(F).allowlist_reason).toBe('first reason')
    expect(db.table('audit_logs')).toHaveLength(1)
  })

  it('two dismissals at once write and audit once', async () => {
    const [a, b] = await Promise.all([call(P, F, { reason: 'first reason' }), call(P, F, { reason: 'second reason' })])
    expect([a.status, b.status]).toEqual([200, 200])
    expect([a.body.data?.alreadyDismissed, b.body.data?.alreadyDismissed].sort()).toEqual([false, true])
    expect(db.table('audit_logs')).toHaveLength(1)
  })

  it('needs a reason of 3 to 300 characters', async () => {
    for (const body of [{}, { reason: '' }, { reason: '  ab  ' }, { reason: 'x'.repeat(301) }, { reason: 42 }, null]) {
      const res = await call(P, F, body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    }
    expect(row(F).allowlisted).toBe(false)
    expect((await call(P, F, { reason: 'x'.repeat(300) })).status).toBe(200)
  })

  it('refuses a viewer', async () => {
    seed('viewer')
    const res = await call(P, F, { reason: 'not a problem' })
    expect(res.status).toBe(403)
    expect(row(F).allowlisted).toBe(false)
    expect(db.table('audit_logs')).toHaveLength(0)
  })

  it('lets the project owner dismiss', async () => {
    seed('owner')
    expect((await call(P, F, { reason: 'not a problem' })).status).toBe(200)
  })

  it('never reaches another project’s finding', async () => {
    // The finding id belongs to OTHER; the caller names their own project.
    const res = await call(P, F_OTHER, { reason: 'not a problem' })
    expect(res.status).toBe(404)
    expect(row(F_OTHER).allowlisted).toBe(false)
    // And a project the caller cannot reach is a 404 too.
    expect((await call(OTHER, F_OTHER, { reason: 'not a problem' })).status).toBe(404)
  })

  it('a malformed id is a 404', async () => {
    expect((await call(P, 'nope', { reason: 'not a problem' })).status).toBe(404)
  })
})
