/**
 * The accounts and resilience register (Plan 020 §11):
 * `_shared/accounts-register.ts` (rules + Markdown export) and
 * `api/routes/accounts-register.ts` (read, write, export), plus the org
 * collector writing the two rules to portfolio_findings.
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

let reg: typeof import('../../supabase/functions/_shared/accounts-register.ts')
let routes: typeof import('../../supabase/functions/api/routes/accounts-register.ts')
let phase2: typeof import('../../supabase/functions/_shared/recipe-phase2.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  reg = await import('../../supabase/functions/_shared/accounts-register.ts')
  routes = await import('../../supabase/functions/api/routes/accounts-register.ts')
  phase2 = await import('../../supabase/functions/_shared/recipe-phase2.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const ORG_B = '0000000b-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-03T12:00:00Z')
const A1 = '3000000a-0000-4000-8000-000000000001'
const D1 = '3000000a-0000-4000-8000-000000000002'
const D_HIDDEN = '3000000a-0000-4000-8000-000000000003'

const account = (over: Partial<import('../../supabase/functions/_shared/accounts-register.ts').RegisterAccount> = {}) => ({
  id: A1, externalId: 'apple:kenji ltd', provider: 'apple' as const, name: 'Kenji Ltd', ownerEmail: 'k@example.com',
  twoFactorDeclared: true, recoveryContact: null, adminCount: 1, autoRenew: null, updatedAt: null, ...over,
})

describe('register rules', () => {
  it('account_single_owner: one person and no recovery contact, with the provider-specific step', () => {
    const [f] = reg.accountRegisterRules([account()], [])
    expect(f).toMatchObject({ ruleId: 'account_single_owner', severity: 'warn', projectIds: [], resourceKey: 'account:apple:kenji ltd' })
    expect(f.message).toContain('Apple Developer account "Kenji Ltd" has one person')
    expect(f.suggestedFix).toMatch(/App Store Connect → Users and Access/)
  })

  it('a second admin or a recovery contact clears it', () => {
    expect(reg.accountRegisterRules([account({ adminCount: 2 })], [])).toEqual([])
    expect(reg.accountRegisterRules([account({ recoveryContact: 'Aiko (sister), +81…' })], [])).toEqual([])
  })

  it('registrar_autorenew_off: only when declared off, for registrar accounts and domains', () => {
    const rules = reg.accountRegisterRules(
      [account({ provider: 'registrar', name: 'Porkbun', externalId: 'registrar:porkbun', adminCount: 2, autoRenew: false }), account({ provider: 'registrar', name: 'Other', externalId: 'registrar:other', adminCount: 2, autoRenew: null })],
      [{ id: D1, domain: 'glot.it', autoRenew: false, projectIds: [P1] }, { id: D_HIDDEN, domain: 'kensaur.us', autoRenew: null, projectIds: [P1] }],
    )
    expect(rules.map((r) => [r.ruleId, r.resourceKey])).toEqual([['registrar_autorenew_off', 'account:registrar:porkbun'], ['registrar_autorenew_off', 'domain:glot.it']])
    expect(rules[1].message).toContain('declared off for glot.it')
    expect(rules[1].projectIds).toEqual([P1])
  })

  it('maps rows, defaulting a bad provider to other and a missing admin count to 1, and drops domains nothing uses', () => {
    const r = reg.registerFromRows([
      { id: A1, kind: 'account', external_id: 'x:y', display_name: null, account_provider: 'nope', owner_email: null, two_factor_declared: null, recovery_contact: null, admin_count: null, auto_renew: null, updated_at: null },
      { id: D1, kind: 'domain', external_id: 'glot.it', display_name: null, account_provider: null, owner_email: null, two_factor_declared: null, recovery_contact: null, admin_count: 1, auto_renew: true, updated_at: null },
      { id: D_HIDDEN, kind: 'domain', external_id: 'unused.example', display_name: null, account_provider: null, owner_email: null, two_factor_declared: null, recovery_contact: null, admin_count: 1, auto_renew: false, updated_at: null },
    ], new Map([[D1, [P1, P1]]]))
    expect(r.accounts[0]).toMatchObject({ provider: 'other', name: 'x:y', adminCount: 1 })
    expect(r.domains).toEqual([{ id: D1, domain: 'glot.it', autoRenew: true, projectIds: [P1] }])
  })

  it('the Markdown export lists accounts, domains and what to fix, and escapes table cells', () => {
    const accounts = [account({ name: 'A | B' })]
    const domains = [{ id: D1, domain: 'glot.it', autoRenew: false, projectIds: [P1] }]
    const md = reg.renderRegisterMarkdown({ organizationName: 'Kenji', generatedAt: NOW.toISOString(), accounts, domains, findings: reg.accountRegisterRules(accounts, domains) })
    expect(md).toContain('# Accounts and resilience register — Kenji')
    expect(md).toContain('| A \\| B | Apple Developer | k@example.com | yes | 1 | — | — |')
    expect(md).toContain('| glot.it | no |')
    expect(md).toContain('**account_single_owner**')
    expect(md).toMatch(/no passwords, keys or recovery codes/)
  })
})

// ── routes ───────────────────────────────────────────────────────────────────

/** The slice of Hono's Context these routes use. */
interface FakeCtx {
  req: { json: () => Promise<unknown>; param: (k: string) => string | undefined; query: () => undefined; header: () => undefined }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  header: () => void
  json: (body: unknown, status?: number) => { body: unknown; status: number }
}
type Handler = (c: FakeCtx, next?: () => Promise<void>) => Promise<unknown> | unknown

