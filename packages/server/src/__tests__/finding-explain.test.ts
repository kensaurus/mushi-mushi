/**
 * explain_finding (gap #24): GET /v1/admin/findings/:findingId and the pure
 * explainFinding / fixOf helpers. One finding by id: the check, why it fired,
 * where, the fix in one sentence, and whether the latest run of the same
 * check still reports it. A read failure must not read as "fixed".
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let helper: typeof import('../../supabase/functions/_shared/finding-explain.ts')
let routes: typeof import('../../supabase/functions/api/routes/finding-explain.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  helper = await import('../../supabase/functions/_shared/finding-explain.ts')
  routes = await import('../../supabase/functions/api/routes/finding-explain.ts')
})

const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const RUN_OLD = '2000000a-0000-4000-8000-000000000000'
const RUN_NEW = '2000000b-0000-4000-8000-000000000000'
const F_OLD = '3000000a-0000-4000-8000-000000000000'
const F_NEW = '3000000b-0000-4000-8000-000000000000'
const F_OTHER = '3000000c-0000-4000-8000-000000000000'

function finding(over: Record<string, unknown> = {}) {
  return {
    id: F_OLD, gate_run_id: RUN_OLD, project_id: P1, severity: 'error', rule_id: 'god_file', message: 'src/app.tsx is 2,400 lines.',
    file_path: 'src/app.tsx', line: 1, col: null, node_id: null, suggested_fix: { text: 'Split the routes out of src/app.tsx.' },
    allowlisted: false, allowlist_reason: null, created_at: '2026-10-01T00:00:00Z', ...over,
  }
}
const run = (over: Record<string, unknown> = {}) => ({
  id: RUN_OLD, gate: 'code_health', status: 'fail', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', commit_sha: 'abc1234', ...over,
})

describe('fixOf reads every stored fix shape', () => {
  it('reads radar, recipe drift, setup and inventory fixes', () => {
    expect(helper.fixOf({ fix: 'Renew the domain.', target: 'example.com' }).text).toBe('Renew the domain.')
    expect(helper.fixOf({ kind: 'patch', text: 'timeout-minutes: 15' })).toMatchObject({ text: 'timeout-minutes: 15', kind: 'patch' })
    expect(helper.fixOf({ kind: 'setup', step: 'Reconnect Linear.' }).text).toBe('Reconnect Linear.')
    expect(helper.fixOf({ explanation: 'Declare it in inventory.yaml.', route: '/api/x' }).text).toBe('Declare it in inventory.yaml.')
  })
  it('turns a design deviance into the token to use', () => {
    const fix = helper.fixOf({ value: '#ff0000', suggestion: { token: 'color.danger', cssVar: '--color-danger', value: '#f00', distance: 1 } })
    expect(fix.text).toBe('Replace `#ff0000` with the design token color.danger (var(--color-danger)).')
  })
  it('turns console steps and commands into one sentence, keeping the raw object', () => {
    const consoleFix = helper.fixOf({ kind: 'console', path: '/settings?tab=general', values: { autofix_max_spend_usd: 25 } })
    expect(consoleFix).toMatchObject({ consolePath: '/settings?tab=general', text: 'Open /settings?tab=general in the Mushi console and set autofix_max_spend_usd = 25.' })
    expect(consoleFix.detail).toEqual({ kind: 'console', path: '/settings?tab=general', values: { autofix_max_spend_usd: 25 } })
    expect(helper.fixOf({ kind: 'command', command: 'mushi index', console_path: '/explore?tab=index' })).toMatchObject({ text: 'Run `mushi index`.', command: 'mushi index', consolePath: '/explore?tab=index' })
    expect(helper.fixOf({ kind: 'setting', field: 'project_repos.default_branch', value: 'main' }).text).toBe('Set project_repos.default_branch to main.')
  })
  it('returns no text, never a guess, for an unknown or empty fix', () => {
    expect(helper.fixOf(null)).toEqual({ text: null, kind: null, consolePath: null, command: null, detail: null })
    expect(helper.fixOf({ method: 'GET', path: '/v1/x' }).text).toBeNull()
  })
})

describe('explainFinding', () => {
  it('explains a finding in the latest run as open, with the gate meaning and location', () => {
    const out = helper.explainFinding(finding(), run(), { id: RUN_OLD, completed_at: '2026-10-01T00:01:00Z', matchingFindingId: F_OLD })
    expect(out).toMatchObject({
      gate: 'code_health', gateLabel: 'Code health', ruleId: 'god_file', reason: 'src/app.tsx is 2,400 lines.',
      location: { filePath: 'src/app.tsx', line: 1, col: null, target: null }, state: 'open',
      fix: { text: 'Split the routes out of src/app.tsx.' }, latestRun: { id: RUN_OLD, findingId: F_OLD },
    })
    expect(out.gateMeaning.length).toBeGreaterThan(10)
  })
  it('adds the radar rule title and what it prevents', () => {
    const out = helper.explainFinding(finding({ rule_id: 'domain_expiring', file_path: null }), run({ gate: 'portfolio_radar' }), null)
    expect(out.rule?.title).toBe('Domain not about to expire')
    expect(out.rule?.prevents).toContain('domain')
  })
  it('says not_in_latest_run when a newer run no longer has it, and open when it does', () => {
    expect(helper.explainFinding(finding(), run(), { id: RUN_NEW, completed_at: null, matchingFindingId: null }).state).toBe('not_in_latest_run')
    expect(helper.explainFinding(finding(), run(), { id: RUN_NEW, completed_at: null, matchingFindingId: F_NEW })).toMatchObject({ state: 'open', latestRun: { findingId: F_NEW } })
  })
  it('reports an allowlisted finding as allowlisted, with the reason', () => {
    const out = helper.explainFinding(finding({ allowlisted: true, allowlist_reason: 'generated file' }), run(), null)
    expect(out).toMatchObject({ state: 'allowlisted', stateReason: 'Allowlisted: generated file' })
  })
  it('knows a label for every gate_runs gate', () => {
    for (const gate of ['dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim', 'spec_drift', 'orphan_endpoint', 'unknown_call', 'schema_drift', 'code_health', 'design_drift', 'ci_drift', 'deploy_drift', 'env_drift', 'portfolio_radar', 'portfolio_radar_ci', 'store_review', 'radar']) {
      expect(helper.GATE_MEANINGS[gate], gate).toBeDefined()
    }
  })
})

type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown
class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  get(path: string, ...handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method: 'GET', keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  async call(url: string, vars: Record<string, unknown> = {}): Promise<{ status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (!m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const ctxVars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...vars }
      const c = {
        req: { param: (k: string) => params[k], query: () => undefined, header: () => undefined },
        get: (k: string) => ctxVars[k], set: (k: string, v: unknown) => { ctxVars[k] = v },
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      return (await r.handlers[r.handlers.length - 1](c)) as { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
    }
    throw new Error(`no route GET ${url}`)
  }
}

function setup(extra: Record<string, unknown[]> = {}) {
  const db = makeFakeDb({
    projects: [{ id: P1, owner_id: 'owner', organization_id: null }, { id: P2, owner_id: 'stranger', organization_id: null }],
    organization_members: [],
    project_members: [],
    gate_runs: [
      { id: RUN_OLD, project_id: P1, gate: 'code_health', status: 'fail', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', commit_sha: 'abc1234', summary: null },
    ],
    gate_findings: [finding()],
    ...extra,
  } as never)
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  routes.registerFindingExplainRoutes(app as never, { getServiceClient: () => db as never, adminOrApiKeyRead: pass })
  return { db, app }
}

describe('GET /v1/admin/findings/:findingId', () => {
  it('explains a finding of a project the caller can reach', async () => {
    const { app } = setup()
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: F_OLD, gate: 'code_health', state: 'open', fix: { text: 'Split the routes out of src/app.tsx.' } })
  })

  it('is a 404 for another tenant, an unknown id and a non-uuid alike', async () => {
    const { app } = setup({ gate_findings: [finding(), finding({ id: F_OTHER, project_id: P2 })] })
    for (const id of [F_OTHER, '3000000f-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const res = await app.call(`/v1/admin/findings/${id}`)
      expect(res.status, id).toBe(404)
      expect(res.body.error?.code).toBe('NOT_FOUND')
    }
  })

  it('refuses a project-bound key aimed at another of the owner\'s projects', async () => {
    const { app } = setup()
    const res = await app.call(`/v1/admin/findings/${F_OLD}`, { authMethod: 'apiKey', projectId: P2 })
    expect(res.status).toBe(404)
  })

  it('reports not_in_latest_run when a newer run of the same check no longer has it', async () => {
    const { app, db } = setup()
    ;(db as FakeDb).table('gate_runs').push({ id: RUN_NEW, project_id: P1, gate: 'code_health', status: 'pass', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:01:00Z', commit_sha: 'def5678', summary: null })
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ state: 'not_in_latest_run', latestRun: { id: RUN_NEW, findingId: null } })
  })

  it('reports open when the newer run found the same rule in the same file', async () => {
    const { app, db } = setup()
    ;(db as FakeDb).table('gate_runs').push({ id: RUN_NEW, project_id: P1, gate: 'code_health', status: 'fail', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:01:00Z', commit_sha: 'def5678', summary: null })
    ;(db as FakeDb).table('gate_findings').push(finding({ id: F_NEW, gate_run_id: RUN_NEW, line: 3 }))
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ state: 'open', latestRun: { id: RUN_NEW, findingId: F_NEW } })
  })

  it('ignores a still-running run and design token-refresh rows when picking the latest run', async () => {
    const { app, db } = setup({
      gate_runs: [
        { id: RUN_OLD, project_id: P1, gate: 'design_drift', status: 'fail', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', commit_sha: 'a', summary: { phase: 'scan' } },
        { id: RUN_NEW, project_id: P1, gate: 'design_drift', status: 'pass', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:00:05Z', commit_sha: 'b', summary: { phase: 'refresh' } },
        { id: '2000000c-0000-4000-8000-000000000000', project_id: P1, gate: 'design_drift', status: 'running', started_at: '2026-10-03T00:00:00Z', completed_at: null, commit_sha: 'c', summary: { phase: 'scan' } },
      ],
    })
    void db
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ gate: 'design_drift', state: 'open', latestRun: { id: RUN_OLD } })
  })

  it('answers 500, never "fixed", when the latest-run read fails', async () => {
    const { app, db } = setup()
    const real = (db as FakeDb).from.bind(db)
    ;(db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t)
      if (t !== 'gate_runs') return q
      // The by-id run read uses maybeSingle; the latest-run list read does not.
      return new Proxy(q, {
        get(target, prop, receiver) {
          if (prop === 'not') return () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) })
          return Reflect.get(target, prop, receiver)
        },
      })
    }
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.status).toBe(500)
    expect(res.body.error?.code).toBe('DB_ERROR')
  })
})
