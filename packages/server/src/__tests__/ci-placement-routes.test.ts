/**
 * FILE: ci-placement-routes.test.ts
 * PURPOSE: The CI placement routes (Plan 022 Phase 7b, ADR 0037) through the
 *          real handlers, the real connector-action flow and the GitHub
 *          connector's act(), on an in-memory database and a fake GitHub:
 *            - policy: GET/PUT console only; owners and admins save; only an
 *              owner lifts the no-spend rule; bounds; 409 before the table;
 *            - placement read and preview: access, repo binding, allowlist,
 *              policy verdict, the payload Mushi builds itself;
 *            - request: viewers refused, policy and allowlist refusals, a
 *              client cannot send its own payload, 20 an hour;
 *            - approve / reject / execute: console session of an owner or
 *              admin only, hash check, expired approval, 409 VARIABLE_MOVED,
 *              the post-change watch;
 *            - revert: only an executed change, through the same policy.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  requireApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400, extra?: Record<string, unknown>) =>
    c.json({ ok: false, error: { code, message, ...(extra ?? {}) } }, status),
  callerProjectIds: async () => [],
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))

let routes: typeof import('../../supabase/functions/api/routes/ci-placement.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/ci-placement.ts')
})

const NOW = new Date('2026-10-22T12:00:00Z')
const ORG = '0000000a-0000-4000-8000-000000000000'
const ORG2 = '0000000b-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const REPO = 'kensaurus/yen-yen'
const CI = `name: CI
on: pull_request
jobs:
  lint:
    name: Lint
    runs-on: \${{ (github.actor != 'dependabot[bot]' && github.ref != 'refs/heads/main' && vars.LINUX_RUNNER) || 'ubuntu-24.04' }}
    steps: []
  visual:
    name: Visual
    runs-on: ubuntu-latest # pixel baselines are captured on hosted
    steps: []
`

type Res = { status: number; body: { ok: boolean; data?: any; error?: { code: string; message: string; preview?: any } } }
type Handler = (c: unknown) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handler: h[h.length - 1] }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handler: h[h.length - 1] }) }
  put(path: string, ...h: Handler[]) { this.routes.push({ method: 'PUT', path, handler: h[h.length - 1] }) }
  async call(method: string, path: string, opts: { body?: unknown; query?: Record<string, string>; params?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'jwt', ...opts.vars }
    const c = {
      req: {
        json: async () => {
          if (opts.body === 'not json') throw new Error('bad json')
          return opts.body ?? {}
        },
        param: (k: string) => opts.params?.[k],
        header: () => undefined,
        query: (k: string) => opts.query?.[k],
      },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      header: () => {},
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

interface Gh { private: boolean; variable: { value: string; updated_at: string } | null; calls: string[] }

function setup(opts: { orgRole?: string | null; projectRole?: string | null; policy?: Record<string, unknown> | null; policyMissing?: boolean; gh?: Partial<Gh>; rate?: boolean } = {}) {
  const db: FakeDb = makeFakeDb(
    {
      projects: [{ id: P1, name: 'yen-yen', organization_id: ORG }],
      project_repos: [{ project_id: P1, repo_url: `https://github.com/${REPO}` }],
      organization_members: opts.orgRole === null ? [] : [{ organization_id: ORG, user_id: 'u1', role: opts.orgRole ?? 'owner' }],
      ci_collector_state: [{ project_id: P1, permissions: { [REPO]: { jobs: 'ok', runners: 'ok', visibility: 'private', owner: 'kensaurus' } } }],
      connector_snapshots: [{ project_id: P1, kind: 'github', is_current: true, ok: true, snapshot: { resources: [{ kind: 'repo', externalId: REPO }], facts: { workflowFiles: { '.github/workflows/ci.yml': CI } } } }],
      ci_runners: [
        { project_id: P1, repo: REPO, runner_name: 'alienware-yen-yen-1', status: 'online', busy: false, labels: ['self-hosted', 'kensaurus-local'] },
        { project_id: P1, repo: REPO, runner_name: 'kensaurus-local-yen-yen-1', status: 'online', busy: false, labels: ['self-hosted', 'nuc-only'] },
      ],
      ci_runner_policies: opts.policy === null || opts.policyMissing ? [] : [{ organization_id: ORG, no_paid_hosted_on_private: true, hosted_allowed_repos: [], external_controllers: [], standby_runners: ['kensaurus-local-*'], source_note: 'CI-AGREEMENT.md', ...(opts.policy ?? {}) }],
    },
    { autoId: true, failRead: (t) => (opts.policyMissing && t === 'ci_runner_policies' ? { code: '42P01', message: 'relation "public.ci_runner_policies" does not exist' } : null) },
  )
  const gh: Gh = { private: true, variable: null, calls: [], ...opts.gh }
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.replace('https://api.github.com', '')
    gh.calls.push(`${method} ${path}`)
    const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status })
    if (path === `/repos/${REPO}` && method === 'GET') return json(200, { private: gh.private })
    if (path.startsWith(`/repos/${REPO}/actions/variables/`) && method === 'GET') {
      return gh.variable && path.endsWith('/LINUX_RUNNER') ? json(200, { name: 'LINUX_RUNNER', ...gh.variable }) : json(404, {})
    }
    if (method === 'POST' || method === 'PATCH') {
      gh.variable = { value: JSON.parse(String(init?.body)).value, updated_at: '2026-10-22T12:00:05Z' }
      return json(method === 'POST' ? 201 : 204, null)
    }
    if (method === 'DELETE') {
      gh.variable = null
      return json(204, null)
    }
    return json(404, {})
  }
  const audits: unknown[] = []
  let clock = NOW
  const app = new FakeApp()
  routes.registerCiPlacementRoutes(app as never, {
    getServiceClient: () => db as never,
    adminOrApiKeyRead: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    adminOrApiKeyWrite: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    jwtAuth: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    callerProjectIds: async () => [P1],
    callerCanAccessProject: async (_c: unknown, _db: unknown, _u: unknown, projectId: string) =>
      ({ allowed: projectId === P1 && opts.projectRole !== null, role: opts.projectRole ?? 'member' }) as never,
    claimRateLimit: async () => ({ allowed: opts.rate !== false, retryAfterSec: 60 }),
    logOrgAudit: (async (_db: unknown, input: unknown) => { audits.push(input) }) as never,
    resolveToken: async () => 'ghp_stored_pat',
    fetch: fetchImpl,
    loadCompare: async () => ({
      rows: [{ repo: REPO, runnerClass: 'self_hosted', labels: ['kensaurus-local'], queueP95s: 191 }],
      whatIfs: [{ id: `to_self:${P1}:${REPO}:CI`, repo: REPO, monthCostDelta: -4.2, currency: 'USD' }],
    }) as never,
    execute: { fetch: fetchImpl, now: () => clock, legacyGithubToken: async () => 'ghp_stored_pat' },
    now: () => clock,
  })
  return { db, gh, app, audits, tick: (ms: number) => { clock = new Date(clock.getTime() + ms) } }
}

const body = (over: Record<string, unknown> = {}) => ({ projectId: P1, repo: REPO, variable: 'LINUX_RUNNER', value: 'kensaurus-local', ...over })
const policyBody = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  noPaidHostedOnPrivate: true,
  hostedAllowedRepos: ['AtPeak-Co-Ltd/pck', 'kensaurus/mushi-mushi'],
  externalControllers: [{ name: 'kci dispatcher', owner: 'sbc-visual', repos: ['kensaurus/tsumagoi'] }],
  standbyRunners: ['kensaurus-local-*'],
  sourceNote: 'CI-AGREEMENT.md, 2026-10-22',
  ...over,
})

async function request(s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
  const res = await s.app.call('POST', '/v1/admin/ci/placement/requests', { body: body(over) })
  if (res.status !== 201) throw new Error(`request failed: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.data as { id: string; payloadSha256: string }
}

describe('GET/PUT /v1/admin/ci/policy', () => {
  it('GET reads the policy; owners and admins edit, only owners lift', async () => {
    const owner = setup()
    const res = await owner.app.call('GET', '/v1/admin/ci/policy', { query: { project_id: P1 } })
    expect(res.body.data).toMatchObject({ organizationId: ORG, writable: true, canEdit: true, canLift: true, policy: { noPaidHostedOnPrivate: true, standbyRunners: ['kensaurus-local-*'] } })
    const member = setup({ orgRole: 'member' })
    expect((await member.app.call('GET', '/v1/admin/ci/policy', {})).body.data).toMatchObject({ canEdit: false, canLift: false })
    const none = setup({ policy: null })
    expect((await none.app.call('GET', '/v1/admin/ci/policy', {})).body.data.policy).toBeNull()
  })

  it('GET says not writable before the table exists, and refuses another organization', async () => {
    const s = setup({ policyMissing: true })
    expect((await s.app.call('GET', '/v1/admin/ci/policy', {})).body.data).toMatchObject({ writable: false, canEdit: false, policy: null })
    expect((await s.app.call('GET', '/v1/admin/ci/policy', { query: { organization_id: ORG2 } })).status).toBe(403)
  })

  it('PUT saves the agreement (owner or admin) and audits it', async () => {
    const s = setup({ policy: null, orgRole: 'admin' })
    const res = await s.app.call('PUT', '/v1/admin/ci/policy', { body: policyBody() })
    expect(res.status).toBe(200)
    expect(s.db.table('ci_runner_policies')[0]).toMatchObject({ organization_id: ORG, no_paid_hosted_on_private: true, hosted_allowed_repos: ['AtPeak-Co-Ltd/pck', 'kensaurus/mushi-mushi'], standby_runners: ['kensaurus-local-*'], updated_by: 'u1' })
    expect(s.audits[0]).toMatchObject({ action: 'settings.updated', resourceType: 'ci_runner_policy', metadata: { first_save: true, no_spend_lifted: false } })
  })

  it('PUT: only an owner turns the no-spend rule off', async () => {
    const admin = setup({ orgRole: 'admin' })
    const refused = await admin.app.call('PUT', '/v1/admin/ci/policy', { body: policyBody({ noPaidHostedOnPrivate: false }) })
    expect(refused).toMatchObject({ status: 403, body: { error: { code: 'OWNER_REQUIRED' } } })
    const owner = setup()
    expect((await owner.app.call('PUT', '/v1/admin/ci/policy', { body: policyBody({ noPaidHostedOnPrivate: false }) })).status).toBe(200)
    expect(owner.audits[0]).toMatchObject({ metadata: { no_spend_lifted: true } })
  })

  it('PUT refuses members, viewers, strangers and API keys', async () => {
    expect((await setup({ orgRole: 'member' }).app.call('PUT', '/v1/admin/ci/policy', { body: policyBody() })).status).toBe(403)
    expect((await setup({ orgRole: 'viewer' }).app.call('PUT', '/v1/admin/ci/policy', { body: policyBody() })).status).toBe(403)
    expect((await setup({ orgRole: null }).app.call('PUT', '/v1/admin/ci/policy', { body: policyBody() })).status).toBe(403)
    const key = await setup().app.call('PUT', '/v1/admin/ci/policy', { body: policyBody(), vars: { authMethod: 'apiKey' } })
    expect(key).toMatchObject({ status: 403, body: { error: { code: 'CONSOLE_ONLY' } } })
  })

  it('PUT enforces the bounds, and answers 409 before the table exists', async () => {
    const s = setup()
    for (const over of [
      { hostedAllowedRepos: ['not a repo'] },
      { standbyRunners: ['bad label!'] },
      { externalControllers: Array.from({ length: 21 }, (_, i) => ({ name: `c${i}`, owner: '', repos: ['a/b'] })) },
      { externalControllers: [{ name: 'x', owner: '', repos: [] }] },
      { sourceNote: 'x'.repeat(301) },
      { extra: 1 },
    ]) {
      expect((await s.app.call('PUT', '/v1/admin/ci/policy', { body: policyBody(over) })).status).toBe(400)
    }
    const missing = setup({ policyMissing: true })
    expect((await missing.app.call('PUT', '/v1/admin/ci/policy', { body: policyBody() })).body.error?.code).toBe('MIGRATION_PENDING')
  })
})

describe('GET /v1/admin/ci/placement and POST preview', () => {
  it('lists the repo, the variable its workflows read with its current value, labels and the policy', async () => {
    const s = setup({ gh: { variable: { value: 'old', updated_at: '2026-10-21T15:11:00Z' } } })
    const res = await s.app.call('GET', '/v1/admin/ci/placement', { query: { project_id: P1 } })
    expect(res.status).toBe(200)
    const repo = res.body.data.repos[0]
    expect(repo).toMatchObject({ repo: REPO, visibility: 'private', workflowsRead: true, controller: null })
    expect(repo.variables[0]).toMatchObject({ name: 'LINUX_RUNNER', jobs: 1, fallbacks: ['ubuntu-24.04'], allowed: true, current: { exists: true, value: 'old' } })
    expect(repo.labels.find((l: { label: string }) => l.label === 'kensaurus-local')).toMatchObject({ runners: 1, online: 1 })
    expect(res.body.data).toMatchObject({ canDecide: true, canRequest: true, tokenStored: true })
    expect(s.gh.calls.filter((c) => c.startsWith('GET /repos/kensaurus/yen-yen/actions/variables')).length).toBeLessThanOrEqual(6)
  })

  it('refuses a project the caller cannot read', async () => {
    const r = await setup({ projectRole: null }).app.call('GET', '/v1/admin/ci/placement', { query: { project_id: P1 } })
    expect(r.status).toBe(403)
  })

  it('previews yen-yen: two jobs, one stays pinned, cost from the comparison, a payload Mushi built', async () => {
    const s = setup()
    const res = await s.app.call('POST', '/v1/admin/ci/placement/preview', { body: body() })
    expect(res.status).toBe(200)
    const p = res.body.data
    expect(p.blocked).toBeNull()
    expect(p.jobs.moves.map((m: { job: string }) => m.job)).toEqual(['Lint'])
    expect(p.jobs.stays[0]).toMatchObject({ job: 'Visual', why: 'pinned_hosted' })
    expect(p.target).toMatchObject({ label: 'kensaurus-local', online: 1, waitP95s: 191 })
    expect(p.cost).toMatchObject({ monthCostDelta: -4.2 })
    expect(p.payload.expected).toEqual({ exists: false, value: null, updatedAt: null })
  })

  it('refuses a repo outside the project and a variable outside the allowlist', async () => {
    const s = setup()
    expect((await s.app.call('POST', '/v1/admin/ci/placement/preview', { body: body({ repo: 'kensaurus/other' }) })).body.error?.code).toBe('REPO_NOT_IN_PROJECT')
    const r = await s.app.call('POST', '/v1/admin/ci/placement/preview', { body: body({ variable: 'EXPO_PUBLIC_API_URL' }) })
    expect(r).toMatchObject({ status: 403, body: { error: { code: 'VARIABLE_NOT_ALLOWED' } } })
    expect((await s.app.call('POST', '/v1/admin/ci/placement/preview', { body: 'not json' })).status).toBe(400)
  })
})

describe('POST /v1/admin/ci/placement/requests', () => {
  it('stores a pending request with the server-built payload; nothing is written to GitHub', async () => {
    const s = setup()
    const data = await request(s, { reason: 'yen-yen has no LINUX_RUNNER' })
    const row = s.db.table('connector_actions')[0]
    expect(row).toMatchObject({ id: data.id, connector_kind: 'github', action: 'set_actions_variable', status: 'pending_approval', requested_by: 'user:u1', reason: 'yen-yen has no LINUX_RUNNER' })
    expect((row.payload as { value: string }).value).toBe('kensaurus-local')
    expect(s.gh.calls.filter((c) => !c.startsWith('GET'))).toEqual([])
  })

  it('a client cannot send its own payload', async () => {
    const res = await setup().app.call('POST', '/v1/admin/ci/placement/requests', { body: { ...body(), payload: { name: 'EXPO_PUBLIC_API_URL' } } })
    expect(res.status).toBe(400)
  })

  it('refuses viewers, policy refusals (with the preview), the allowlist, and over 20 an hour', async () => {
    expect((await setup({ projectRole: 'viewer' }).app.call('POST', '/v1/admin/ci/placement/requests', { body: body() })).status).toBe(403)
    const hosted = await setup({ gh: { variable: { value: 'kensaurus-local', updated_at: 't0' } } }).app.call('POST', '/v1/admin/ci/placement/requests', { body: body({ value: null }) })
    expect(hosted).toMatchObject({ status: 403, body: { error: { code: 'POLICY_NO_PAID_HOSTED' } } })
    expect(hosted.body.error?.preview?.policy?.reason).toMatch(/no paid GitHub-hosted minutes/)
    expect((await setup().app.call('POST', '/v1/admin/ci/placement/requests', { body: body({ value: 'kensaurus-local-yen-yen-1' }) })).body.error?.code).toBe('POLICY_STANDBY_TARGET')
    expect((await setup().app.call('POST', '/v1/admin/ci/placement/requests', { body: body({ variable: 'GITHUB_TOKEN' }) })).status).toBe(403)
    expect((await setup({ rate: false }).app.call('POST', '/v1/admin/ci/placement/requests', { body: body() })).status).toBe(429)
  })

  it('an API key may ask (MCP request_ci_placement_change)', async () => {
    const s = setup()
    const res = await s.app.call('POST', '/v1/admin/ci/placement/requests', { body: body(), vars: { authMethod: 'apiKey', apiKeyId: 'k1' } })
    expect(res.status).toBe(201)
    expect(s.db.table('connector_actions')[0].requested_by).toBe('api_key:k1')
  })
})

describe('approve, reject, execute', () => {
  const call = (s: ReturnType<typeof setup>, verb: string, id: string, extra: { body?: unknown; vars?: Record<string, unknown> } = {}) =>
    s.app.call('POST', `/v1/admin/ci/placement/requests/:id/${verb}`, { params: { id }, ...extra })

  it('needs a console session of an owner or admin', async () => {
    const s = setup({ orgRole: 'member' })
    const { id, payloadSha256 } = await request(s)
    expect(await call(s, 'approve', id, { body: { payloadSha256 }, vars: { authMethod: 'apiKey' } })).toMatchObject({ status: 403, body: { error: { code: 'HUMAN_REQUIRED' } } })
    expect((await call(s, 'approve', id, { body: { payloadSha256 } })).status).toBe(403)
    expect((await call(s, 'approve', '9000000a-0000-4000-8000-000000000000', { body: { payloadSha256 } })).status).toBe(404)
  })

  it('approves with the hash the approver saw, runs once, and starts the watch', async () => {
    const s = setup()
    const { id, payloadSha256 } = await request(s)
    expect((await call(s, 'approve', id, { body: { payloadSha256: 'f'.repeat(64) } })).body.error?.code).toBe('HASH_MISMATCH')
    expect((await call(s, 'approve', id, { body: { payloadSha256 } })).status).toBe(200)
    const run = await call(s, 'execute', id)
    expect(run.status).toBe(200)
    expect(run.body.data).toMatchObject({ ok: true, watching: true })
    expect(s.gh.variable?.value).toBe('kensaurus-local')
    expect(s.db.table('ci_placement_watches')[0]).toMatchObject({ action_id: id, repo: REPO, variable: 'LINUX_RUNNER', previous_value: null, new_value: 'kensaurus-local', expected_labels: ['kensaurus-local'], status: 'watching' })
    expect((await call(s, 'execute', id)).body.error?.code).toBe('NOT_APPROVED')
  })

  it('an approval expires after an hour (410)', async () => {
    const s = setup()
    const { id, payloadSha256 } = await request(s)
    await call(s, 'approve', id, { body: { payloadSha256 } })
    s.tick(61 * 60_000)
    expect(await call(s, 'execute', id)).toMatchObject({ status: 410, body: { error: { code: 'APPROVAL_EXPIRED' } } })
    expect(s.gh.variable).toBeNull()
  })

  it('409 VARIABLE_MOVED when someone changed the variable between request and execution', async () => {
    const s = setup()
    const { id, payloadSha256 } = await request(s)
    await call(s, 'approve', id, { body: { payloadSha256 } })
    s.gh.variable = { value: 'set-by-the-dispatcher', updated_at: '2026-10-22T12:00:30Z' }
    expect(await call(s, 'execute', id)).toMatchObject({ status: 409, body: { error: { code: 'VARIABLE_MOVED' } } })
    expect(s.gh.variable.value).toBe('set-by-the-dispatcher')
  })

  it('rejects a pending request', async () => {
    const s = setup()
    const { id } = await request(s)
    expect((await call(s, 'reject', id)).status).toBe(200)
    expect(s.db.table('connector_actions')[0].status).toBe('rejected')
  })
})

describe('revert', () => {
  async function executed(s: ReturnType<typeof setup>) {
    const { id, payloadSha256 } = await request(s)
    await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/approve', { params: { id }, body: { payloadSha256 } })
    await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/execute', { params: { id } })
    return id
  }

  it('only an executed change can be reverted', async () => {
    const s = setup()
    const { id } = await request(s)
    expect((await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/revert', { params: { id } })).body.error?.code).toBe('NOT_EXECUTED')
  })

  it('a revert to paid GitHub-hosted on a private repo is refused while the agreement says no', async () => {
    const s = setup()
    const id = await executed(s)
    const r = await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/revert', { params: { id } })
    expect(r).toMatchObject({ status: 403, body: { error: { code: 'POLICY_NO_PAID_HOSTED' } } })
  })

  it('without that rule the revert is requested, approved, run, and closes the watch', async () => {
    const s = setup({ policy: { no_paid_hosted_on_private: false } })
    const id = await executed(s)
    const r = await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/revert', { params: { id } })
    expect(r.status).toBe(201)
    const rev = r.body.data as { id: string; payloadSha256: string }
    expect(s.db.table('ci_placement_watches')[0].revert_action_id).toBe(rev.id)
    const row = s.db.table('connector_actions').find((a) => a.id === rev.id)!
    expect(row).toMatchObject({ action: 'delete_actions_variable', status: 'pending_approval' })
    expect((row.payload as { revertOf: string; expected: { value: string } })).toMatchObject({ revertOf: id, expected: { value: 'kensaurus-local' } })
    await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/approve', { params: { id: rev.id }, body: { payloadSha256: rev.payloadSha256 } })
    expect((await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/execute', { params: { id: rev.id } })).status).toBe(200)
    expect(s.gh.variable).toBeNull()
    expect(s.db.table('ci_placement_watches').find((w) => w.action_id === id)!.status).toBe('reverted')
  })

  it('refuses a revert when the variable moved since Mushi set it', async () => {
    const s = setup({ policy: { no_paid_hosted_on_private: false } })
    const id = await executed(s)
    s.gh.variable = { value: 'someone-else', updated_at: '2026-10-22T13:00:00Z' }
    expect((await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/revert', { params: { id } })).body.error?.code).toBe('VARIABLE_MOVED')
  })
})

describe('security review fixes (ADR 0037)', () => {
  async function executed(s: ReturnType<typeof setup>) {
    const { id, payloadSha256 } = await request(s)
    await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/approve', { params: { id }, body: { payloadSha256 } })
    await s.app.call('POST', '/v1/admin/ci/placement/requests/:id/execute', { params: { id } })
    return id
  }
  const revert = (s: ReturnType<typeof setup>, id: string) => s.app.call('POST', '/v1/admin/ci/placement/requests/:id/revert', { params: { id } })

  it('refuses a second revert while one waits, and a revert when the variable was changed and set back', async () => {
    const s = setup({ policy: { no_paid_hosted_on_private: false } })
    const id = await executed(s)
    expect((await revert(s, id)).status).toBe(201)
    expect(await revert(s, id)).toMatchObject({ status: 409, body: { error: { code: 'REVERT_PENDING' } } })

    const t = setup({ policy: { no_paid_hosted_on_private: false } })
    const id2 = await executed(t)
    // Someone set the same value again: same value, newer updated_at.
    t.gh.variable = { value: 'kensaurus-local', updated_at: '2026-10-22T13:00:00Z' }
    expect((await revert(t, id2)).body.error?.code).toBe('VARIABLE_MOVED')
  })

  it('rate-limits reverts like requests', async () => {
    const s = setup({ policy: { no_paid_hosted_on_private: false } })
    const id = await executed(s)
    const limited = setup({ policy: { no_paid_hosted_on_private: false }, rate: false })
    // Copy the executed row and its watch into a rate-limited app.
    for (const t of ['connector_actions', 'ci_placement_watches']) limited.db.tables[t] = s.db.table(t).map((r) => ({ ...r }))
    limited.gh.variable = s.gh.variable
    expect((await revert(limited, id)).status).toBe(429)
  })

  it('placement reads only this project\'s runners for a repo', async () => {
    const s = setup()
    s.db.table('ci_runners').push({ project_id: '1000000b-0000-4000-8000-000000000000', repo: REPO, runner_name: 'other-tenant-runner', status: 'online', busy: false, labels: ['secret-label'] })
    const res = await s.app.call('GET', '/v1/admin/ci/placement', { query: { project_id: P1 } })
    expect(JSON.stringify(res.body.data)).not.toContain('secret-label')
    const p = await s.app.call('POST', '/v1/admin/ci/placement/preview', { body: body({ value: 'secret-label' }) })
    expect(p.body.data.blocked?.code).toBe('POLICY_UNKNOWN_TARGET')
  })
})