/** What the tests read from a response: the JSON envelope, or the text and type of a download. */
interface RouteBody {
  ok: boolean
  data: {
    id: string
    canEdit: boolean
    deleted: boolean
    accounts: Array<Record<string, unknown>>
    domains: Array<{ domain: string }>
    findings: Array<{ ruleId: string }>
  }
  error: { code: string; message: string }
  text: string
  type: string | null
}

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
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<{ status: number; body: RouteBody }> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...opts.vars }
      const c: FakeCtx = {
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
      if (result instanceof Response) return { status: result.status, body: { text: await result.text(), type: result.headers.get('content-type') } as RouteBody }
      return result as { status: number; body: RouteBody }
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

function seed(extra: Record<string, unknown[]> = {}): FakeDb {
  return makeFakeDb({
    organizations: [{ id: ORG, name: 'Kenji' }, { id: ORG_B, name: 'B' }],
    organization_members: [
      { organization_id: ORG, user_id: 'owner', role: 'owner' },
      { organization_id: ORG, user_id: 'member', role: 'member' },
    ],
    projects: [{ id: P1, name: 'glot.it', owner_id: 'owner', organization_id: ORG }],
    project_members: [],
    portfolio_resources: [
      { id: D1, organization_id: ORG, kind: 'domain', external_id: 'glot.it', auto_renew: null, admin_count: 1 },
      { id: D_HIDDEN, organization_id: ORG, kind: 'domain', external_id: 'secret-other-team.example', auto_renew: false, admin_count: 1 },
    ],
    portfolio_resource_uses: [{ resource_id: D1, project_id: P1, role: 'site', source: 'manifest' }],
    ...extra,
  } as never, { autoId: true })
}

/**
 * Another save of the same account lands between the duplicate check and this
 * write: the check sees nothing, the database's unique key answers 23505.
 */
function racingDb(db: FakeDb): FakeDb {
  const nothing = { data: null, error: null }
  const conflict = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "portfolio_resources_organization_id_kind_external_id_key"' } }
  const resolved = (v: unknown): unknown => new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (ok: (x: unknown) => unknown) => Promise.resolve(v).then(ok) : () => resolved(v)) })
  return new Proxy(db, {
    get: (t, prop, r) => prop === 'from'
      ? (name: string) => {
          const q = t.from(name)
          if (name !== 'portfolio_resources') return q
          return new Proxy(q, {
            get: (qt, qp, qr) => {
              if (qp === 'insert' || qp === 'update') return () => resolved(conflict)
              // The duplicate lookup (by external_id) sees nothing yet.
              if (qp === 'eq') return (k: string, v: unknown) => (k === 'external_id' ? resolved(nothing) : Reflect.apply(Reflect.get(qt, qp, qr) as (a: string, b: unknown) => unknown, qr, [k, v]))
              return Reflect.get(qt, qp, qr)
            },
          })
        }
      : Reflect.get(t, prop, r),
  })
}

function harness(db: FakeDb) {
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  routes.registerAccountsRegisterRoutes(app as never, { getServiceClient: () => db as never, adminOrApiKeyRead: pass, adminOrApiKeyWrite: pass, now: () => NOW } as never)
  return app
}

