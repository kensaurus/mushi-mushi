/**
 * FILE: edge-postgrest-call-cuts.test.ts
 * PURPOSE: mushi's own edge functions made about 300k PostgREST calls a day
 *          (Supabase edge_logs, 2026-11-28), mostly repeats of the same
 *          lookup inside one worker or a no-op write. Each cut keeps its
 *          security rule:
 *   - an API key row is reused for 30 s per worker; a miss or a failed read
 *     is never kept;
 *   - the heartbeat PATCH is sent once per key per 30 s per worker, the
 *     sticky browser_seen_at PATCH only while the row has it unset, and the
 *     SDK observation only when the heartbeat write landed;
 *   - an allowed project-access answer is reused for 30 s; a refusal is not,
 *     and an account key's project limit is checked on every call;
 *   - a resolved GitHub token and a project's repo rows are reused for 60 s;
 *     "no token" is not kept;
 *   - the Sentry callers read only the Sentry token from Vault.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

type Call = { table: string; op: 'select' | 'update'; patch?: Record<string, unknown> }

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  keyReply: { data: null as unknown, error: null as unknown },
  heartbeatRows: [] as unknown[],
  observations: [] as unknown[],
}))

/** A query builder that records what it was asked and answers from `state`. */
function chain(table: string) {
  let call: Call = { table, op: 'select' }
  const q: Record<string, unknown> = {}
  for (const m of ['eq', 'is', 'in', 'or', 'order', 'limit']) q[m] = () => q
  q.select = () => q
  q.update = (patch: Record<string, unknown>) => {
    call = { table, op: 'update', patch }
    return q
  }
  q.single = () => {
    state.calls.push(call)
    return Promise.resolve(state.keyReply)
  }
  q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
    state.calls.push(call)
    const isHeartbeat = call.op === 'update' && call.patch && 'last_seen_at' in call.patch
    return Promise.resolve({ data: isHeartbeat ? state.heartbeatRows : null, error: null }).then(ok, bad)
  }
  return q
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({
    from: (t: string) => chain(t),
    rpc: () => ({ abortSignal: () => Promise.resolve({ data: null, error: null }) }),
  }),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/sdk-observation.ts', () => ({
  upsertProjectSdkObservationAsync: (_db: unknown, input: unknown) => state.observations.push(input),
}))
vi.mock('../../supabase/functions/_shared/setup-funnel.ts', () => ({ emitFunnelEvent: () => Promise.resolve() }))
vi.mock('../../supabase/functions/_shared/funnel-steps.ts', () => ({
  emitFunnelStep: () => Promise.resolve(),
  funnelStepMemo: { claim: () => false },
}))

let auth: typeof import('../../supabase/functions/_shared/auth.ts')
let shared: typeof import('../../supabase/functions/api/shared.ts')
let keyScope: typeof import('../../supabase/functions/_shared/key-project-scope.ts')
let github: typeof import('../../supabase/functions/_shared/github.ts')
let settings: typeof import('../../supabase/functions/_shared/integration-settings.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  auth = await import('../../supabase/functions/_shared/auth.ts')
  shared = await import('../../supabase/functions/api/shared.ts')
  keyScope = await import('../../supabase/functions/_shared/key-project-scope.ts')
  github = await import('../../supabase/functions/_shared/github.ts')
  settings = await import('../../supabase/functions/_shared/integration-settings.ts')
})

const P = '1000000c-0000-4000-8000-000000000000'
const ORG = '5000000c-0000-4000-8000-000000000000'
const KEY_ROW = {
  id: 'key-1',
  key_prefix: 'mushi_te',
  project_id: P,
  is_org_scoped: false,
  allowed_project_ids: null,
  is_active: true,
  scopes: ['report:write'],
  owner_user_id: 'owner-1',
  last_seen_origin: null,
  browser_seen_at: null as string | null,
  projects: { name: 'App' },
}

beforeEach(() => {
  state.calls = []
  state.observations = []
  state.heartbeatRows = [{ id: 'key-1', owner_user_id: 'owner-1', last_seen_at: null }]
  state.keyReply = { data: { ...KEY_ROW }, error: null }
})

afterEach(() => vi.useRealTimers())

function sdkCtx(headers: Record<string, string>, path = '/v1/sdk/session') {
  const vars: Record<string, unknown> = {}
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    get: (k: string) => vars[k],
    set: (k: string, v: unknown) => {
      vars[k] = v
    },
    req: { header: (k: string) => lower[k.toLowerCase()], query: () => undefined, path, method: 'POST', url: `https://x${path}` },
    json: (body: unknown, status = 200, extra?: Record<string, string>) => ({ body, status, headers: extra }),
  }
}

