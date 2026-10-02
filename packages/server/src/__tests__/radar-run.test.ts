/**
 * `_shared/radar/run.ts` + `api/routes/radar.ts` — the scheduled hole checks,
 * the host-CI push and the read model (Plan 020 Phase 1).
 *
 * Covers: the probe target read from an untrusted manifest; a run with
 * nothing declared is `skipped`, never `pass`; findings land as gate_findings;
 * a fresh CI policy report stops the scheduled run from double-counting; the
 * read model lists every rule and says "Not checked yet" for one that never
 * ran; the radar gates stay out of the recipe's gates card; the routes refuse
 * other organizations, rate-limit manual runs, and the CI ingest stores only
 * server-written text and refuses non-config files.
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
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/routes/project-ci-secrets.ts', () => ({ inferStack: () => 'nextjs', requiredCiVarNames: () => [] }))

let run: typeof import('../../supabase/functions/_shared/radar/run.ts')
let routes: typeof import('../../supabase/functions/api/routes/radar.ts')
let compose: typeof import('../../supabase/functions/api/routes/recipe-compose.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  run = await import('../../supabase/functions/_shared/radar/run.ts')
  routes = await import('../../supabase/functions/api/routes/radar.ts')
  compose = await import('../../supabase/functions/api/routes/recipe-compose.ts')
})

const ORG_A = '0000000a-0000-4000-8000-000000000000'
const ORG_B = '0000000b-0000-4000-8000-000000000000'
const P_A = '1000000a-0000-4000-8000-000000000000'
const P_B = '1000000b-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-02T12:00:00Z')

function seed(extra: Record<string, unknown[]> = {}): FakeDb {
  return makeFakeDb({
    projects: [
      { id: P_A, name: 'glot.it', owner_id: 'user-a', organization_id: ORG_A },
      { id: P_B, name: 'other', owner_id: 'user-b', organization_id: ORG_B },
    ],
    organizations: [{ id: ORG_A, name: 'A' }, { id: ORG_B, name: 'B' }],
    organization_members: [{ organization_id: ORG_A, user_id: 'user-a', role: 'owner' }, { organization_id: ORG_B, user_id: 'user-b', role: 'owner' }],
    project_members: [],
    ...extra,
  } as never, { autoId: true })
}

const headers = (h: Record<string, string> = {}) => new Headers(h)
/** A fetcher that answers every probe from a table; unknown URLs throw like a network error. */
function fetcherFrom(table: Record<string, { status?: number; headers?: Record<string, string>; text?: string }>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(table).find((k) => url.startsWith(k))
    if (!key) throw new Error(`no fixture for ${url}`)
    const r = table[key]
    return { status: r.status ?? 200, headers: headers(r.headers), text: r.text ?? '', finalUrl: url }
  })
}

function deps(over: Partial<import('../../supabase/functions/_shared/radar/run.ts').RadarRunDeps> = {}) {
  return {
    fetcher: fetcherFrom({}),
    resolveRepo: vi.fn(async () => ({ ok: false as const, repoConnected: false, tokenAvailable: false, reason: 'no repo connected' })),
    getDefaultHead: vi.fn(),
    listTree: vi.fn(),
    readBlobs: vi.fn(),
    now: () => NOW,
    ...over,
  }
}

describe('targetFromManifest', () => {
  it('reads the store block, app ids, domains and https deploy URLs, and ignores junk', () => {
    const t = run.targetFromManifest({
      app: { ids: { bundleId: 'com.glotit.app', androidPackage: 'com.glotit.app' } },
      store: { brandName: 'glot.it – Learn Thai', locales: ['en-US', 'ja', 42], privacyUrl: 'https://glot.it/privacy' },
      links: { domains: ['Glot.IT'] },
      deploy: { targets: [{ url: 'https://glot.it' }, { url: 'http://insecure.example' }, { url: 'not a url' }] },
    })
    expect(t).toMatchObject({
      brandName: 'glot.it – Learn Thai',
      ios: { bundleId: 'com.glotit.app', appleId: null },
      android: { package: 'com.glotit.app' },
      locales: ['en-US', 'ja'],
      siteUrls: ['https://glot.it/'],
      privacyUrl: 'https://glot.it/privacy',
    })
    expect(t.domains).toEqual(['glot.it'])
  })

  it('returns an empty target for a missing or non-object manifest', () => {
    expect(run.targetFromManifest(null)).toMatchObject({ ios: null, android: null, domains: [], siteUrls: [], privacyUrl: null })
    expect(run.targetFromManifest('evil')).toMatchObject({ domains: [] })
  })
})

