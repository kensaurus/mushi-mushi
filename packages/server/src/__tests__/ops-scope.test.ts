/**
 * FILE: ops-scope.test.ts
 * PURPOSE: The ops:write key is narrow both ways (Ops hub,
 *          docs/execplans/ops-hub-slack.md §2):
 *            - POST /v1/ops/events takes only an ops:write key: the public
 *              SDK key and an mcp:write key are refused (mcp:write does not
 *              imply it);
 *            - it is a server's key: refused from a browser (Origin,
 *              Referer or Sec-Fetch-Site), and refused once it was ever seen
 *              in a browser;
 *            - it opens no adminOrApiKey route;
 *            - it is typed, mintable, allowed by the CHECK (every earlier
 *              scope kept), and an ops push never stamps the SDK heartbeat.
 *          Also: the Ops ingest's rate limit fails closed.
 *
 * Runs the real auth.ts middleware against a stubbed key row, like
 * ci-runner-scope.test.ts.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let keyRow: Record<string, unknown> | null = null

function fakeDb() {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'eq', 'is', 'or', 'update']) chain[m] = () => chain
  chain.single = async () => ({ data: keyRow, error: keyRow ? null : { message: 'not found' } })
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  return { from: () => chain, rpc: async () => ({ data: null, error: null }) }
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => fakeDb() }))
vi.mock('../../supabase/functions/_shared/sdk-observation.ts', () => ({ upsertProjectSdkObservationAsync: () => {} }))
vi.mock('../../supabase/functions/_shared/setup-funnel.ts', () => ({ emitFunnelEvent: async () => {} }))

const { adminOrApiKey, apiKeyAuth, requireApiKeyScope } = await import('../../supabase/functions/_shared/auth.ts')
const { claimTenantRateLimitStrict } = await import('../../supabase/functions/_shared/tenant-observability.ts')

type Middleware = (c: never, next: () => Promise<void>) => Promise<Response | void>

function fakeContext(headers: Record<string, string>, path: string) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  const vars = new Map<string, unknown>()
  return {
    req: { header: (name: string) => lower[name.toLowerCase()], path, url: `https://api.test${path}` },
    get: (k: string) => vars.get(k),
    set: (k: string, v: unknown) => void vars.set(k, v),
    json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  }
}

async function run(mw: Middleware[], path: string, extra: Record<string, string> = {}): Promise<{ status: number; code?: string }> {
  const c = fakeContext({ 'X-Mushi-Api-Key': 'mushi_abc123_secret', ...extra }, path) // gitleaks:allow
  let passed = false
  let res: Response | undefined
  const chainAt = async (i: number): Promise<void> => {
    if (i === mw.length) {
      passed = true
      return
    }
    const out = await mw[i](c as never, async () => {
      await chainAt(i + 1)
    })
    if (out instanceof Response) res ??= out
  }
  await chainAt(0)
  if (passed) return { status: 200 }
  const body = (await (res as Response).json()) as { error?: { code?: string } }
  return { status: (res as Response).status, code: body.error?.code }
}

const key = (scopes: string[], over: Record<string, unknown> = {}) => ({
  id: 'k1',
  key_prefix: 'mushi_abc123', // gitleaks:allow
  project_id: 'p1',
  is_org_scoped: false,
  is_active: true,
  scopes,
  owner_user_id: 'u1',
  last_seen_origin: null,
  browser_seen_at: null,
  projects: { name: 'demo' },
  ...over,
})

beforeEach(() => {
  keyRow = null
})

describe('POST /v1/ops/events takes an ops:write key only', () => {
  const ingest = [apiKeyAuth as unknown as Middleware, requireApiKeyScope('ops:write') as unknown as Middleware]

  it('accepts an ops:write key from a server', async () => {
    keyRow = key(['ops:write'])
    expect(await run(ingest, '/v1/ops/events')).toEqual({ status: 200 })
  })

  it('refuses the SDK key, an mcp:write key and a runner key', async () => {
    for (const scopes of [['report:write'], ['report:write', 'mcp:read', 'mcp:write'], ['runner:write'], ['worker:run']]) {
      keyRow = key(scopes)
      expect(await run(ingest, '/v1/ops/events'), scopes.join(',')).toEqual({ status: 403, code: 'INSUFFICIENT_SCOPE' })
    }
  })

  it('refuses it from a browser: Origin, Referer or Sec-Fetch-Site', async () => {
    keyRow = key(['ops:write'])
    for (const h of [{ Origin: 'https://app.test' }, { Referer: 'https://app.test/x' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      expect(await run(ingest, '/v1/ops/events', h)).toEqual({ status: 403, code: 'KEY_EXPOSED_IN_BROWSER' })
    }
  })

  it('refuses a key that was ever seen in a browser', async () => {
    keyRow = key(['ops:write'], { browser_seen_at: '2026-11-01T00:00:00Z' })
    expect(await run(ingest, '/v1/ops/events')).toEqual({ status: 403, code: 'KEY_EXPOSED_IN_BROWSER' })
  })
})

describe('an ops:write key opens no adminOrApiKey route', () => {
  for (const scope of ['mcp:read', 'mcp:write', 'runner:write'] as const) {
    it(`is refused where ${scope} is required`, async () => {
      keyRow = key(['ops:write'])
      expect(await run([adminOrApiKey({ scope }) as unknown as Middleware], '/v1/admin/reports')).toEqual({ status: 403, code: 'INSUFFICIENT_SCOPE' })
    })
  }
})

describe('ops:write plumbing', () => {
  const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
  const read = (p: string) => readFileSync(resolve(FUNCTIONS, p), 'utf8')

  it('is typed, mintable and wired on the ingest route', () => {
    expect(read('_shared/auth.ts')).toMatch(/export type McpScope = [^\n]*'ops:write'/)
    expect(read('api/routes/project-keys.ts')).toMatch(/ALLOWED_KEY_SCOPES = \[[^\]]*'ops:write'[^\]]*\]/)
    const ops = read('api/routes/ops.ts')
    expect(ops).toContain("app.post('/v1/ops/events', deps.apiKeyAuth, deps.requireOpsScope,")
    expect(ops).toContain("requireOpsScope: requireApiKeyScope('ops:write')")
    expect(read('api/routes/openapi.ts')).toMatch(/'\/v1\/ops\/events'[\s\S]{0,1200}security: \[\{ mushiApiKey: \['ops:write'\] \}\]/)
  })

  it('is allowed by the CHECK, which keeps every earlier scope, and the new tables are closed to clients', () => {
    const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261117120000_ops_hub.sql'), 'utf8')
    const m = /scopes <@ array\[([^\]]*)\]/.exec(sql)
    expect(m).not.toBeNull()
    for (const s of ['report:write', 'mcp:read', 'mcp:write', 'activity:write', 'rewards:read', 'voice:write', 'runner:write', 'worker:run', 'ops:write']) {
      expect(m![1]).toContain(`'${s}'`)
    }
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS project_api_keys_scopes_valid')
    for (const t of ['ops_events', 'ops_slack_settings', 'ops_mutes']) expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`)
    // Settings hold Vault ids: no client policy at all.
    expect(sql).toContain('REVOKE ALL ON TABLE public.ops_slack_settings FROM anon, authenticated;')
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON public\.ops_slack_settings\s+FOR SELECT TO authenticated/)
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ops_coverage(uuid) FROM PUBLIC, anon, authenticated;')
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ops_events_org_dedupe_key\s+ON public\.ops_events \(organization_id, dedupe_key\) WHERE dedupe_key IS NOT NULL/)
    // Additive only.
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|^\s*TRUNCATE|^\s*DELETE FROM/im)
  })

  it('does not stamp the SDK heartbeat for an ops push', () => {
    expect(read('_shared/auth.ts')).toContain("!c.req.path.endsWith('/ops/events')")
  })
})

describe('claimTenantRateLimitStrict fails closed', () => {
  it('allows under the limit, denies over it with Retry-After, and denies when the limit cannot be checked', async () => {
    const ok = { rpc: async () => ({ error: null }) }
    expect(await claimTenantRateLimitStrict(ok as never, 'project:p1:ops_ingest', 120, 60)).toEqual({ allowed: true })
    const over = { rpc: async () => ({ error: { message: 'rate_limit_exceeded retry_after=17' } }) }
    expect(await claimTenantRateLimitStrict(over as never, 'k', 120, 60)).toEqual({ allowed: false, retryAfterSec: 17 })
    const down = { rpc: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }) }
    expect(await claimTenantRateLimitStrict(down as never, 'k', 120, 60)).toMatchObject({ allowed: false, unavailable: true })
    const thrown = { rpc: async () => { throw new Error('socket hang up') } }
    expect(await claimTenantRateLimitStrict(thrown as never, 'k', 120, 60)).toMatchObject({ allowed: false, unavailable: true })
  })
})
