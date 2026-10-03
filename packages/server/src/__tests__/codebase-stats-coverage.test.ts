/**
 * `GET /v1/admin/projects/:id/codebase/stats` (gap #16a): returns the plan's
 * `file_cap` the CodebaseIndexCard reads (the route never sent it, so the
 * card rendered "undefined"), coverage in files, and the sweep timestamps.
 * Driven on a fake app with a fake DB.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => currentDb }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: vi.fn(),
  callerProjectIds: vi.fn(),
  resolveOwnedProject: vi.fn(),
  callerCanAccessProject: async () => ({ allowed: true, role: 'owner' }),
}))
vi.mock('../../supabase/functions/_shared/quota.ts', () => ({
  resolveProjectPlan: async () => {
    if (planError) throw new Error('plans down')
    return { id: 'indie', feature_flags: {} }
  },
}))

let currentDb: unknown = null
let planError = false

type Routes = typeof import('../../supabase/functions/api/routes/project-codebase.ts')
let routes: Routes

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  routes = await import('../../supabase/functions/api/routes/project-codebase.ts')
})

type Handler = (c: Ctx, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Ctx {
  req: { param: (k: string) => string | undefined; json: () => Promise<unknown>; header: () => undefined; query: () => undefined }
  get: (k: string) => unknown
  json: (body: Record<string, unknown>, status?: number) => { body: Record<string, unknown>; status: number }
}

function captureRoute(path: string): Handler[] {
  let found: Handler[] | null = null
  const app = {
    get: (p: string, ...h: Handler[]) => { if (p === path) found = h },
    post: () => {}, put: () => {}, patch: () => {}, delete: () => {},
  }
  routes.registerProjectCodebaseRoutes(app as never)
  if (!found) throw new Error(`route ${path} not registered`)
  return found
}

async function callStats(projectId: string) {
  const handlers = captureRoute('/v1/admin/projects/:id/codebase/stats')
  const c: Ctx = {
    req: { param: (k) => (k === 'id' ? projectId : undefined), json: async () => ({}), header: () => undefined, query: () => undefined },
    get: (k) => (k === 'userId' ? 'user-a' : undefined),
    json: (body, status = 200) => ({ body, status }),
  }
  let result: unknown
  const run = async (i: number): Promise<void> => {
    if (i === handlers.length - 1) { result = await handlers[i](c); return }
    await handlers[i](c, () => run(i + 1))
  }
  await run(0)
  return result as { body: { ok: boolean; data: Record<string, unknown> }; status: number }
}

/** One canned result per table; `select('*', {head})` returns a count. */
function fakeDb(tables: Record<string, unknown>, chunkCount: number) {
  return {
    from(table: string) {
      const chain = {
        select: (_cols?: string, opts?: { head?: boolean }) => {
          if (opts?.head) return countChain
          return chain
        },
        eq: () => chain, is: () => chain, limit: async () => ({ data: tables[`${table}:list`] ?? [], error: null }),
        maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
      }
      const countChain = { eq: () => countChain, is: () => Promise.resolve({ count: chunkCount, error: null }) }
      return chain
    },
  }
}

const PID = '1000000a-0000-4000-8000-000000000000'
const REPO = {
  repo_url: 'https://github.com/acme/shop',
  default_branch: 'main',
  path_globs: [],
  last_indexed_at: null,
  last_index_error: null,
  last_index_attempt_at: '2026-10-03T10:00:00Z',
  github_app_installation_id: null,
  indexing_enabled: true,
  index_swept_at: '2026-10-03T10:00:00Z',
  index_files_indexed: 1500,
  index_files_eligible: 4700,
  index_file_cap: 1500,
  index_tree_truncated: false,
  index_coverage_state: 'capped',
}

describe('codebase stats', () => {
  it('returns file_cap from the plan, coverage in files, and the sweep time', async () => {
    delete process.env.MUSHI_REPO_INDEX_SWEEP_FILE_CAP
    planError = false
    currentDb = fakeDb({
      project_settings: { codebase_index_enabled: true, codebase_repo_url: null, github_webhook_secret: 'vault://x' },
      project_repos: REPO,
      'project_codebase_files:list': [{ language: 'typescript' }, { language: 'typescript' }, { language: 'python' }],
    }, 6200)
    const res = await callStats(PID)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.file_cap).toBe(1500)
    expect(d.file_cap_source).toBe('plan_tier')
    expect(d.plan_id).toBe('indie')
    expect(d.indexed_chunks).toBe(6200)
    expect(d.at_file_cap).toBe(true)
    expect(d.coverage).toMatchObject({ indexed_files: 1500, eligible_files: 4700, state: 'capped', summary: '1,500 of 4,700 files indexed (plan limit 1,500)' })
    expect(d.last_indexed_at).toBeNull()
    expect(d.index_swept_at).toBe('2026-10-03T10:00:00Z')
    expect(d.language_distribution).toEqual({ typescript: 2, python: 1 })
    expect(d.push_webhook_path).toBe('/v1/webhooks/github')
  })

  it('a plan read error keeps the last sweep cap and says so', async () => {
    planError = true
    currentDb = fakeDb({ project_settings: { codebase_index_enabled: true }, project_repos: { ...REPO, index_file_cap: 900 } }, 10)
    const d = (await callStats(PID)).body.data
    expect(d.file_cap).toBe(900)
    expect(d.file_cap_source).toBe('unavailable')
  })

  it('before any coverage sweep: coverage null, default cap, no push hint for an App install', async () => {
    planError = true
    currentDb = fakeDb({
      project_settings: { codebase_index_enabled: true },
      project_repos: { ...REPO, github_app_installation_id: 7, index_files_indexed: null, index_files_eligible: null, index_file_cap: null, index_coverage_state: null },
    }, 0)
    const d = (await callStats(PID)).body.data
    expect(d.coverage).toBeNull()
    expect(d.file_cap).toBe(300)
    expect(d.at_file_cap).toBe(false)
    expect(d.push_webhook_path).toBeNull()
  })
})