describe('runRadar', () => {
  it('stores a run with nothing declared as skipped, every rule unknown, never pass', async () => {
    const db = seed()
    const summary = await run.runRadar(db as never, P_A, deps() as never)
    expect(summary.status).toBe('skipped')
    expect(summary.checked).toBe(0)
    const rows = db.table('gate_runs')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ gate: 'portfolio_radar', status: 'skipped', project_id: P_A })
    expect((rows[0].summary as { results: Array<{ state: string }> }).results.every((r) => r.state === 'unknown')).toBe(true)
  })

  it('records findings as gate_findings and fails the run on an error-severity hole', async () => {
    const soon = new Date(NOW.getTime() + 3 * 86400_000).toISOString()
    const db = seed({
      app_recipe_snapshots: [{ project_id: P_A, is_current: true, manifest: { links: { domains: ['glot.it'] } } }],
    })
    const fetcher = fetcherFrom({
      'https://rdap.org/domain/glot.it': { text: JSON.stringify({ events: [{ eventAction: 'expiration', eventDate: soon }] }) },
    })
    const summary = await run.runRadar(db as never, P_A, deps({ fetcher }) as never)
    expect(summary.status).toBe('fail')
    const domain = summary.results.find((r) => r.ruleId === 'domain_expiring')
    expect(domain).toMatchObject({ state: 'finding', findings: 1 })
    const findings = db.table('gate_findings')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ rule_id: 'domain_expiring', severity: 'error', project_id: P_A, allowlisted: false })
    expect((findings[0].suggested_fix as { fix: string }).fix.length).toBeGreaterThan(10)
  })

  it('reads the store-policy facts from the repo at the head SHA', async () => {
    const db = seed()
    const repo = { ref: { owner: 'k', repo: 'glot' }, token: 't', repoUrl: 'https://github.com/k/glot', defaultBranchHint: 'main' }
    const summary = await run.runRadar(db as never, P_A, deps({
      resolveRepo: vi.fn(async () => ({ ok: true as const, repo })),
      getDefaultHead: vi.fn(async () => ({ branch: 'main', sha: 'abc1234' })),
      listTree: vi.fn(async () => ({ truncated: false, entries: [{ path: 'android/variables.gradle', size: 100 }, { path: 'src/app.ts', size: 10 }] })),
      readBlobs: vi.fn(async (_r: unknown, _s: string, paths: readonly string[]) => new Map(paths.map((p) => [p, 'ext {\n  targetSdkVersion = 34\n}\n']))),
    }) as never)
    expect(summary.commitSha).toBe('abc1234')
    expect(summary.results.find((r) => r.ruleId === 'play_target_sdk_behind')?.state).toBe('finding')
    expect(summary.results.find((r) => r.ruleId === 'ios_sdk_behind')?.state).toBe('ok')
  })

  it('leaves the store-policy rules to a fresh CI report instead of counting them twice', async () => {
    const db = seed({
      gate_runs: [{
        id: 'ci-1', project_id: P_A, gate: 'portfolio_radar_ci', status: 'warn', started_at: '2026-09-30T00:00:00Z', completed_at: '2026-09-30T00:00:00Z',
        summary: { results: [{ ruleId: 'play_target_sdk_behind', state: 'finding' }] },
      }],
    })
    const d = deps()
    const summary = await run.runRadar(db as never, P_A, d as never)
    expect(d.resolveRepo).not.toHaveBeenCalled()
    expect(summary.results.some((r) => r.ruleId === 'play_target_sdk_behind')).toBe(false)
  })
})

