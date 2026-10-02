/**
 * Plan 019 Phase 2 / P2 wiring: recipe-phase2.ts (connectors → drift gates,
 * CI runs, deploy observations, resources, cross-project findings), the
 * connector routes (credentials to Vault and never returned, admin-only
 * writes, act needs a write credential) and the recipe ingest routes (CI push
 * builds the same snapshot; events; CSV import).
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
vi.mock('../../supabase/functions/api/routes/project-ci-secrets.ts', () => ({ inferStack: () => 'nextjs', requiredCiVarNames: () => [] }))

let phase2: typeof import('../../supabase/functions/_shared/recipe-phase2.ts')
let connectors: typeof import('../../supabase/functions/api/routes/connectors.ts')
let ingest: typeof import('../../supabase/functions/api/routes/recipe-ingest.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  phase2 = await import('../../supabase/functions/_shared/recipe-phase2.ts')
  connectors = await import('../../supabase/functions/api/routes/connectors.ts')
  ingest = await import('../../supabase/functions/api/routes/recipe-ingest.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const ORG_B = '0000000b-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const P_OTHER = '2000000b-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-02T12:00:00Z')

const manifest = {
  version: 1,
  app: { kind: 'app', ids: { bundleId: 'com.glotit.app', androidPackage: 'com.glotit.app' } },
  links: { domains: ['glot.it'], notifications: { slackChannel: 'C123' } },
  deploy: { targets: [{ id: 'web-prod', kind: 'cloudfront-s3', url: 'https://glot.it', probe: { type: 'version_json', url: 'https://glot.it/version.json' }, maxLagHours: 24 }] },
  gates: { budgets: { 'bundle.web.total_kb': 900 } },
}

function seed(extra: Record<string, unknown[]> = {}): FakeDb {
  return makeFakeDb({
    organizations: [{ id: ORG, name: 'A' }, { id: ORG_B, name: 'B' }],
    projects: [
      { id: P1, name: 'glot.it', slug: 'glot-it', owner_id: 'owner', organization_id: ORG },
      { id: P2, name: 'yen-yen', slug: 'yen-yen', owner_id: 'owner', organization_id: ORG },
      { id: P_OTHER, name: 'other', slug: 'other', owner_id: 'b', organization_id: ORG_B },
    ],
    organization_members: [{ organization_id: ORG, user_id: 'owner', role: 'owner' }, { organization_id: ORG, user_id: 'member', role: 'member' }],
    project_members: [],
    app_recipe_snapshots: [{ id: 's1', project_id: P1, is_current: true, manifest }],
    metric_series: [{ project_id: P1, metric_name: 'bundle.web.total_kb', value: 950, ts: '2026-10-01T00:00:00Z' }],
    ...extra,
  } as never, { autoId: true })
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('collectProjectPhase2', () => {
  it('writes deploy and budget gates from what is observable, and no gate for a source that is not connected', async () => {
    const db = seed()
    const summary = await phase2.collectProjectPhase2(db as never, P1, {
      fetch: vi.fn(async () => json(500, {})),
      now: () => NOW,
      probe: vi.fn(async () => ({ status: 200, text: JSON.stringify({ version: '1.102.0', commit: 'old1234567' }) })),
    })
    expect(summary.connectors.find((c) => c.kind === 'github')).toMatchObject({ status: 'not_connected' })
    expect(summary.deployObservations).toBe(1)
    const gates = summary.gates.map((g) => g.gate).sort()
    expect(gates).toEqual(['code_health', 'deploy_drift'])
    expect(db.table('gate_runs').some((r) => r.gate === 'ci_drift' || r.gate === 'schema_drift' || r.gate === 'env_drift')).toBe(false)
    expect(db.table('gate_findings').find((f) => f.rule_id === 'budget_exceeded')).toBeTruthy()
    expect(db.table('deploy_observations')[0]).toMatchObject({ target_id: 'web-prod', observed_version: '1.102.0', ok: true, source: 'version_json' })
    // Resources from the manifest: a domain, bundle ids, the Slack channel.
    const kinds = db.table('portfolio_resources').map((r) => r.kind).sort()
    expect(kinds).toEqual(expect.arrayContaining(['bundle_id', 'domain', 'slack_channel']))
    expect(summary.resourceUses).toBeGreaterThanOrEqual(3)
  })

  it('a failed version probe is recorded as a failed observation, not skipped', async () => {
    const db = seed()
    await phase2.collectProjectPhase2(db as never, P1, { fetch: vi.fn(async () => json(500, {})), now: () => NOW, probe: vi.fn(async () => { throw new Error('outbound-blocked: PRIVATE_HOST') }) })
    expect(db.table('deploy_observations')[0]).toMatchObject({ ok: false })
    expect(db.table('gate_findings').some((f) => f.rule_id === 'probe_failed')).toBe(true)
  })
})

describe('collectOrgPortfolio', () => {
  it('flags a broken deep link between sibling apps and resolves findings that went away', async () => {
    const m1 = { ...manifest, links: { ...manifest.links, deepLinks: { appLinks: [{ toProject: 'yen-yen' }] } } }
    const m2 = { version: 1, app: { ids: { bundleId: 'com.yenyen.app', appleTeamId: 'TEAM123', androidPackage: 'com.yenyen.app' } }, links: { deepLinks: { universalLinkDomains: ['yen-yen.app'] } } }
    const db = seed({
      app_recipe_snapshots: [{ project_id: P1, is_current: true, manifest: m1 }, { project_id: P2, is_current: true, manifest: m2 }],
      portfolio_findings: [{ id: 'old', organization_id: ORG, rule_id: 'shared_channel_untagged', resource_key: 'slack_channel:C1', project_ids: [P1, P2], status: 'open' }],
    })
    const probe = vi.fn(async (url: string) => url.endsWith('apple-app-site-association')
      ? { status: 200, text: JSON.stringify({ applinks: { details: [{ appIDs: ['TEAM123.com.other.app'], components: [{ '/': '/*' }] }] } }) }
      : { status: 404, text: '' })
    const r = await phase2.collectOrgPortfolio(db as never, ORG, { fetch: vi.fn(), now: () => NOW, probe })
    expect(r.findings).toBeGreaterThanOrEqual(1)
    const open = db.table('portfolio_findings').filter((f) => f.status === 'open')
    expect(open.some((f) => f.rule_id === 'deep_link_broken')).toBe(true)
    expect(db.table('portfolio_findings').find((f) => f.id === 'old')).toMatchObject({ status: 'resolved' })
  })

  const linked = () => {
    const m1 = { ...manifest, links: { ...manifest.links, deepLinks: { appLinks: [{ toProject: 'yen-yen' }] } } }
    const m2 = { version: 1, app: { ids: { bundleId: 'com.yenyen.app' } }, links: { deepLinks: { universalLinkDomains: ['yen-yen.app'] } } }
    return [{ project_id: P1, is_current: true, manifest: m1 }, { project_id: P2, is_current: true, manifest: m2 }]
  }
  const openDeep = { id: 'deep', organization_id: ORG, rule_id: 'deep_link_broken', resource_key: 'deep_link_domain:yen-yen.app', project_ids: [P1, P2], status: 'open' }

  it('keeps an open finding open when its check could not run this time', async () => {
    const db = seed({ app_recipe_snapshots: linked(), portfolio_findings: [openDeep] })
    const probe = vi.fn(async () => { throw new Error('timeout') })
    const r = await phase2.collectOrgPortfolio(db as never, ORG, { fetch: vi.fn(), now: () => NOW, probe })
    expect(r.unknown).toBeGreaterThanOrEqual(1)
    expect(db.table('portfolio_findings').find((f) => f.id === 'deep')).toMatchObject({ status: 'open' })
  })

  it('resolves cross-app findings once only one app is left', async () => {
    const db = seed({ portfolio_findings: [openDeep] })
    db.table('projects').splice(db.table('projects').findIndex((p) => p.id === P2), 1)
    const r = await phase2.collectOrgPortfolio(db as never, ORG, { fetch: vi.fn(), now: () => NOW, probe: vi.fn() })
    expect(r.resolved).toBe(1)
    expect(db.table('portfolio_findings').find((f) => f.id === 'deep')).toMatchObject({ status: 'resolved' })
  })

  it('stops without resolving anything when a read fails', async () => {
    const db = seed({ app_recipe_snapshots: linked(), portfolio_findings: [openDeep] })
    const failing = new Proxy(db, {
      get(target, prop, recv) {
        if (prop !== 'from') return Reflect.get(target, prop, recv)
        return (table: string) => {
          const q = target.from(table)
          if (table !== 'app_recipe_snapshots') return q
          return { select: () => ({ in: () => ({ eq: async () => ({ data: null, error: { message: 'statement timeout' } }) }) }) }
        }
      },
    })
    await expect(phase2.collectOrgPortfolio(failing as never, ORG, { fetch: vi.fn(), now: () => NOW, probe: vi.fn() })).rejects.toThrow(/statement timeout/)
    expect(db.table('portfolio_findings').find((f) => f.id === 'deep')).toMatchObject({ status: 'open' })
  })

  it('checks shared login redirects against the settings a repo declares, and billing between apps that share credits', async () => {
    const auth = { provider: 'supabase', ref: 'abcdefghijklmnopqrst' }
    const db = seed({
      app_recipe_snapshots: [
        { project_id: P1, is_current: true, manifest: { version: 1, links: { domains: ['glot.it'], auth, billing: { stripeAccount: 'acct_1', sharedCreditsWith: ['yen-yen'] } } } },
        { project_id: P2, is_current: true, manifest: { version: 1, links: { domains: ['yenyen.app'], auth, billing: { stripeAccount: 'acct_2' } } } },
      ],
      connector_snapshots: [
        { project_id: P1, kind: 'github', is_current: true, ok: true, snapshot: { facts: { supabaseAuth: { path: 'k/glot/supabase/config.toml', settings: { siteUrl: 'https://glot.it', redirectUrls: ['https://glot.it/**'], providers: ['email'] } } } } },
        { project_id: P2, kind: 'github', is_current: true, ok: true, snapshot: { facts: { supabaseAuth: { path: 'k/yen/supabase/config.toml', settings: null } } } },
      ],
    })
    await phase2.collectOrgPortfolio(db as never, ORG, { fetch: vi.fn(), now: () => NOW, probe: vi.fn() })
    const open = db.table('portfolio_findings').filter((f) => f.status === 'open')
    const redirect = open.find((f) => f.rule_id === 'auth_redirect_missing')
    expect(redirect).toMatchObject({ severity: 'warn', project_ids: [P2] })
    expect(String(redirect?.message)).toContain('declared in k/glot/supabase/config.toml')
    expect(open.some((f) => f.rule_id === 'auth_config_divergent')).toBe(false)
    expect(open.find((f) => f.rule_id === 'billing_account_mismatch')).toMatchObject({ severity: 'error' })
  })
})

describe('collectOrgPortfolio cross-promotion', () => {
  it('opens each cross-promo link through the probe and records a 404 as broken', async () => {
    const db = seed({
      app_recipe_snapshots: [
        { project_id: P1, is_current: true, manifest: { version: 1, links: { crossPromo: [{ url: 'https://apps.apple.com/app/id9?ct=glot', toProject: 'yen-yen' }] } } },
        { project_id: P2, is_current: true, manifest: { version: 1 } },
      ],
    })
    const probe = vi.fn(async (url: string) => ({ status: url.includes('apps.apple.com') ? 404 : 200, text: '' }))
    await phase2.collectOrgPortfolio(db as never, ORG, { fetch: vi.fn(), now: () => NOW, probe })
    expect(probe).toHaveBeenCalledWith('https://apps.apple.com/app/id9?ct=glot')
    expect(db.table('portfolio_findings').find((f) => f.rule_id === 'cross_promo_link_broken')).toMatchObject({ status: 'open', severity: 'error', project_ids: [P1, P2].sort() })
  })
})

describe('authInputsFrom', () => {
  it('says unknown, not divergent, when no repo in a shared-auth group declares its settings', () => {
    const auth = { provider: 'supabase', ref: 'abcdefghijklmnopqrst' }
    const r = phase2.authInputsFrom([{ id: P1 }, { id: P2 }], new Map([[P1, { links: { auth } }], [P2, { links: { auth } }]]), new Map())
    expect(r.inputs.every((i) => i.settingsKnown === false)).toBe(true)
    expect(r.unknown.map((u) => u.ruleId).sort()).toEqual(['auth_config_divergent', 'auth_redirect_missing'])
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
  patch(p: string, ...h: Handler[]) { this.add('PATCH', p, h) }
  delete(p: string, ...h: Handler[]) { this.add('DELETE', p, h) }
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<{ status: number; body: any }> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...opts.vars }
      const c = {
        req: { json: async () => opts.body, param: (k: string) => params[k], query: () => undefined, header: () => undefined },
        get: (k: string) => vars[k], set: (k: string, v: unknown) => { vars[k] = v }, header: () => {},
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

const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never

function connectorHarness(db: FakeDb, fetchImpl = vi.fn(async () => json(200, { data: [] }))) {
  const app = new FakeApp()
  const vault = new Map<string, string>()
  connectors.registerConnectorRoutes(app as never, {
    getServiceClient: () => db as never, adminOrApiKeyRead: pass, jwtAuth: pass, fetch: fetchImpl, now: () => NOW,
    storeCredential: vi.fn(async (_db: unknown, name: string, value: string) => { vault.set(name, value); return `vault://${name}` }),
    resolveCredential: vi.fn(async (_db: unknown, ref: string | null | undefined) => (ref ? vault.get(ref.slice(8)) ?? null : null)),
  } as never)
  return { app, vault }
}

describe('connector routes', () => {
  it('stores credentials in Vault, never returns them, and probes on create', async () => {
    const db = seed()
    const { app, vault } = connectorHarness(db)
    const res = await app.call('POST', `/v1/admin/orgs/${ORG}/connectors`, { body: { kind: 'llm_usage', displayName: 'OpenAI', config: { provider: 'openai' }, readCredential: 'sk-admin-abc', bindings: [{ projectId: P1, externalId: 'proj_abc' }] } })
    expect(res.status).toBe(201)
    expect(JSON.stringify(res.body)).not.toContain('sk-admin-abc')
    expect(res.body.data.probe.status).toBe('connected')
    expect([...vault.values()]).toContain('sk-admin-abc')
    expect(db.table('connector_instances')[0].read_credential_ref).toMatch(/^vault:\/\//)
    const list = await app.call('GET', `/v1/admin/orgs/${ORG}/connectors`)
    expect(JSON.stringify(list.body)).not.toMatch(/vault:\/\/|sk-admin/)
    expect(list.body.data.instances[0].bindings).toEqual([{ projectId: P1, externalId: 'proj_abc', role: 'primary' }])
    expect(list.body.data.planned).toEqual(expect.arrayContaining(['vercel', 'eas', 'stripe', 'posthog']))
  })

  it('refuses members, other teams, planned or legacy kinds, secrets in config, and act without a write credential', async () => {
    const db = seed()
    const { app } = connectorHarness(db)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/connectors`, { body: { kind: 'llm_usage', displayName: 'x' }, vars: { userId: 'member' } })).status).toBe(403)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG_B}/connectors`, { body: { kind: 'llm_usage', displayName: 'x' } })).status).toBe(403)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/connectors`, { body: { kind: 'vercel', displayName: 'x' } })).body.error.code).toBe('CONNECTOR_NOT_AVAILABLE')
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/connectors`, { body: { kind: 'github', displayName: 'x' } })).body.error.code).toBe('USE_EXISTING_SETTINGS')
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/connectors`, { body: { kind: 'http', displayName: 'x', config: { endpoint: 'https://a.example', token: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' } } })).body.error.code).toBe('SECRET_IN_CONFIG')
    const created = await app.call('POST', `/v1/admin/orgs/${ORG}/connectors`, { body: { kind: 'play_console', displayName: 'Play', config: { package: 'com.glotit.app' } } })
    const id = created.body.data.instance.id
    const act = await app.call('PATCH', `/v1/admin/orgs/${ORG}/connectors/${id}`, { body: { enabledCapabilities: ['snapshot', 'act'] } })
    expect(act.body.error.code).toBe('WRITE_CREDENTIAL_REQUIRED')
    const unsupported = await app.call('PATCH', `/v1/admin/orgs/${ORG}/connectors/${id}`, { body: { enabledCapabilities: ['propose'] } })
    expect(unsupported.body.error.code).toBe('CAPABILITY_NOT_SUPPORTED')
  })
})

describe('recipe ingest routes', () => {
  function ingestHarness(db: FakeDb) {
    const app = new FakeApp()
    ingest.registerRecipeIngestRoutes(app as never, { getServiceClient: () => db as never, apiKeyAuth: pass, jwtAuth: pass, adminOrApiKeyRead: pass, now: () => NOW } as never)
    return app
  }

  it('builds the recipe snapshot from files the CI pushed, and refuses unsafe paths', async () => {
    const db = seed({ app_recipe_snapshots: [] })
    const app = ingestHarness(db)
    const bad = await app.call('POST', '/v1/ingest/recipe', { body: { commitSha: 'abcdef1', files: { '../etc/passwd': 'x' } }, vars: { projectId: P1 } })
    expect(bad.body.error.code).toBe('PATH_NOT_ALLOWED')
    const ok = await app.call('POST', '/v1/ingest/recipe', {
      body: { commitSha: 'abcdef1', files: { 'mushi.recipe.json': JSON.stringify({ version: 1, design: { tokens: [{ path: 'tokens.json', role: 'source', format: 'dtcg-2025.10' }] } }), 'tokens.json': JSON.stringify({ color: { $type: 'color', brand: { $value: '#E8387F' } } }) },
        findings: [{ ruleId: 'off_token_literal', filePath: 'app/page.tsx', line: 12, value: '#ff0000' }] },
      vars: { projectId: P1 },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ ok: true, manifestPresent: true, findingsStored: 1 })
    expect(db.table('app_recipe_snapshots').find((s) => s.is_current)).toMatchObject({ source: 'ci_ingest', commit_sha: 'abcdef1' })
  })

  it('records legacy build and deploy events', async () => {
    const db = seed()
    const res = await ingestHarness(db).call('POST', '/v1/ingest/recipe/events', {
      body: { events: [
        { type: 'build.completed', id: 'jenkins-42', conclusion: 'failure', completedAt: NOW.toISOString(), minutes: 7 },
        { type: 'deploy.completed', targetId: 'vps', version: '3.1.0', ok: true },
      ] },
      vars: { projectId: P1 },
    })
    expect(res.body.data).toEqual({ received: 2, stored: 2 })
    expect(db.table('ci_workflow_runs')[0]).toMatchObject({ source: 'webhook', conclusion: 'failure', repo: 'external' })
    expect(db.table('deploy_observations')[0]).toMatchObject({ source: 'webhook', target_id: 'vps' })
  })

  it('imports shared resources from CSV for owners only, and reports bad lines', async () => {
    const db = seed()
    const app = ingestHarness(db)
    const csv = 'kind,external_id,project,role\ndomain,glot.it,glot-it,site\nbogus,x,glot-it,\ndomain,other.example,other,site\n'
    expect((await app.call('POST', '/v1/ingest/recipe/csv', { body: { organizationId: ORG, csv }, vars: { userId: 'member' } })).status).toBe(403)
    const res = await app.call('POST', '/v1/ingest/recipe/csv', { body: { organizationId: ORG, csv } })
    expect(res.body.data.imported).toBe(1)
    expect(res.body.data.errors).toHaveLength(2)
    const graph = await app.call('GET', `/v1/admin/orgs/${ORG}/portfolio/resources`)
    expect(graph.body.data.resources).toEqual([expect.objectContaining({ kind: 'domain', externalId: 'glot.it', uses: [{ projectId: P1, role: 'site', source: 'csv' }] })])
  })

  it('parses quoted CSV cells', () => {
    expect(ingest.parseCsvLine('domain,"a,b.example","say ""hi"""')).toEqual(['domain', 'a,b.example', 'say "hi"'])
  })
})

describe('migration drift joins the two connectors', () => {
  const snap = (facts: Record<string, unknown>) => ({ observedAt: NOW.toISOString(), elements: {}, resources: [], facts })
  it('flags a migration in the repo that the database never applied, and claims nothing when a side is missing', () => {
    const found = phase2.migrationDrift([
      { kind: 'github', snapshot: snap({ migrationFiles: ['20261001000000_a.sql', '20261002000000_b.sql'] }) },
      { kind: 'supabase', snapshot: snap({ appliedVersions: ['20261001000000'] }) },
    ] as never)
    expect(found.map((f) => [f.gate, f.ruleId])).toEqual([['schema_drift', 'migration_unapplied']])
    expect(phase2.migrationDrift([{ kind: 'github', snapshot: snap({ migrationFiles: ['20261002000000_b.sql'] }) }] as never)).toEqual([])
  })
})

describe('a rejected CI push fails the CI step', () => {
  it('answers 422, not 200, when the snapshot cannot be stored', async () => {
    const db = makeFakeDb({
      projects: [{ id: P1, organization_id: ORG }],
      app_recipe_snapshots: [{ id: 'cur', project_id: P1, is_current: true, tokens_hash: 'x', manifest: null }],
    } as never, { autoId: true, uniques: { app_recipe_snapshots: ['project_id'] } })
    const app = new FakeApp()
    ingest.registerRecipeIngestRoutes(app as never, { getServiceClient: () => db as never, apiKeyAuth: pass, jwtAuth: pass, adminOrApiKeyRead: pass, now: () => NOW } as never)
    const res = await app.call('POST', '/v1/ingest/recipe', { body: { commitSha: 'abcdef1', files: { 'mushi.recipe.json': '{"version":1}' } }, vars: { projectId: P1 } })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('RECIPE_REJECTED')
  })
})
