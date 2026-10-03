/**
 * `_shared/operator-digest.ts` + `api/routes/digest.ts` — the daily operator
 * digest (Plan 020 §9). Delivery is off by default; nothing new means nothing
 * sent; one channel failing never stops the others; only owners and admins
 * change where it goes; the preview lists only apps the caller can reach.
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

let digest: typeof import('../../supabase/functions/_shared/operator-digest.ts')
let routes: typeof import('../../supabase/functions/api/routes/digest.ts')
let shared: typeof import('../../supabase/functions/api/shared.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  digest = await import('../../supabase/functions/_shared/operator-digest.ts')
  routes = await import('../../supabase/functions/api/routes/digest.ts')
  shared = await import('../../supabase/functions/api/shared.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-02T09:30:00Z')

const line = (over: Partial<import('../../supabase/functions/_shared/operator-digest.ts').DigestProjectLine>) => ({
  projectId: P1, name: 'glot.it', newReports24h: 0, openReports: 0, radar: { error: 0, warn: 0, checked: true, failed: false },
  draftReleases: 0, publishedReleases24h: 0, spend: { last24hUsd: 0, avgPrior7dUsd: 0 }, ...over,
})

describe('composeDigest', () => {
  it('puts the worst app first, names every app, and says nothing new when nothing happened', () => {
    const d = digest.composeDigest({
      organizationId: ORG, organizationName: 'Kenji apps', generatedAt: NOW.toISOString(), truncated: [],
      projects: [
        line({ name: 'yen-yen', newReports24h: 2, openReports: 5 }),
        line({ projectId: P2, name: 'glot.it', radar: { error: 1, warn: 2, checked: true, failed: false } }),
        line({ projectId: 'p3', name: 'quiet', radar: { error: 0, warn: 0, checked: false, failed: false } }),
      ],
    }, 'https://example.test/portfolio')
    expect(d.hasContent).toBe(true)
    expect(d.lines[0]).toMatch(/^glot\.it: 1 serious hole · 2 things to look at/)
    expect(d.lines[1]).toBe('yen-yen: 2 new reports (5 open)')
    expect(d.lines[2]).toBe('1 app has not had hole checks yet.')
    expect(d.text).toContain('https://example.test/portfolio')
    const empty = digest.composeDigest({ organizationId: ORG, organizationName: null, generatedAt: '', truncated: [], projects: [line({})] }, 'u')
    expect(empty.hasContent).toBe(false)
    expect(empty.text).toContain('Nothing new across your apps today.')
  })

  it('says when hole checks failed, and an org whose checks never ran still gets a digest saying so', () => {
    const failed = digest.composeDigest({ organizationId: ORG, organizationName: null, generatedAt: '', truncated: [], projects: [line({ radar: { error: 0, warn: 0, checked: false, failed: true } })] }, 'u')
    expect(failed.hasContent).toBe(true)
    expect(failed.lines).toEqual(['glot.it: hole checks failed to run'])
    const never = digest.composeDigest({ organizationId: ORG, organizationName: null, generatedAt: '', truncated: [], projects: [line({ radar: { error: 0, warn: 0, checked: false, failed: false } }), line({ projectId: P2, name: 'yen', radar: { error: 0, warn: 0, checked: false, failed: false } })] }, 'u')
    expect(never.hasContent).toBe(true)
    expect(never.lines).toEqual(['2 apps have not had hole checks yet.'])
    expect(never.text).not.toContain('Nothing new')
  })

  it('mentions a spend jump only above $1 and twice the prior daily average', () => {
    expect(digest.spendJumped({ last24hUsd: 0.9, avgPrior7dUsd: 0 })).toBe(false)
    expect(digest.spendJumped({ last24hUsd: 3, avgPrior7dUsd: 2 })).toBe(false)
    expect(digest.spendJumped({ last24hUsd: 5, avgPrior7dUsd: 2 })).toBe(true)
  })

  it('keeps the digest open-status list equal to the api one', () => {
    expect([...digest.DIGEST_OPEN_STATUSES]).toEqual([...shared.OPEN_REPORT_STATUSES])
  })
})

describe('isDigestDue', () => {
  const row = { enabled: true, send_hour_utc: 9, last_sent_at: null as string | null }
  it('sends once a day in its hour, never when off', () => {
    expect(digest.isDigestDue(row, NOW)).toBe(true)
    expect(digest.isDigestDue({ ...row, last_sent_at: '2026-10-02T09:20:00Z' }, NOW)).toBe(false)
    expect(digest.isDigestDue({ ...row, last_sent_at: '2026-10-01T09:20:00Z' }, NOW)).toBe(true)
    expect(digest.isDigestDue({ ...row, send_hour_utc: 8 }, NOW)).toBe(false)
    expect(digest.isDigestDue({ ...row, enabled: false }, NOW, true)).toBe(false)
  })
})

describe('deliverDigest', () => {
  const content = { title: 't', lines: ['a'], text: 't\na', hasContent: true }
  const fakeDeps = (over = {}) => ({
    sendSlack: vi.fn(async () => ({ ok: true })),
    sendEmail: vi.fn(async () => ({ ok: false, error: 'no_api_key' })),
    sendPush: vi.fn(async () => ({ sent: 2 })),
    adminRecipients: vi.fn(async () => [{ userId: 'u1', email: 'owner@example.test' }]),
    ...over,
  })

  it('sends nothing when there is nothing new', async () => {
    const d = fakeDeps()
    const r = await digest.deliverDigest({} as never, { organization_id: ORG, enabled: true, slack_project_id: P1, email: true, web_push: true }, { ...content, hasContent: false }, d)
    expect(r.status).toBe('nothing_to_send')
    expect(d.sendSlack).not.toHaveBeenCalled()
  })

  it('reports partial when one channel fails and the rest still go out', async () => {
    const d = fakeDeps()
    const r = await digest.deliverDigest({} as never, { organization_id: ORG, enabled: true, slack_project_id: P1, email: true, web_push: true }, content, d)
    expect(r.status).toBe('partial')
    expect(r.channels.map((c) => [c.channel, c.ok])).toEqual([['slack', true], ['email', false], ['web_push', true]])
    expect(d.sendPush).toHaveBeenCalledTimes(1)
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
  put(p: string, ...h: Handler[]) { this.add('PUT', p, h) }
  post(p: string, ...h: Handler[]) { this.add('POST', p, h) }
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<{ status: number; body: any }> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...opts.vars }
      const c = {
        req: { json: async () => opts.body, param: (k: string) => params[k], query: () => undefined, header: () => undefined },
        get: (k: string) => vars[k], set: (k: string, v: unknown) => { vars[k] = v },
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

function seed(): FakeDb {
  return makeFakeDb({
    organizations: [{ id: ORG, name: 'Kenji apps' }],
    projects: [
      { id: P1, name: 'glot.it', owner_id: 'owner', organization_id: ORG },
      { id: P2, name: 'secret-app', owner_id: 'owner', organization_id: ORG },
    ],
    organization_members: [
      { organization_id: ORG, user_id: 'owner', role: 'owner' },
      { organization_id: ORG, user_id: 'member', role: 'member' },
    ],
    project_members: [],
    reports: [{ project_id: P1, status: 'new', created_at: '2026-10-02T08:00:00Z' }],
  } as never)
}

function harness(db: FakeDb) {
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  const delivery = {
    sendSlack: vi.fn(async () => ({ ok: true })),
    sendEmail: vi.fn(async () => ({ ok: true })),
    sendPush: vi.fn(async () => ({ sent: 1 })),
    adminRecipients: vi.fn(async () => []),
  }
  routes.registerDigestRoutes(app as never, { getServiceClient: () => db as never, adminOrApiKeyRead: pass, jwtAuth: pass, delivery, now: () => NOW } as never)
  return { app, delivery }
}

describe('digest routes', () => {
  it('previews with delivery off by default', async () => {
    const res = await harness(seed()).app.call('GET', `/v1/admin/orgs/${ORG}/digest`)
    expect(res.status).toBe(200)
    expect(res.body.data.settings).toMatchObject({ enabled: false, email: false, webPush: false, slackProjectId: null })
    expect(res.body.data.preview.lines[0]).toBe('glot.it: 1 new report (1 open)')
  })

  it('only owners and admins change the settings, and turning it on needs a channel', async () => {
    const db = seed()
    const { app } = harness(db)
    expect((await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true, email: true }, vars: { userId: 'member' } })).status).toBe(403)
    const none = await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true } })
    expect(none.body.error.code).toBe('NO_CHANNEL')
    const ok = await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true, slackProjectId: P1 } })
    expect(ok.status).toBe(200)
    expect(db.table('operator_digest_settings')[0]).toMatchObject({ enabled: true, slack_project_id: P1, updated_by: 'owner' })
  })

  it('refuses a Slack project outside the team and a send when the digest is off', async () => {
    const { app } = harness(seed())
    const foreign = await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true, slackProjectId: '9000000a-0000-4000-8000-000000000000' } })
    expect(foreign.status).toBe(404)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/digest/send`)).body.error.code).toBe('DIGEST_OFF')
  })

  it('sends now through the configured channel and records the result', async () => {
    const db = seed()
    const { app, delivery } = harness(db)
    await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true, slackProjectId: P1 } })
    const res = await app.call('POST', `/v1/admin/orgs/${ORG}/digest/send`)
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('sent')
    expect(delivery.sendSlack).toHaveBeenCalledTimes(1)
    expect(db.table('operator_digest_settings')[0]).toMatchObject({ last_status: 'sent' })
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/digest/send`)).status).toBe(429)
  })
})

describe('collectDigest hole-check state', () => {
  it('an app whose latest check errored is failed, not checked; an app with no run is neither', async () => {
    const db = makeFakeDb({
      organizations: [{ id: ORG, name: 'A' }],
      projects: [{ id: P1, name: 'glot.it', organization_id: ORG }, { id: P2, name: 'yen', organization_id: ORG }],
      reports: [], releases: [], llm_invocations: [], gate_findings: [],
      gate_runs: [{ id: 'r1', project_id: P1, gate: 'portfolio_radar', status: 'pass', summary: { errored: 1 }, started_at: '2026-10-02T04:05:00Z' }],
    } as never)
    const data = await digest.collectDigest(db as never, ORG, NOW)
    const by = Object.fromEntries(data.projects.map((p) => [p.projectId, p.radar]))
    expect(by[P1]).toMatchObject({ checked: false, failed: true })
    expect(by[P2]).toMatchObject({ checked: false, failed: false })
  })
})

describe('collectDigest past the server row cap', () => {
  const OLD = '2026-08-01T04:05:00Z'

  it('counts every report, call and release, not the first 1,000 rows of each', async () => {
    const db = makeFakeDb({
      organizations: [{ id: ORG, name: 'A' }],
      projects: [{ id: P1, name: 'glot.it', organization_id: ORG }],
      reports: Array.from({ length: 2_500 }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}`, project_id: P1, status: 'new', created_at: '2026-10-02T08:00:00Z' })),
      llm_invocations: Array.from({ length: 1_500 }, (_, i) => ({ id: `c${String(i).padStart(5, '0')}`, project_id: P1, cost_usd: 0.01, created_at: '2026-10-02T08:00:00Z' })),
      releases: [
        ...Array.from({ length: 1_100 }, (_, i) => ({ id: `old${String(i).padStart(5, '0')}`, project_id: P1, status: 'published', published_at: OLD, created_at: OLD })),
        { id: 'zz-draft', project_id: P1, status: 'draft', published_at: null, created_at: OLD },
      ],
      gate_runs: [], gate_findings: [],
    } as never, { maxRows: 1_000 })
    const data = await digest.collectDigest(db as never, ORG, NOW)
    expect(data.truncated).toEqual([])
    expect(data.projects[0]).toMatchObject({ newReports24h: 2_500, openReports: 2_500, draftReleases: 1, publishedReleases24h: 0, spend: { last24hUsd: 15 } })
  })

  it('an app whose latest hole check is older than 30 days is still checked, not "not checked yet"', async () => {
    const db = makeFakeDb({
      organizations: [{ id: ORG, name: 'A' }],
      projects: [{ id: P1, name: 'glot.it', organization_id: ORG }],
      reports: [], releases: [], llm_invocations: [],
      gate_runs: [{ id: 'r-old', project_id: P1, gate: 'portfolio_radar', status: 'warn', summary: {}, started_at: OLD }],
      gate_findings: [{ id: 'f1', gate_run_id: 'r-old', project_id: P1, severity: 'warn', allowlisted: false }],
    } as never)
    const data = await digest.collectDigest(db as never, ORG, NOW)
    expect(data.projects[0].radar).toEqual({ error: 0, warn: 1, checked: true, failed: false })
  })

  it('never re-reads the history of a gate that ran in the last 30 days', async () => {
    const db = makeFakeDb({
      organizations: [{ id: ORG, name: 'A' }],
      projects: [{ id: P1, name: 'glot.it', organization_id: ORG }],
      reports: [], releases: [], llm_invocations: [], gate_findings: [],
      // A recent scheduled run, 1,100 older ones, and no host-CI run at all.
      gate_runs: [
        { id: 'r-new', project_id: P1, gate: 'portfolio_radar', status: 'pass', summary: {}, started_at: '2026-10-02T04:05:00Z' },
        ...Array.from({ length: 1_100 }, (_, i) => ({ id: `r-old-${String(i).padStart(5, '0')}`, project_id: P1, gate: 'portfolio_radar', status: 'pass', summary: {}, started_at: OLD })),
      ],
    } as never, { maxRows: 1_000 })
    let gateRunReads = 0
    const counted = new Proxy(db, {
      get: (t, prop, r) => (prop === 'from' ? (name: string) => {
        if (name === 'gate_runs') gateRunReads++
        return t.from(name)
      } : Reflect.get(t, prop, r)),
    })
    const data = await digest.collectDigest(counted as never, ORG, NOW)
    // One recent read and one (empty) older read for the host-CI gate; none of the 1,100 old rows.
    expect(gateRunReads).toBe(2)
    expect(data.truncated).toEqual([])
    expect(data.projects[0].radar).toMatchObject({ checked: true, failed: false })
  })

  it('says a cut-short read out loud as a lower bound', () => {
    const d = digest.composeDigest({ organizationId: ORG, organizationName: 'A', generatedAt: '', truncated: ['open reports'], projects: [line({})] }, 'u')
    expect(d.hasContent).toBe(true)
    expect(d.lines).toContain('Some numbers are lower bounds: there were more open reports than the digest reads.')
  })
})

describe('collectDigest read failures', () => {
  const base = () => ({
    organizations: [{ id: ORG, name: 'A' }],
    projects: [{ id: P1, name: 'glot.it', organization_id: ORG }],
    reports: [], releases: [], llm_invocations: [],
    gate_runs: [{ id: 'r1', project_id: P1, gate: 'portfolio_radar', status: 'fail', summary: {}, started_at: '2026-10-02T04:05:00Z' }],
    gate_findings: [{ gate_run_id: 'r1', project_id: P1, severity: 'error', allowlisted: false }],
  })

  it('rejects instead of reporting "nothing new" when the findings read fails', async () => {
    const db = makeFakeDb(base() as never)
    const failed = { data: null, error: { message: 'statement timeout' } }
    const chain: any = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(failed).then(ok) : () => chain) })
    const broken = new Proxy(db, { get: (t, prop, r) => (prop === 'from' ? (name: string) => (name === 'gate_findings' ? chain : t.from(name)) : Reflect.get(t, prop, r)) })
    await expect(digest.collectDigest(broken as never, ORG, NOW)).rejects.toThrow(/hole-check findings/)
    const ok = await digest.collectDigest(db as never, ORG, NOW)
    expect(ok.projects[0].radar).toMatchObject({ error: 1, checked: true })
  })

  it('a skipped run (every check undecided) does not count as checked', async () => {
    const db = makeFakeDb({ ...base(), gate_runs: [{ id: 'r1', project_id: P1, gate: 'portfolio_radar', status: 'skipped', summary: {}, started_at: '2026-10-02T04:05:00Z' }], gate_findings: [] } as never)
    const data = await digest.collectDigest(db as never, ORG, NOW)
    expect(data.projects[0].radar).toMatchObject({ checked: false, failed: false })
  })
})