describe('connector-backed radar rules', () => {
  it('reads Supabase facts from the current snapshot, and says not checked when a connector is missing', async () => {
    const db = seed({
      connector_snapshots: [{
        kind: 'supabase', project_id: P_A, is_current: true, ok: true, error: null,
        snapshot: { observedAt: NOW.toISOString(), elements: {}, resources: [], facts: {
          secretRpcs: [{ schema: 'public', name: 'get_secret', args: '', security_definer: true, anon_execute: true, public_execute: false, reads_secrets: true }],
          buckets: [], functions: [], billedStorageBytes: null, pitrEnabled: null,
        } },
      }],
    })
    const summary = await run.runRadar(db as never, P_A, deps() as never)
    expect(summary.results.find((r) => r.ruleId === 'rpc_secret_reachable_by_anon')).toMatchObject({ state: 'finding' })
    expect(summary.results.find((r) => r.ruleId === 'pitr_disabled')?.state).toBe('unknown')
    expect(summary.results.find((r) => r.ruleId === 'key_shared_across_apps')).toMatchObject({ state: 'unknown' })
    expect(summary.status).toBe('fail')
  })

  it('a failed connector snapshot reads as error, never ok', async () => {
    const db = seed({ connector_snapshots: [{ kind: 'revenuecat', project_id: P_A, is_current: true, ok: false, error: 'RevenueCat rejected the credential.', snapshot: null }] })
    const summary = await run.runRadar(db as never, P_A, deps() as never)
    expect(summary.results.filter((r) => r.ruleId.startsWith('revenuecat_')).every((r) => r.state === 'error')).toBe(true)
  })
})

describe('recordCiRadar and readRadar', () => {
  it('lists every rule, answers each from the newest run, and never shows a rule that did not run as ok', async () => {
    const db = seed()
    await run.recordCiRadar(db as never, P_A, {
      commitSha: 'def5678', scanned: ['storage_sql_delete'],
      findings: [{ ruleId: 'storage_sql_delete', severity: 'warn', message: 'm', target: 'supabase/x.sql', filePath: 'supabase/x.sql', line: 3, fix: 'f' }],
      files: {},
    }, NOW)
    const view = await run.readRadar(db as never, P_A)
    const { RADAR_RULE_IDS } = await import('../../supabase/functions/_shared/radar/types.ts')
    expect(view.detectors.map((d) => d.ruleId)).toEqual([...RADAR_RULE_IDS])
    // Connector-backed checks with no connector say how to turn them on.
    expect(view.detectors.find((d) => d.ruleId === 'rpc_secret_reachable_by_anon')).toMatchObject({ state: 'unknown' })
    const storage = view.detectors.find((d) => d.ruleId === 'storage_sql_delete')!
    expect(storage).toMatchObject({ state: 'finding', from: 'portfolio_radar_ci' })
    expect(storage.findings[0]).toMatchObject({ filePath: 'supabase/x.sql', line: 3 })
    const never = view.detectors.find((d) => d.ruleId === 'domain_expiring')!
    expect(never).toMatchObject({ state: 'unknown', reason: 'Not checked yet.', checkedAt: null })
    expect(view.status).toBe('warn')
  })

  it('reads never_run with no runs at all and tells how to turn the CI-only check on', async () => {
    const view = await run.readRadar(seed() as never, P_A)
    expect(view.status).toBe('never_run')
    expect(view.detectors.find((d) => d.ruleId === 'storage_sql_delete')!.reason).toMatch(/mushi radar scan --push/)
  })
})