const SDK = {
  'X-Mushi-Api-Key': 'mushi_test_key',
  'X-Mushi-SDK-Package': '@mushi-mushi/web',
  'X-Mushi-SDK-Version': '1.40.0',
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const keyReads = () => state.calls.filter((c) => c.table === 'project_api_keys' && c.op === 'select').length
const keyWrites = (field: string) =>
  state.calls.filter((c) => c.table === 'project_api_keys' && c.op === 'update' && c.patch && field in c.patch).length

describe('API key row cache', () => {
  it('reads a key once for repeated requests, across both middlewares, and again after 30 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const next = vi.fn(async () => {})
    await auth.apiKeyAuth(sdkCtx(SDK) as never, next)
    await auth.apiKeyAuth(sdkCtx(SDK) as never, next)
    // An SDK key is refused here (no mcp:read), but only after the same cached lookup.
    await auth.adminOrApiKey({ scope: 'mcp:read' })(sdkCtx(SDK, '/v1/admin/x') as never, next)
    expect(keyReads()).toBe(1)
    vi.setSystemTime(Date.now() + 30_001)
    await auth.apiKeyAuth(sdkCtx(SDK) as never, next)
    expect(keyReads()).toBe(2)
  })

  it('never keeps a missing key or a failed read', async () => {
    const next = vi.fn(async () => {})
    state.keyReply = { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    expect(((await auth.apiKeyAuth(sdkCtx(SDK) as never, next)) as { status: number }).status).toBe(401)
    state.keyReply = { data: null, error: { code: '57014', message: 'statement timeout' } }
    expect(((await auth.apiKeyAuth(sdkCtx(SDK) as never, next)) as { status: number }).status).toBe(503)
    state.keyReply = { data: { ...KEY_ROW }, error: null }
    await auth.apiKeyAuth(sdkCtx(SDK) as never, next)
    await auth.apiKeyAuth(sdkCtx(SDK) as never, next)
    expect(keyReads()).toBe(3)
    expect(next).toHaveBeenCalledTimes(2)
  })
})

describe('SDK heartbeat writes', () => {
  it('sends the heartbeat and browser_seen_at once, and the observation once, for a burst of browser requests', async () => {
    const next = vi.fn(async () => {})
    for (let i = 0; i < 5; i++) await auth.apiKeyAuth(sdkCtx({ ...SDK, Origin: 'https://app.example' }) as never, next)
    await flush()
    expect(keyWrites('last_seen_at')).toBe(1)
    expect(keyWrites('browser_seen_at')).toBe(1)
    expect(state.observations).toHaveLength(1)
  })

  it('does not resend browser_seen_at when the row already has it', async () => {
    state.keyReply = { data: { ...KEY_ROW, browser_seen_at: '2026-11-01T00:00:00Z' }, error: null }
    await auth.apiKeyAuth(sdkCtx({ ...SDK, Origin: 'https://app.example' }) as never, vi.fn(async () => {}))
    await flush()
    expect(keyWrites('browser_seen_at')).toBe(0)
    expect(keyWrites('last_seen_at')).toBe(1)
  })

  it('skips the observation when another worker already wrote the heartbeat this window', async () => {
    state.heartbeatRows = []
    await auth.apiKeyAuth(sdkCtx(SDK) as never, vi.fn(async () => {}))
    await flush()
    expect(keyWrites('last_seen_at')).toBe(1)
    expect(state.observations).toHaveLength(0)
  })

  it('sends the heartbeat again after the 30 s window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const next = vi.fn(async () => {})
    await auth.apiKeyAuth(sdkCtx(SDK) as never, next)
    vi.setSystemTime(Date.now() + 30_001)
    await auth.apiKeyAuth(sdkCtx(SDK) as never, next)
    await flush()
    expect(keyWrites('last_seen_at')).toBe(2)
  })
})

