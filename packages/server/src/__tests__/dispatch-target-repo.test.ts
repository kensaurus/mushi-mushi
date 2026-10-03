/**
 * FILE: dispatch-target-repo.test.ts
 * PURPOSE: POST /v1/admin/fixes/dispatch `targetRepoId`, driven through the
 *          real handler (api/routes/fix-dispatch.ts) on an in-memory database.
 *          A project with several linked repos picks the one the fix goes to:
 *          the id must be a project_repos row of the report's project, and it
 *          lands in dispatch_metadata.target_repo_id, the key fix-worker's
 *          resolveRepo() reads. Omitting it keeps the old metadata.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({
  db: null as unknown,
  members: new Map<string, Set<string>>(),
  invoked: [] as string[],
}))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: () => {}, reportMessage: () => {} }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/idempotency.ts', () => ({
  withIdempotency: (_c: unknown, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('../../supabase/functions/_shared/autofix-budget.ts', () => ({
  checkAutofixBudget: async () => ({
    allowed: true,
    trigger: 'manual',
    spendUsd30d: 0,
    dispatchesToday: 0,
    maxSpendUsd: null,
    maxDispatchesPerDay: null,
    capExceeded: false,
  }),
}))
vi.mock('../../supabase/functions/_shared/agent-adapters.ts', () => ({
  validateAgentOverride: (raw: string | null) => ({ ok: true, agent: raw }),
  cancelCloudAgentAttempt: async () => {},
}))
vi.mock('../../supabase/functions/api/helpers.ts', () => ({
  canManageProjectSdkConfig: () => true,
  coerceSdkConfigUpdate: () => ({}),
  ingestReport: async () => ({}),
  invokeFixWorker: async (id: string) => {
    state.invoked.push(id)
  },
  normalizeSdkConfig: () => ({}),
  triggerClassification: async () => {},
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  ownedProjectIds: async () => [],
  callerProjectIds: async () => [],
  callerCanAccessProject: async (_c: unknown, _db: unknown, userId: string, projectId: string) => ({
    allowed: state.members.get(userId)?.has(projectId) ?? false,
    role: null,
  }),
}))

let routes: typeof import('../../supabase/functions/api/routes/fix-dispatch.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  routes = await import('../../supabase/functions/api/routes/fix-dispatch.ts')
})

const PROJECT = '1000000a-0000-4000-8000-000000000000'
const OTHER_PROJECT = '1000000b-0000-4000-8000-000000000000'
const REPORT = '2000000a-0000-4000-8000-000000000000'
const FRONTEND_REPO = '3000000a-0000-4000-8000-000000000000'
const BACKEND_REPO = '3000000b-0000-4000-8000-000000000000'
const FOREIGN_REPO = '3000000c-0000-4000-8000-000000000000'
const USER = 'user-1'

type Res = {
  status: number
  body: { ok: boolean; data?: { dispatchId?: string; targetRepoId?: string | null }; error?: { code: string } }
}
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  get(path: string, ...handlers: Handler[]) { this.routes.push({ method: 'GET', path, handlers }) }
  post(path: string, ...handlers: Handler[]) { this.routes.push({ method: 'POST', path, handlers }) }
  async post$(path: string, body: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === 'POST' && r.path === path)
    if (!route) throw new Error(`no route POST ${path}`)
    const vars: Record<string, unknown> = { userId: USER, authMethod: 'jwt', requestId: 'req-1' }
    const c = {
      req: { json: async () => body, header: () => undefined, param: () => undefined, query: () => undefined },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

function setup(): { db: FakeDb; app: FakeApp } {
  const db = makeFakeDb(
    {
      reports: [{ id: REPORT, project_id: PROJECT, category: 'bug', user_category: 'bug' }],
      project_settings: [{ project_id: PROJECT, autofix_enabled: true }],
      project_repos: [
        { id: FRONTEND_REPO, project_id: PROJECT, repo_url: 'https://github.com/acme/solo-boss-cloud', is_primary: true },
        { id: BACKEND_REPO, project_id: PROJECT, repo_url: 'https://github.com/acme/solo-boss-cloud_backend', is_primary: false },
        { id: FOREIGN_REPO, project_id: OTHER_PROJECT, repo_url: 'https://github.com/other/app', is_primary: true },
      ],
      fix_dispatch_jobs: [],
    },
    { autoId: true },
  )
  state.db = db
  state.members = new Map([[USER, new Set([PROJECT])]])
  state.invoked = []
  const app = new FakeApp()
  routes.registerFixDispatchRoutes(app as never)
  return { db, app }
}

const DISPATCH = '/v1/admin/fixes/dispatch'

describe('POST /v1/admin/fixes/dispatch targetRepoId', () => {
  it('stores a linked repo as dispatch_metadata.target_repo_id', async () => {
    const { db, app } = setup()
    const res = await app.post$(DISPATCH, { reportId: REPORT, projectId: PROJECT, targetRepoId: BACKEND_REPO })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data?.targetRepoId).toBe(BACKEND_REPO)
    const jobs = db.table('fix_dispatch_jobs')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].dispatch_metadata).toEqual({
      trigger: 'manual',
      target_repo_id: BACKEND_REPO,
      target_repo_url: 'https://github.com/acme/solo-boss-cloud_backend',
    })
    expect(state.invoked).toEqual([jobs[0].id])
  })

  it("rejects another project's repo id with 400 and queues nothing", async () => {
    const { db, app } = setup()
    const res = await app.post$(DISPATCH, { reportId: REPORT, projectId: PROJECT, targetRepoId: FOREIGN_REPO })
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('TARGET_REPO_NOT_IN_PROJECT')
    expect(db.table('fix_dispatch_jobs')).toHaveLength(0)
    expect(state.invoked).toEqual([])
  })

  it('rejects a non-UUID targetRepoId with 400 before touching the database', async () => {
    const { db, app } = setup()
    for (const bad of ['acme/solo-boss-cloud_backend', 42]) {
      const res = await app.post$(DISPATCH, { reportId: REPORT, projectId: PROJECT, targetRepoId: bad })
      expect(res.status).toBe(400)
      expect(res.body.error?.code).toBe('INVALID_TARGET_REPO_ID')
    }
    expect(db.table('fix_dispatch_jobs')).toHaveLength(0)
  })

  it('does not reveal repo ids to a non-member', async () => {
    const { app } = setup()
    state.members = new Map()
    const res = await app.post$(DISPATCH, { reportId: REPORT, projectId: PROJECT, targetRepoId: BACKEND_REPO })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('FORBIDDEN')
  })

  it('keeps the old metadata when targetRepoId is omitted or null', async () => {
    for (const extra of [{}, { targetRepoId: null }]) {
      const { db, app } = setup()
      const res = await app.post$(DISPATCH, { reportId: REPORT, projectId: PROJECT, ...extra })
      expect(res.status).toBe(200)
      expect(res.body.data?.targetRepoId).toBeNull()
      expect(db.table('fix_dispatch_jobs')[0].dispatch_metadata).toEqual({ trigger: 'manual' })
    }
  })
})
