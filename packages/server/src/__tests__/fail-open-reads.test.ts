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
 *   - Reads past the server's 1,000-row cap count every row, or say they
 *     could not (audit stats `unknown`), never a silently low number.
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
vi.mock('../../supabase/functions/_shared/sdk-diagnostics.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../supabase/functions/_shared/sdk-diagnostics.ts')>()),
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

  it('asks for an exact count on the first page only', async () => {
    const asked: Array<[number, string | undefined]> = []
    const counting = (from: number, to: number, count: 'exact' | undefined) => {
      asked.push([from, count])
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: count === 'exact' ? rows.length : null })
    }
    const res = await paged.readAllPages(counting, { what: 't', maxRows: 10_000 })
    expect(res.rows).toHaveLength(2_350)
    expect(res.truncated).toBe(false)
    expect(res.total).toBe(2_350)
    expect(asked).toEqual([[0, 'exact'], [1_000, undefined], [2_000, undefined]])
  })
})

describe('reads past the server row cap (1,000 rows per response)', () => {
  const capped = { maxRows: 1_000 }

  it('audit stats count every failed run, not the first 1,000', async () => {
    const runs = Array.from({ length: 1_500 }, (_, i) => ({
      id: `run-${String(i).padStart(5, '0')}`, project_id: P, gate: 'api_contract', status: 'fail',
      completed_at: '2026-10-02T00:00:00Z', started_at: '2026-10-02T00:00:00Z',
    }))
    const stats = await audit.readFullstackAuditStats(makeFakeDb({ gate_runs: runs, gate_findings: [] }, capped) as never, P, NOW)
    expect(stats).toEqual({ errorCount: 0, warnCount: 0, failedGateCount: 1_500, topPriority: 'failures', readError: null })
  })

  it('audit stats past their run ceiling are unknown, never a partial count', async () => {
    const runs = Array.from({ length: 10_001 }, (_, i) => ({
      id: `run-${String(i).padStart(5, '0')}`, project_id: P, gate: 'api_contract', status: 'pass',
      completed_at: '2026-10-02T00:00:00Z', started_at: '2026-10-02T00:00:00Z',
    }))
    const stats = await audit.readFullstackAuditStats(makeFakeDb({ gate_runs: runs, gate_findings: [] }, capped) as never, P, NOW)
    expect(stats.topPriority).toBe('unknown')
    expect(stats.readError).toMatch(/More than 10,000 check runs/)
  })

  it('recipe finding counts include every open error and warn, never info or allowlisted', async () => {
    const findings = [
      ...Array.from({ length: 1_400 }, (_, i) => ({ id: `a${String(i).padStart(5, '0')}`, gate_run_id: 'run-a', severity: i % 2 ? 'error' : 'warn', allowlisted: false })),
      { id: 'b1', gate_run_id: 'run-b', severity: 'info', allowlisted: false },
      { id: 'b2', gate_run_id: 'run-b', severity: 'error', allowlisted: true },
    ]
    const counts = await compose.openFindingCounts(makeFakeDb({ gate_findings: findings }, capped) as never, ['run-a', 'run-b'])
    expect(counts.get('run-a')).toBe(1_400)
    expect(counts.has('run-b')).toBe(false)
  })

  it('recipe finding counts past the row ceiling switch to exact counts per run', async () => {
    const findings = Array.from({ length: 5_300 }, (_, i) => ({
      id: `f${String(i).padStart(5, '0')}`, gate_run_id: i < 5_000 ? 'run-a' : 'run-b', severity: 'error', allowlisted: false,
    }))
    const counts = await compose.openFindingCounts(makeFakeDb({ gate_findings: findings }, capped) as never, ['run-a', 'run-b'])
    expect(counts.get('run-a')).toBe(5_000)
    expect(counts.get('run-b')).toBe(300)
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

  it('an older failing gate still counts when busier gates ran 300+ times since', async () => {
    // 350 daily hole-check runs after one failing api_contract run: a shared
    // "newest 300 runs" page held only radar runs, and the gates card read
    // "no gate has run" while api_contract had an open error.
    const radar = Array.from({ length: 350 }, (_, i) => {
      const at = new Date(Date.parse('2026-10-02T00:00:00Z') + i * 60_000).toISOString()
      return { id: `radar-${String(i).padStart(4, '0')}`, project_id: P, gate: 'portfolio_radar', status: 'warn', started_at: at, completed_at: at }
    })
    const db = makeFakeDb({
      projects: [{ id: P, slug: 'p', organization_id: null }],
      gate_runs: [
        { id: 'old-fail', project_id: P, gate: 'api_contract', status: 'fail', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:05:00Z' },
        // A newer run still in flight is not the latest finished run.
        { id: 'in-flight', project_id: P, gate: 'api_contract', status: 'running', started_at: '2026-10-03T11:00:00Z', completed_at: null },
        ...radar,
      ],
      gate_findings: [{ id: 'f1', gate_run_id: 'old-fail', severity: 'error', allowlisted: false }],
    }, { maxRows: 1_000 })
    const { response } = await compose.composeRecipe(db as never, deps as never, P)
    expect(response.elements.gates).toMatchObject({ state: 'drift', reason: '1 problem to fix: API contract (1). Open Full-stack audit for each one and its fix.' })
  })

  it('reads the newest finished run per gate; for design_drift only a deviance scan counts (not a refresh, an old-CLI push or a run with no phase)', async () => {
    const db = makeFakeDb({
      gate_runs: [
        { id: 'scan-old', project_id: P, gate: 'design_drift', status: 'fail', summary: { phase: 'scan' }, started_at: '2026-09-01T00:00:00Z' },
        { id: 'no-phase', project_id: P, gate: 'design_drift', status: 'warn', summary: null, started_at: '2026-09-02T00:00:00Z' },
        { id: 'refresh-new', project_id: P, gate: 'design_drift', status: 'pass', summary: { phase: 'refresh' }, started_at: '2026-10-02T00:00:00Z' },
        { id: 'old-cli-push', project_id: P, gate: 'design_drift', status: 'warn', summary: { phase: 'ci_scan' }, started_at: '2026-10-01T00:00:00Z' },
        { id: 'queued', project_id: P, gate: 'ci_drift', status: 'queued', started_at: '2026-10-02T00:00:00Z' },
        { id: 'ci-done', project_id: P, gate: 'ci_drift', status: 'skipped', started_at: '2026-09-30T00:00:00Z' },
        { id: 'other-project', project_id: 'someone-else', gate: 'env_drift', status: 'fail', started_at: '2026-10-02T00:00:00Z' },
      ],
    })
    const runs = await compose.loadLatestGateRuns(db as never, P, ['design_drift', 'ci_drift', 'env_drift'])
    expect(runs.map((r) => r.id).sort()).toEqual(['ci-done', 'scan-old'])
    await expect(compose.loadLatestGateRuns(makeFakeDb({}, failing('gate_runs')) as never, P, ['ci_drift'])).rejects.toThrow(/gate_runs \(ci_drift\)/)
  })

  it('the recipe reads every live gate except the radar hole checks', () => {
    expect([...compose.RECIPE_GATES].sort()).toEqual(
      ['api_contract', 'ci_drift', 'code_health', 'crawl', 'dead_handler', 'deploy_drift', 'design_drift', 'env_drift', 'mock_leak', 'orphan_endpoint', 'radar', 'schema_drift', 'spec_drift', 'status_claim', 'unknown_call'],
    )
  })

  it.each(['gate_runs', 'project_settings', 'gate_findings', 'app_recipe_snapshots'])('throws when %s cannot be read', async (table) => {
    const db = makeFakeDb({
      projects: [{ id: P, slug: 'p', organization_id: null }],
      gate_runs: [{ id: 'run-1', project_id: P, gate: 'schema_drift', status: 'fail', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:00:00Z' }],
    }, failing(table))
    await expect(compose.composeRecipe(db as never, deps as never, P)).rejects.toThrow(table)
  })
})