describe('project access cache', () => {
  function accessDb(role: string | null): FakeDb {
    return makeFakeDb({
      projects: [{ id: P, owner_id: 'someone-else', organization_id: ORG }],
      organization_members: role ? [{ organization_id: ORG, user_id: 'u1', role }] : [],
      project_members: [],
    })
  }

  it('reuses an allowed answer for 30 s, then reads again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const db = accessDb('member')
    const from = vi.spyOn(db, 'from')
    expect(await shared.userCanAccessProject(db as never, 'u1', P)).toEqual({ allowed: true, role: 'member' })
    const reads = from.mock.calls.length
    expect(await shared.userCanAccessProject(db as never, 'u1', P)).toEqual({ allowed: true, role: 'member' })
    expect(from.mock.calls.length).toBe(reads)
    vi.setSystemTime(Date.now() + 30_001)
    db.table('organization_members').splice(0)
    expect(await shared.userCanAccessProject(db as never, 'u1', P)).toEqual({ allowed: false, role: null })
  })

  it('never keeps a refusal, so a new member gets in at once', async () => {
    const db = accessDb(null)
    expect((await shared.userCanAccessProject(db as never, 'u1', P)).allowed).toBe(false)
    db.table('organization_members').push({ organization_id: ORG, user_id: 'u1', role: 'admin' })
    expect(await shared.userCanAccessProject(db as never, 'u1', P)).toEqual({ allowed: true, role: 'admin' })
  })

  it("still applies an account key's project limit on a cached answer", async () => {
    const db = accessDb('owner')
    expect((await shared.userCanAccessProject(db as never, 'u1', P)).allowed).toBe(true)
    const limited = await keyScope.runWithKeyProjectScope('u1', ['other-project'], () =>
      shared.userCanAccessProject(db as never, 'u1', P),
    )
    expect(limited).toEqual({ allowed: false, role: null })
  })
})

describe('GitHub lookups', () => {
  function githubDb(ref: string | null): FakeDb {
    return makeFakeDb(
      {
        project_settings: [{ project_id: P, github_installation_token_ref: ref }],
        projects: [{ id: P, organization_id: null }],
        project_repos: [{ project_id: P, repo_url: 'https://github.com/o/r', is_primary: true, github_app_installation_id: null }],
      },
      { rpc: (fn) => (fn === 'vault_get_secret' ? 'ghp_secret' : null) },
    )
  }

  it('resolves a stored token once per minute per project', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const db = githubDb('vault://mushi/github/p')
    for (let i = 0; i < 3; i++) {
      expect(await github.resolveProjectGithubToken(db as never, P, null, { allowEnvFallback: false })).toBe('ghp_secret')
    }
    expect(db.rpcCalls.filter((c) => c.fn === 'vault_get_secret')).toHaveLength(1)
    vi.setSystemTime(Date.now() + 60_001)
    await github.resolveProjectGithubToken(db as never, P, null, { allowEnvFallback: false })
    expect(db.rpcCalls.filter((c) => c.fn === 'vault_get_secret')).toHaveLength(2)
  })

  it('does not keep "no token", so a token connected a moment ago works', async () => {
    const db = githubDb(null)
    expect(await github.resolveProjectGithubToken(db as never, P, null, { allowEnvFallback: false })).toBeNull()
    db.table('project_settings')[0].github_installation_token_ref = 'vault://mushi/github/p'
    expect(await github.resolveProjectGithubToken(db as never, P, null, { allowEnvFallback: false })).toBe('ghp_secret')
  })

  it("reads a project's repos once for repeated installation lookups", async () => {
    const db = githubDb(null)
    db.table('project_repos')[0].github_app_installation_id = 77
    const from = vi.spyOn(db, 'from')
    expect(await github.installationIdForRepo(db as never, P, 'o/r')).toBe(77)
    expect(await github.installationIdForAttempt(db as never, { project_id: P, pr_url: 'https://github.com/o/r/pull/3' })).toBe(77)
    expect(from.mock.calls.filter(([t]) => t === 'project_repos')).toHaveLength(1)
  })
})

describe('resolveAndDereferencePlatformSettings field list', () => {
  it('reads only the named secret from Vault and blanks the other refs', async () => {
    const db = makeFakeDb(
      {
        project_settings: [
          {
            project_id: P,
            sentry_org_slug: 'acme',
            sentry_auth_token_ref: 'vault://s',
            langfuse_secret_key_ref: 'vault://l',
            linear_api_key_ref: 'vault://n',
          },
        ],
        projects: [{ id: P, organization_id: null }],
      },
      { rpc: (_fn, args) => `secret-${String(args.secret_id)}` },
    )
    const { settings: got } = await settings.resolveAndDereferencePlatformSettings(db as never, P, ['sentry_auth_token_ref'])
    expect(got.sentry_auth_token_ref).toBe('secret-s')
    expect(got.sentry_org_slug).toBe('acme')
    expect(got.langfuse_secret_key_ref).toBeNull()
    expect(got.linear_api_key_ref).toBeNull()
    expect(db.rpcCalls).toEqual([{ fn: 'vault_get_secret', args: { secret_id: 's' } }])
  })
})