describe('accounts register routes', () => {
  it('owners record an account; the read returns it with its rule, and only domains a visible project uses', async () => {
    const db = seed()
    const app = harness(db)
    const created = await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'apple', displayName: 'Kenji Ltd', ownerEmail: 'k@example.com', twoFactorDeclared: true } })
    expect(created.status).toBe(201)
    const read = await app.call('GET', `/v1/admin/orgs/${ORG}/accounts`)
    expect(read.status).toBe(200)
    expect(read.body.data.canEdit).toBe(true)
    expect(read.body.data.accounts).toHaveLength(1)
    expect(read.body.data.accounts[0]).toMatchObject({ provider: 'apple', name: 'Kenji Ltd', twoFactorDeclared: true, adminCount: 1 })
    expect(read.body.data.domains.map((d: { domain: string }) => d.domain)).toEqual(['glot.it'])
    expect(read.body.data.findings.map((f: { ruleId: string }) => f.ruleId)).toEqual(['account_single_owner'])
    expect(db.table('org_audit_events')[0]).toMatchObject({ action: 'portfolio_account.created', resource_type: 'portfolio_account' })
  })

  it('refuses members, other teams, duplicates and anything shaped like a secret', async () => {
    const db = seed()
    const app = harness(db)
    const body = { provider: 'stripe', displayName: 'Payments' }
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body, vars: { userId: 'member' } })).status).toBe(403)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG_B}/accounts`, { body })).status).toBe(403)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body })).status).toBe(201)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'stripe', displayName: ' payments ' } })).body.error.code).toBe('ACCOUNT_EXISTS')
    const secret = await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'aws', displayName: 'Root', recoveryContact: 'AKIA' + 'ABCDEFGHIJKLMNOP' } })
    expect(secret.status).toBe(400)
    expect(secret.body.error.code).toBe('SECRET_DETECTED')
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'aws', displayName: 'x', password: 'hunter2' } })).status).toBe(400)
    expect(db.table('portfolio_resources').filter((r) => r.kind === 'account')).toHaveLength(1)
  })

  it('two saves of the same account at once: the loser gets 409 ACCOUNT_EXISTS, not a 500', async () => {
    const db = seed()
    const created = await harness(db).call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'stripe', displayName: 'Payments' } })
    const id = created.body.data.id
    const raced = harness(racingDb(db))
    const post = await raced.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'stripe', displayName: 'Payments' } })
    expect(post.status).toBe(409)
    expect(post.body.error.code).toBe('ACCOUNT_EXISTS')
    const rename = await raced.call('PATCH', `/v1/admin/orgs/${ORG}/accounts/${id}`, { body: { displayName: 'Payments EU' } })
    expect(rename.status).toBe(409)
    expect(rename.body.error.code).toBe('ACCOUNT_EXISTS')
  })

  it('a failed duplicate lookup is a 500, never a save past an unchecked duplicate', async () => {
    const db = seed()
    const failed = { data: null, error: { message: 'statement timeout' } }
    const chain: unknown = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(failed).then(ok) : () => chain) })
    // Count read works, the duplicate lookup (the second read) times out.
    let reads = 0
    const flaky = new Proxy(db, {
      get: (t, prop, r) => prop === 'from'
        ? (name: string) => (name === 'portfolio_resources' && ++reads === 2 ? chain : t.from(name))
        : Reflect.get(t, prop, r),
    })
    const res = await harness(flaky).call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'stripe', displayName: 'Payments' } })
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('DB_ERROR')
    expect(db.table('portfolio_resources').filter((x) => x.kind === 'account')).toHaveLength(0)
  })

  it('updates an account (a recovery contact clears the rule) and deletes it', async () => {
    const db = seed()
    const app = harness(db)
    const { body } = await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'google_play', displayName: 'Play' } })
    const id = body.data.id
    expect((await app.call('PATCH', `/v1/admin/orgs/${ORG}/accounts/${id}`, { body: { recoveryContact: 'Aiko' } })).status).toBe(200)
    expect((await app.call('GET', `/v1/admin/orgs/${ORG}/accounts`)).body.data.findings).toEqual([])
    expect((await app.call('PATCH', `/v1/admin/orgs/${ORG}/accounts/${id}`, { body: { recoveryContact: 'x' }, vars: { userId: 'member' } })).status).toBe(403)
    expect((await app.call('DELETE', `/v1/admin/orgs/${ORG}/accounts/${id}`)).status).toBe(200)
    expect(db.table('portfolio_resources').some((r) => r.id === id)).toBe(false)
  })

  it('declares a visible domain’s auto-renew; a domain no visible project uses is not found', async () => {
    const db = seed()
    const app = harness(db)
    expect((await app.call('PATCH', `/v1/admin/orgs/${ORG}/domains/${D1}`, { body: { autoRenew: false } })).status).toBe(200)
    expect((await app.call('GET', `/v1/admin/orgs/${ORG}/accounts`)).body.data.findings.map((f: { ruleId: string }) => f.ruleId)).toEqual(['registrar_autorenew_off'])
    expect((await app.call('PATCH', `/v1/admin/orgs/${ORG}/domains/${D_HIDDEN}`, { body: { autoRenew: true } })).status).toBe(404)
  })

  it('an account-level key whose owner is a team owner or admin edits the register (MCP, CLI); a member key or a project-bound key cannot', async () => {
    const db = seed()
    const app = harness(db)
    const ownerKey = { authMethod: 'apiKey', isOrgScopedKey: true, userId: 'owner' }
    const created = await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'vercel', displayName: 'Team' }, vars: ownerKey })
    expect(created.status).toBe(201)
    const id = created.body.data.id
    expect((await app.call('GET', `/v1/admin/orgs/${ORG}/accounts`, { vars: ownerKey })).body.data.canEdit).toBe(true)
    expect((await app.call('PATCH', `/v1/admin/orgs/${ORG}/accounts/${id}`, { body: { adminCount: 2 }, vars: ownerKey })).status).toBe(200)
    expect((await app.call('PATCH', `/v1/admin/orgs/${ORG}/domains/${D1}`, { body: { autoRenew: true }, vars: ownerKey })).status).toBe(200)

    const memberKey = { authMethod: 'apiKey', isOrgScopedKey: true, userId: 'member' }
    expect((await app.call('GET', `/v1/admin/orgs/${ORG}/accounts`, { vars: memberKey })).body.data.canEdit).toBe(false)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'stripe', displayName: 'Pay' }, vars: memberKey })).status).toBe(403)
    expect((await app.call('DELETE', `/v1/admin/orgs/${ORG}/accounts/${id}`, { vars: memberKey })).status).toBe(403)
    expect((await app.call('PATCH', `/v1/admin/orgs/${ORG}/domains/${D1}`, { body: { autoRenew: false }, vars: memberKey })).status).toBe(403)

    const boundKey = { authMethod: 'apiKey', isOrgScopedKey: false, userId: 'owner' }
    const bound = await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'stripe', displayName: 'Pay' }, vars: boundKey })
    expect(bound.status).toBe(403)
    expect(bound.body.error.code).toBe('PORTFOLIO_NEEDS_ACCOUNT_KEY')

    const secret = await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'aws', displayName: 'Root', recoveryContact: 'AKIA' + 'ABCDEFGHIJKLMNOP' }, vars: ownerKey })
    expect(secret.body.error.code).toBe('SECRET_DETECTED')
    expect((await app.call('DELETE', `/v1/admin/orgs/${ORG}/accounts/${id}`, { vars: ownerKey })).status).toBe(200)
    expect(db.table('org_audit_events').map((e) => [e.action, e.actor_id])).toEqual([
      ['portfolio_account.created', 'owner'], ['portfolio_account.updated', 'owner'], ['portfolio_domain.updated', 'owner'], ['portfolio_account.deleted', 'owner'],
    ])
  })

  it('exports Markdown as a download', async () => {
    const db = seed()
    const app = harness(db)
    await app.call('POST', `/v1/admin/orgs/${ORG}/accounts`, { body: { provider: 'registrar', displayName: 'Porkbun', autoRenew: false, adminCount: 2 } })
    const res = await app.call('GET', `/v1/admin/orgs/${ORG}/accounts/export`)
    expect(res.status).toBe(200)
    expect(res.body.type).toMatch(/text\/markdown/)
    expect(res.body.text).toContain('| Porkbun | Domain registrar |')
    expect(res.body.text).toContain('**registrar_autorenew_off**')
    expect(res.body.text).not.toContain('secret-other-team.example')
  })
})

describe('the org collector writes the register rules', () => {
  it('with a single app, opens account_single_owner in portfolio_findings and resolves it once fixed', async () => {
    const db = seed({ portfolio_findings: [], portfolio_resources: [] })
    db.table('portfolio_resources').push({ id: A1, organization_id: ORG, kind: 'account', external_id: 'vercel:team', display_name: 'Team', account_provider: 'vercel', admin_count: 1, recovery_contact: null })
    const deps = { now: () => NOW, probe: vi.fn(), runtime: { fetch: vi.fn(), now: () => NOW } }
    await phase2.collectOrgPortfolio(db as never, ORG, deps as never)
    const open = db.table('portfolio_findings').filter((f) => f.status === 'open')
    expect(open.map((f) => f.rule_id)).toEqual(['account_single_owner'])
    expect(open[0]).toMatchObject({ resource_key: 'account:vercel:team', project_ids: [] })
    db.table('portfolio_resources')[0].admin_count = 2
    await phase2.collectOrgPortfolio(db as never, ORG, deps as never)
    expect(db.table('portfolio_findings').filter((f) => f.status === 'open')).toEqual([])
  })

  it('a domain finding names the projects that use the domain; a domain nothing uses never surfaces', async () => {
    const db = seed({ portfolio_findings: [] })
    db.table('portfolio_resources').find((r) => r.id === D1)!.auto_renew = false
    const deps = { now: () => NOW, probe: vi.fn(), runtime: { fetch: vi.fn(), now: () => NOW } }
    await phase2.collectOrgPortfolio(db as never, ORG, deps as never)
    const open = db.table('portfolio_findings').filter((f) => f.status === 'open')
    // D_HIDDEN is also declared off, but no project uses it: no finding, so no member learns its name.
    expect(open.map((f) => [f.rule_id, f.resource_key, f.project_ids])).toEqual([['registrar_autorenew_off', 'domain:glot.it', [P1]]])
  })
})
