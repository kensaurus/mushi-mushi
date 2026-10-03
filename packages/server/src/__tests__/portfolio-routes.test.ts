/**
 * `api/routes/portfolio.ts` — the portfolio rollup (Plan 019 Phase P1),
 * driven on a fake Hono app with a fake DB and injected GitHub deps.
 *
 * Covers the P1 acceptance (a 7-project organization → 7 cards, the demo
 * project's SDK skew `unknown`), the access rule (organization members and
 * account-level keys only; project-bound keys and other organizations get
 * 403), one card failing without failing the page, and "open" meaning the
 * latest completed run per (project, gate).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

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
vi.mock('../../supabase/functions/api/routes/project-ci-secrets.ts', () => ({
  inferStack: () => 'nextjs',
  requiredCiVarNames: () => [{ name: 'NEXT_PUBLIC_MUSHI_PROJECT_ID', ghKind: 'variable' }],
}))

type PortfolioModule = typeof import('../../supabase/functions/api/routes/portfolio.ts')
let portfolio: PortfolioModule
let compose: typeof import('../../supabase/functions/api/routes/recipe-compose.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  portfolio = await import('../../supabase/functions/api/routes/portfolio.ts')
  compose = await import('../../supabase/functions/api/routes/recipe-compose.ts')
})

type Handler = (c: FakeContext, next?: () => Promise<void>) => Promise<unknown> | unknown
interface JsonResult { body: { ok: boolean; data?: any; error?: any }; status: number }
interface FakeContext {
  req: { header: (k: string) => string | undefined; param: (k: string) => string | undefined; query: (k: string) => string | undefined }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  json: (body: Record<string, unknown>, status?: number) => JsonResult
}

class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) {
    const keys: string[] = []
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)' })}$`)
    this.routes.push({ method: 'GET', pattern, keys, handlers: h })
  }
  async call(url: string, vars: Record<string, unknown> = {}): Promise<JsonResult> {
    const [path, qs] = url.split('?')
    for (const r of this.routes) {
      const m = r.pattern.exec(path)
      if (!m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
      const query = new URLSearchParams(qs ?? '')
      const v: Record<string, unknown> = { userId: 'user-a', authMethod: 'jwt', ...vars }
      const c: FakeContext = {
        req: { header: () => undefined, param: (k) => params[k], query: (k) => query.get(k) ?? undefined },
        get: (k) => v[k],
        set: (k, val) => { v[k] = val },
        json: (body, status = 200) => ({ body: body as JsonResult['body'], status }),
      }
      let result: unknown
      const run = async (i: number): Promise<void> => {
        if (i === r.handlers.length - 1) { result = await r.handlers[i](c); return }
        const short = await r.handlers[i](c, () => run(i + 1))
        if (result === undefined && short !== undefined) result = short
      }
      await run(0)
      return result as JsonResult
    }
    throw new Error(`no route ${url}`)
  }
}

const ORG_A = '0000000a-0000-4000-8000-000000000000'
const ORG_B = '0000000b-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-02T12:00:00Z')
const pid = (n: number) => `1000000${n}-0000-4000-8000-000000000000`
const NAMES = ['glot.it', 'solo-boss-cloud', 'yen-yen', 'the-wanting-mind', 'Help Her Take Photo', 'tsumagoi', 'mushi-demo']
const P_OTHER = '2000000b-0000-4000-8000-000000000000'

function seed(extra: Record<string, unknown[]> = {}, options: Parameters<typeof makeFakeDb>[1] = {}): FakeDb {
  return makeFakeDb({
    organizations: [{ id: ORG_A, name: 'Kenji apps' }, { id: ORG_B, name: 'Other' }],
    projects: [
      ...NAMES.map((name, i) => ({ id: pid(i + 1), name, slug: name.toLowerCase().replace(/\W+/g, '-'), owner_id: 'user-a', organization_id: ORG_A })),
      { id: P_OTHER, name: 'other', slug: 'other', owner_id: 'user-b', organization_id: ORG_B },
    ],
    organization_members: [
      { organization_id: ORG_A, user_id: 'user-a', role: 'owner' },
      { organization_id: ORG_B, user_id: 'user-b', role: 'owner' },
    ],
    project_members: [],
    project_sdk_observations: [
      { project_id: pid(1), sdk_package: '@mushi-mushi/web', sdk_version: '1.28.0' },
      { project_id: pid(3), sdk_package: '@mushi-mushi/react-native', sdk_version: '0.21.0' },
      ...[2, 4, 5, 6].map((n) => ({ project_id: pid(n), sdk_package: '@mushi-mushi/web', sdk_version: '1.29.0' })),
    ],
    sdk_versions: [
      { package: '@mushi-mushi/web', version: '1.29.0', deprecated: false },
      { package: '@mushi-mushi/web', version: '1.28.0', deprecated: false },
      { package: '@mushi-mushi/react-native', version: '0.21.0', deprecated: false },
    ],
    ...extra,
  } as never, options)
}

function harness(db: FakeDb, over: Partial<PortfolioModule['defaultPortfolioDeps']> = {}) {
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  const deps = {
    getServiceClient: () => db as never,
    adminOrApiKeyRead: pass,
    compose: {
      resolveRepo: vi.fn(async () => ({ ok: false as const, repoConnected: false, tokenAvailable: false, reason: 'no repo' })),
      getDefaultHead: vi.fn(),
      fetchWorkflowRun: vi.fn(),
      listActionsNames: vi.fn(),
      requiredEnvNames: () => ['NEXT_PUBLIC_MUSHI_PROJECT_ID'],
      now: () => NOW,
    },
    composeRecipe: compose.composeRecipe,
    ...over,
  }
  portfolio.registerPortfolioRoutes(app as never, deps as never)
  return { app, deps }
}

describe('GET /v1/admin/orgs/:orgId/portfolio', () => {
  it('returns one card per project of a 7-project organization, never green from no data', async () => {
    const { app } = harness(seed())
    const res = await app.call(`/v1/admin/orgs/${ORG_A}/portfolio`)
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.totalProjects).toBe(7)
    expect(data.cards).toHaveLength(7)
    expect(data.organizationName).toBe('Kenji apps')
    for (const card of data.cards) {
      expect(card.error).toBeNull()
      // Nothing is connected or observed in the fixture: no card may read ok.
      expect(card.worst).not.toBe('ok')
      expect(card.radar.status).toBe('never_run')
    }
    const demo = data.cards.find((c: { name: string }) => c.name === 'mushi-demo')
    expect(demo.sdk).toEqual([expect.objectContaining({ status: 'unknown', package: null })])
    expect(demo.kindSource).toBe('unknown')
    const glot = data.cards.find((c: { name: string }) => c.name === 'glot.it')
    expect(glot.sdk[0]).toMatchObject({ package: '@mushi-mushi/web', version: '1.28.0', latest: '1.29.0', status: 'behind' })
    expect(glot.kind).toBe('site')
    expect(data.cards.find((c: { name: string }) => c.name === 'yen-yen').kind).toBe('app')
  })

  it('a card whose recipe cannot be composed reads error; the page still answers', async () => {
    const real = compose.composeRecipe
    const { app } = harness(seed(), {
      composeRecipe: (async (db: never, deps: never, id: string) => {
        if (id === pid(2)) throw new Error('boom')
        return real(db, deps, id)
      }) as never,
    })
    const res = await app.call(`/v1/admin/orgs/${ORG_A}/portfolio`)
    expect(res.status).toBe(200)
    const bad = res.body.data.cards.find((c: { projectId: string }) => c.projectId === pid(2))
    expect(bad).toMatchObject({ worst: 'error', elements: {} })
    expect(bad.error).toMatch(/could not be composed/)
    expect(res.body.data.cards.filter((c: { error: string | null }) => c.error === null)).toHaveLength(6)
  })

  it('sums 30 days of Mushi LLM spend and reports caps as facts', async () => {
    const db = seed({
      llm_invocations: [
        { project_id: pid(1), cost_usd: '0.40', created_at: '2026-09-30T00:00:00Z' },
        { project_id: pid(1), cost_usd: 0.11, created_at: '2026-09-20T00:00:00Z' },
        { project_id: pid(1), cost_usd: 9, created_at: '2026-08-01T00:00:00Z' },
      ],
      project_settings: [{ project_id: pid(1), autofix_max_spend_usd: '5.0000', monthly_llm_budget_usd: null }],
    })
    const res = await harness(db).app.call(`/v1/admin/orgs/${ORG_A}/portfolio`)
    const glot = res.body.data.cards.find((c: { projectId: string }) => c.projectId === pid(1))
    expect(glot.spend).toEqual({ llmUsd30d: 0.51, llmCalls30d: 2, partial: false, autofixCapUsd: 5, monthlyLlmBudgetUsd: null, capsKnown: true })
    expect(glot.unreadable).toEqual([])
    expect(res.body.data.readErrors).toEqual([])
  })

  it('sums every AI call even when the server returns at most 1,000 rows per request', async () => {
    const calls = Array.from({ length: 2_500 }, (_, i) => ({
      id: `call-${String(i).padStart(5, '0')}`, project_id: pid(1), cost_usd: 0.01, created_at: '2026-09-30T00:00:00Z',
    }))
    const db = seed({ llm_invocations: calls }, { maxRows: 1_000 })
    const res = await harness(db).app.call(`/v1/admin/orgs/${ORG_A}/portfolio`)
    const glot = res.body.data.cards.find((c: { projectId: string }) => c.projectId === pid(1))
    expect(glot.spend).toMatchObject({ llmCalls30d: 2_500, llmUsd30d: 25, partial: false })
    expect(res.body.data.readErrors).toEqual([])
  })
})

describe('portfolio fail-open: a failed read is never $0, "no cap", "none yet" or "no holes"', () => {
  const failing = (...tables: string[]) => ({ failRead: (t: string) => (tables.includes(t) ? `relation "${t}" is unavailable` : null) })

  it('a failed spend read leaves the spend unknown and names it, the page still answers', async () => {
    const res = await harness(seed({}, failing('llm_invocations'))).app.call(`/v1/admin/orgs/${ORG_A}/portfolio`)
    expect(res.status).toBe(200)
    for (const card of res.body.data.cards) {
      expect(card.spend.llmUsd30d).toBeNull()
      expect(card.spend.llmCalls30d).toBeNull()
      expect(card.unreadable).toContain('spend')
    }
    expect(res.body.data.readErrors).toEqual([expect.objectContaining({ part: 'spend', kind: 'failed' })])
    // The raw database message never reaches the payload.
    expect(JSON.stringify(res.body.data.readErrors)).not.toMatch(/relation/)
  })

  it('failed settings reads make caps and integration holes unknown, not "no cap" / "no holes"', async () => {
    const page = await harness(seed({}, failing('project_settings'))).app.call(`/v1/admin/orgs/${ORG_A}/portfolio`)
    expect(page.status).toBe(200)
    expect(page.body.data.holes).toBeNull()
    for (const card of page.body.data.cards) {
      expect(card.spend.capsKnown).toBe(false)
      expect(card.unreadable).toContain('caps')
      // The recipe reads the same settings: its card reads error, never "not connected".
      expect(card.worst).toBe('error')
    }
    const parts = page.body.data.readErrors.map((e: { part: string }) => e.part).sort()
    expect(parts).toEqual(['caps', 'integrations'])

    const findings = await harness(seed({}, failing('project_repos'))).app.call(`/v1/admin/orgs/${ORG_A}/portfolio/findings`)
    expect(findings.status).toBe(200)
    expect(findings.body.data.holes).toEqual([])
    expect(findings.body.data.readErrors).toEqual([expect.objectContaining({ part: 'integrations', kind: 'failed' })])
  })

  it('failed SDK, kind and release reads are listed per card', async () => {
    const res = await harness(seed({}, failing('project_sdk_observations', 'app_recipe_snapshots', 'releases'))).app.call(`/v1/admin/orgs/${ORG_A}/portfolio`)
    expect(res.status).toBe(200)
    const glot = res.body.data.cards.find((c: { projectId: string }) => c.projectId === pid(1))
    expect(glot.sdk).toEqual([])
    expect(glot.kind).toBeNull()
    expect(glot.kindSource).toBe('unknown')
    expect(glot.unreadable).toEqual(['sdk', 'releases', 'kind'])
  })

  it('a failed cross-project read is named on the findings page', async () => {
    const res = await harness(seed({}, failing('portfolio_findings'))).app.call(`/v1/admin/orgs/${ORG_A}/portfolio/findings`)
    expect(res.status).toBe(200)
    expect(res.body.data.crossProject).toEqual([])
    expect(res.body.data.readErrors).toEqual([expect.objectContaining({ part: 'cross_project', kind: 'failed' })])
  })

  it('without the project list or the gate runs the page fails loudly instead of showing "no apps"', async () => {
    const codes: Record<string, string> = { projects: 'DB_ERROR', project_members: 'DB_ERROR', gate_runs: 'PORTFOLIO_FAILED', reports: 'PORTFOLIO_FAILED' }
    for (const [table, code] of Object.entries(codes)) {
      const res = await harness(seed({}, failing(table))).app.call(`/v1/admin/orgs/${ORG_A}/portfolio`)
      expect(res.status, table).toBe(500)
      expect(res.body.error.code, table).toBe(code)
    }
  })

  it('a membership read that fails is a 500, not "you are not a member"', async () => {
    const res = await harness(seed({}, failing('organization_members'))).app.call(`/v1/admin/orgs/${ORG_A}/portfolio`)
    expect(res.status).toBe(500)
  })
})

describe('portfolio access', () => {
  const urls = [`/v1/admin/orgs/${ORG_B}/portfolio`, `/v1/admin/orgs/${ORG_B}/portfolio/findings`]

  it('a member of organization A gets 403 on organization B, by JWT and by account-level key', async () => {
    const { app, deps } = harness(seed())
    for (const url of urls) {
      expect((await app.call(url)).status, url).toBe(403)
      expect((await app.call(url, { authMethod: 'apiKey', isOrgScopedKey: true })).status, url).toBe(403)
    }
    expect(deps.compose.resolveRepo).not.toHaveBeenCalled()
  })

  it('a project-bound key is refused even for its own organization', async () => {
    const { app } = harness(seed())
    const res = await app.call(`/v1/admin/orgs/${ORG_A}/portfolio`, { authMethod: 'apiKey', isOrgScopedKey: false, projectId: pid(1) })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PORTFOLIO_NEEDS_ACCOUNT_KEY')
  })

  it('an account-level key of a member reads the portfolio', async () => {
    const res = await harness(seed()).app.call(`/v1/admin/orgs/${ORG_A}/portfolio`, { authMethod: 'apiKey', isOrgScopedKey: true })
    expect(res.status).toBe(200)
    expect(res.body.data.cards).toHaveLength(7)
  })

  it('only lists projects the caller can reach inside the organization', async () => {
    const db = seed()
    // user-c is an org member who owns nothing: membership grants every org project.
    db.table('organization_members').push({ organization_id: ORG_A, user_id: 'user-c', role: 'member' })
    const res = await harness(db).app.call(`/v1/admin/orgs/${ORG_A}/portfolio`, { userId: 'user-c' })
    expect(res.body.data.cards).toHaveLength(7)
    expect(res.body.data.cards.some((c: { projectId: string }) => c.projectId === P_OTHER)).toBe(false)
  })

  it('`current` resolves a single organization and asks to choose when there are several', async () => {
    const db = seed()
    const { app } = harness(db)
    const one = await app.call('/v1/admin/orgs/current/portfolio')
    expect(one.status).toBe(200)
    expect(one.body.data.organizationId).toBe(ORG_A)
    db.table('organization_members').push({ organization_id: ORG_B, user_id: 'user-a', role: 'member' })
    const two = await app.call('/v1/admin/orgs/current/portfolio')
    expect(two.status).toBe(400)
    expect(two.body.error.code).toBe('ORG_REQUIRED')
    expect(two.body.error.organizations).toHaveLength(2)
  })

  it('a malformed organization id is 404', async () => {
    expect((await harness(seed()).app.call('/v1/admin/orgs/nope/portfolio')).status).toBe(404)
  })
})

describe('GET /v1/admin/orgs/:orgId/portfolio/findings', () => {
  it('groups only findings from the latest completed run per (project, gate)', async () => {
    const run = (id: string, project: number, gate: string, startedAt: string, status = 'fail', summary: unknown = {}) =>
      ({ id, project_id: pid(project), gate, status, summary, started_at: startedAt, completed_at: startedAt })
    const finding = (runId: string, project: number, rule: string, severity = 'warn') =>
      ({ gate_run_id: runId, project_id: pid(project), rule_id: rule, severity, message: `${rule} in ${project}`, allowlisted: false })
    const db = seed({
      gate_runs: [
        run('old-1', 1, 'code_health', '2026-09-01T00:00:00Z'),
        run('new-1', 1, 'code_health', '2026-10-01T00:00:00Z'),
        run('new-2', 2, 'code_health', '2026-10-01T00:00:00Z'),
        run('run-3', 3, 'code_health', '2026-10-01T00:00:00Z', 'running'),
        // A design refresh run must not hide the latest design scan.
        run('scan-1', 1, 'design_drift', '2026-09-30T00:00:00Z'),
        run('refresh-1', 1, 'design_drift', '2026-10-01T00:00:00Z', 'pass', { phase: 'refresh' }),
        run('scan-2', 2, 'design_drift', '2026-09-30T00:00:00Z'),
      ],
      gate_findings: [
        finding('old-1', 1, 'stale_rule'),
        finding('new-2', 2, 'stale_rule'),
        finding('new-1', 1, 'god_file'),
        finding('new-2', 2, 'god_file', 'error'),
        finding('run-3', 3, 'god_file'),
        finding('scan-1', 1, 'off_token_color'),
        finding('scan-2', 2, 'off_token_color'),
        { ...finding('new-1', 1, 'allowlisted_rule'), allowlisted: true },
        { ...finding('new-2', 2, 'allowlisted_rule'), allowlisted: true },
      ],
    })
    const res = await harness(db).app.call(`/v1/admin/orgs/${ORG_A}/portfolio/findings`)
    expect(res.status).toBe(200)
    const groups = res.body.data.groups as Array<{ ruleId: string; projectIds: string[]; severity: string }>
    expect(groups.map((g) => g.ruleId).sort()).toEqual(['god_file', 'off_token_color'])
    expect(groups.find((g) => g.ruleId === 'god_file')).toMatchObject({ severity: 'error', projectIds: [pid(1), pid(2)] })
    expect(res.body.data.sdkSkew.filter((e: { status: string }) => e.status === 'unknown')).toHaveLength(1)
  })
})