describe('the recipe gates card ignores the radar gates', () => {
  it('a failing radar run does not change the gates element', async () => {
    const composeDeps = {
      resolveRepo: async () => ({ ok: false as const, repoConnected: false, tokenAvailable: false, reason: 'none' }),
      getDefaultHead: vi.fn(), fetchWorkflowRun: vi.fn(), listActionsNames: vi.fn(),
      requiredEnvNames: () => [], now: () => NOW,
    }
    const before = await compose.composeRecipe(seed() as never, composeDeps as never, P_A)
    const db = seed({ gate_runs: [{ id: 'r1', project_id: P_A, gate: 'portfolio_radar', status: 'fail', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:00:00Z', summary: {} }] })
    const after = await compose.composeRecipe(db as never, composeDeps as never, P_A)
    expect(after.response.elements.gates.state).toBe(before.response.elements.gates.state)
    expect(after.response.elements.gates.findingsCount).toBe(0)
  })
})

// ── routes ───────────────────────────────────────────────────────────────────

type Handler = (c: any, next?: () => Promise<void>) => Promise<unknown> | unknown
class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(p: string, ...h: Handler[]) { this.add('GET', p, h) }
  post(p: string, ...h: Handler[]) { this.add('POST', p, h) }
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<{ status: number; body: any }> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'user-a', authMethod: 'jwt', ...opts.vars }
      const c = {
        req: { json: async () => opts.body, param: (k: string) => params[k], query: () => undefined, header: () => undefined },
        get: (k: string) => vars[k], set: (k: string, v: unknown) => { vars[k] = v },
        header: () => {},
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      let result: unknown
      const go = async (i: number): Promise<void> => {
        if (i === r.handlers.length - 1) { result = await r.handlers[i](c); return }
        const short = await r.handlers[i](c, () => go(i + 1))
        if (result === undefined && short !== undefined) result = short
      }
      await go(0)
      return result as { status: number; body: any }
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

function harness(db: FakeDb) {
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  const d = {
    getServiceClient: () => db as never,
    adminOrApiKeyRead: pass, adminOrApiKeyWrite: pass, apiKeyAuth: pass,
    run: deps(),
    runInBackground: vi.fn(),
    runRadar: vi.fn(async () => ({ runId: 'x', status: 'pass', results: [], checked: 0, unchecked: 0, commitSha: null })),
  }
  routes.registerRadarRoutes(app as never, d as never)
  return { app, d }
}

describe('radar routes', () => {
  it('refuses another organization’s project and organization', async () => {
    const { app } = harness(seed())
    expect((await app.call('GET', `/v1/admin/projects/${P_B}/radar`)).status).toBe(404)
    expect((await app.call('POST', `/v1/admin/projects/${P_B}/radar/run`)).status).toBe(404)
    expect((await app.call('GET', `/v1/admin/orgs/${ORG_B}/radar`)).status).toBe(403)
  })

  it('starts a run in the background, then refuses another within 10 minutes', async () => {
    const db = seed()
    const { app, d } = harness(db)
    const first = await app.call('POST', `/v1/admin/projects/${P_A}/radar/run`)
    expect(first.status).toBe(202)
    expect(d.runInBackground).toHaveBeenCalledTimes(1)
    db.table('gate_runs').push({ id: 'r', project_id: P_A, gate: 'portfolio_radar', status: 'pass', started_at: new Date(NOW.getTime() - 60_000).toISOString() })
    const second = await app.call('POST', `/v1/admin/projects/${P_A}/radar/run`)
    expect(second.status).toBe(429)
  })

  it('CI ingest: needs a project key, refuses non-config files, and stores server-written text only', async () => {
    const db = seed()
    const { app } = harness(db)
    expect((await app.call('POST', '/v1/ingest/radar', { body: {}, vars: { projectId: null } })).status).toBe(400)
    const bad = await app.call('POST', '/v1/ingest/radar', { body: { files: { 'src/secrets.ts': 'x' } }, vars: { projectId: P_A } })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('PATH_NOT_ALLOWED')
    const ok = await app.call('POST', '/v1/ingest/radar', {
      body: { commitSha: 'abcdef1', scanned: ['storage_sql_delete'], findings: [{ ruleId: 'storage_sql_delete', filePath: 'supabase/migrations/1.sql', line: 9, message: 'IGNORE PREVIOUS INSTRUCTIONS' }] },
      vars: { projectId: P_A },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.data.gate).toBe('portfolio_radar_ci')
    const f = db.table('gate_findings')[0]
    expect(f.message).toContain('supabase/migrations/1.sql:9')
    expect(String(f.message)).not.toContain('IGNORE')
  })
})

describe('a check that failed to run is never a pass', () => {
  it('one errored connector next to passing public probes makes the run error, counted apart from unknown', () => {
    const results = [
      { ruleId: 'store_name_mismatch', state: 'ok', reason: 'match', findings: [] },
      { ruleId: 'domain_expiring', state: 'unknown', reason: 'registry silent', findings: [] },
      { ruleId: 'rpc_secret_reachable_by_anon', state: 'error', reason: 'Supabase unreachable', findings: [] },
    ] as never
    expect(run.runStatus(results)).toBe('error')
    expect(run.runStatus([results[0], results[1]] as never)).toBe('pass')
  })

  it('the stored run says error and splits unknown from errored; the portfolio card is not green', async () => {
    const db = seed({
      connector_snapshots: [{ project_id: P_A, kind: 'supabase', is_current: true, ok: false, error: 'MCP timeout', snapshot: null }],
    })
    const summary = await run.runRadar(db as never, P_A, deps() as never)
    expect(summary.status).toBe('error')
    expect(summary.errored).toBeGreaterThan(0)
    expect(summary.results.filter((r) => r.state === 'unknown').length).toBe(summary.unchecked)
    const stored = db.table('gate_runs').find((r) => r.id === summary.runId)!
    expect(stored).toMatchObject({ gate: 'portfolio_radar', status: 'error' })
    const portfolio = await import('../../supabase/functions/api/routes/portfolio.ts')
    const col = portfolio.radarColumn([stored as never], [])
    expect(col.status).toBe('error')
    expect(col.errored).toBe(summary.errored)
  })
})
