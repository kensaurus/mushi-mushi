/**
 * Fail-open reads (Plan 020 P-1, gap #1): a read that fails or is cut short is
 * never shown as zero, "healthy" or "no runs".
 *
 *   - `_shared/paged-read.ts` reads past the server's row cap and says when it
 *     stopped early; an error throws instead of returning [].
 *   - `api/routes/fullstack-audit.ts` answers `unknown` (never `healthy`) when
 *     the gate runs or the finding counts cannot be read.
 *   - `api/routes/recipe-compose.ts` throws when the gate runs or settings
 *     cannot be read, instead of composing "never checked / not connected".
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/supabase-mcp-client.ts', () => ({
  resolveSupabasePat: vi.fn(),
  getSupabaseAdvisors: vi.fn(),
  getLogs: vi.fn(),
  listTables: vi.fn(),
}))
vi.mock('../../supabase/functions/api/routes/project-ci-secrets.ts', () => ({
  inferStack: () => 'nextjs',
  requiredCiVarNames: () => [],
}))

let paged: typeof import('../../supabase/functions/_shared/paged-read.ts')
let audit: typeof import('../../supabase/functions/api/routes/fullstack-audit.ts')
let compose: typeof import('../../supabase/functions/api/routes/recipe-compose.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  paged = await import('../../supabase/functions/_shared/paged-read.ts')
  audit = await import('../../supabase/functions/api/routes/fullstack-audit.ts')
  compose = await import('../../supabase/functions/api/routes/recipe-compose.ts')
})

const NOW = new Date('2026-10-03T12:00:00Z').getTime()
const P = '10000001-0000-4000-8000-000000000000'
const failing = (...tables: string[]) => ({ failRead: (t: string) => (tables.includes(t) ? 'permission denied' : null) })

describe('readAllPages', () => {
  const rows = Array.from({ length: 2_350 }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}` }))
  const page = (cap: number, withCount = true) => (from: number, to: number) =>
    Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + cap)), error: null, count: withCount ? rows.length : null })

  it('reads every row when the server caps each response below the page size', async () => {
    const res = await paged.readAllPages(page(1_000), { what: 't', maxRows: 10_000, pageSize: 5_000 })
    expect(res.rows).toHaveLength(2_350)
    expect(res.truncated).toBe(false)
    expect(res.total).toBe(2_350)
  })

  it('without a count it keeps reading until an empty page', async () => {
    const res = await paged.readAllPages(page(1_000, false), { what: 't', maxRows: 10_000 })
    expect(res.rows).toHaveLength(2_350)
    expect(res.truncated).toBe(false)
  })

  it('says it stopped early at maxRows', async () => {
    const res = await paged.readAllPages(page(1_000), { what: 't', maxRows: 1_500 })
    expect(res.rows).toHaveLength(1_500)
    expect(res.truncated).toBe(true)
  })

  it('throws on a read error instead of returning what it had', async () => {
    let calls = 0
    const flaky = (from: number, to: number) => {
      calls++
      return Promise.resolve(calls === 1
        ? { data: rows.slice(from, to + 1), error: null, count: rows.length }
        : { data: null, error: { message: 'timeout' }, count: null })
    }
    await expect(paged.readAllPages(flaky, { what: 'llm_invocations', maxRows: 10_000 })).rejects.toThrow(/llm_invocations: timeout/)
  })
})

describe('full-stack audit stats', () => {
  const seed = (options = {}) => makeFakeDb({
    gate_runs: [
      { id: 'run-1', project_id: P, gate: 'api_contract', status: 'fail', completed_at: '2026-10-02T00:00:00Z', started_at: '2026-10-02T00:00:00Z' },
      { id: 'radar-old', project_id: P, gate: 'radar', status: 'warn', completed_at: '2026-10-01T00:00:00Z', started_at: '2026-10-01T00:00:00Z' },
      { id: 'radar-new', project_id: P, gate: 'radar', status: 'warn', completed_at: '2026-10-02T00:00:00Z', started_at: '2026-10-02T00:00:00Z' },
    ],
    gate_findings: [
      { id: 'f1', gate_run_id: 'run-1', severity: 'error', allowlisted: false },
      { id: 'f2', gate_run_id: 'run-1', severity: 'error', allowlisted: true },
      { id: 'f3', gate_run_id: 'radar-old', severity: 'warn', allowlisted: false },
      { id: 'f4', gate_run_id: 'radar-new', severity: 'warn', allowlisted: false },
    ],
  }, options)

  it('counts open findings from the newest radar run only', async () => {
    const stats = await audit.readFullstackAuditStats(seed() as never, P, NOW)
    expect(stats).toEqual({ errorCount: 1, warnCount: 1, failedGateCount: 1, topPriority: 'failures', readError: null })
  })

  it('a failed gate-run read is unknown, never healthy', async () => {
    const stats = await audit.readFullstackAuditStats(seed(failing('gate_runs')) as never, P, NOW)
    expect(stats.topPriority).toBe('unknown')
    expect(stats.readError).toMatch(/could not be read/)
  })

  it('a failed finding count is unknown, never healthy', async () => {
    const stats = await audit.readFullstackAuditStats(seed(failing('gate_findings')) as never, P, NOW)
    expect(stats.topPriority).toBe('unknown')
    expect(stats.readError).toMatch(/could not be counted/)
  })

  it('the audit gate list reports a failed read instead of "no gate runs"', async () => {
    const ok = await audit.readLatestGateRuns(seed() as never, P, NOW)
    expect(ok.ok && [...ok.latestByGate.keys()].sort()).toEqual(['api_contract', 'radar'])
    expect(ok.ok && ok.latestByGate.get('radar')?.id).toBe('radar-new')
    const bad = await audit.readLatestGateRuns(seed(failing('gate_runs')) as never, P, NOW)
    expect(bad).toEqual({ ok: false, message: expect.stringMatching(/could not be read/) })
  })
})

describe('composeRecipe never composes from a failed read', () => {
  const deps = {
    resolveRepo: vi.fn(async () => ({ ok: false as const, repoConnected: false, tokenAvailable: false, reason: 'no repo' })),
    getDefaultHead: vi.fn(),
    fetchWorkflowRun: vi.fn(),
    listActionsNames: vi.fn(),
    requiredEnvNames: () => [],
    now: () => new Date(NOW),
  }
  const seed = (options = {}) => makeFakeDb({ projects: [{ id: P, slug: 'p', organization_id: null }] }, options)

  it('composes when every read succeeds', async () => {
    await expect(compose.composeRecipe(seed() as never, deps as never, P)).resolves.toHaveProperty('response.worst')
  })

  it.each(['gate_runs', 'project_settings', 'gate_findings', 'app_recipe_snapshots'])('throws when %s cannot be read', async (table) => {
    const db = makeFakeDb({
      projects: [{ id: P, slug: 'p', organization_id: null }],
      gate_runs: [{ id: 'run-1', project_id: P, gate: 'schema_drift', status: 'fail', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:00:00Z' }],
    }, failing(table))
    await expect(compose.composeRecipe(db as never, deps as never, P)).rejects.toThrow(table)
  })
})
