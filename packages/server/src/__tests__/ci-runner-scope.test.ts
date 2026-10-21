/**
 * FILE: ci-runner-scope.test.ts
 * PURPOSE: The runner key is narrow both ways (Plan 022 security review):
 *            - POST /v1/ingest/runner takes only a runner:write key. The
 *              public SDK key (report:write, shipped in app bundles) and an
 *              mcp:write key are refused with 403 INSUFFICIENT_SCOPE: one
 *              would let anyone forge the CI view, the other would put a
 *              merge-capable key on a machine where CI jobs can read it.
 *            - a runner:write key opens no adminOrApiKey route, whatever
 *              scope that route asks for.
 *            - the scope is typed, mintable and allowed by the CHECK, with
 *              every earlier value kept.
 *
 * Runs the real auth.ts middleware against a stubbed key row, like
 * mcp-key-browser-exposure.test.ts.
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

async function run(mw: Middleware[], path: string): Promise<{ status: number; code?: string }> {
  const c = fakeContext({ 'X-Mushi-Api-Key': 'mushi_abc123_secret' }, path) // gitleaks:allow
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

const key = (scopes: string[]) => ({
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
})

beforeEach(() => {
  keyRow = null
})

describe('POST /v1/ingest/runner takes a runner:write key only', () => {
  const ingest = [apiKeyAuth as unknown as Middleware, requireApiKeyScope('runner:write') as unknown as Middleware]

  it('refuses the public SDK key', async () => {
    keyRow = key(['report:write'])
    expect(await run(ingest, '/v1/ingest/runner')).toEqual({ status: 403, code: 'INSUFFICIENT_SCOPE' })
  })

  it('refuses an mcp:write key (mcp:write does not imply runner:write)', async () => {
    keyRow = key(['report:write', 'mcp:read', 'mcp:write'])
    expect(await run(ingest, '/v1/ingest/runner')).toEqual({ status: 403, code: 'INSUFFICIENT_SCOPE' })
    keyRow = key(['voice:write'])
    expect(await run(ingest, '/v1/ingest/runner')).toEqual({ status: 403, code: 'INSUFFICIENT_SCOPE' })
  })

  it('accepts a runner:write key', async () => {
    keyRow = key(['runner:write'])
    expect(await run(ingest, '/v1/ingest/runner')).toEqual({ status: 200 })
  })
})

describe('a runner:write key opens no adminOrApiKey route', () => {
  for (const scope of ['mcp:read', 'mcp:write', 'voice:write'] as const) {
    it(`is refused where ${scope} is required (GET /v1/admin/ci/overview is mcp:read)`, async () => {
      keyRow = key(['runner:write'])
      expect(await run([adminOrApiKey({ scope }) as unknown as Middleware], '/v1/admin/ci/overview')).toEqual({ status: 403, code: 'INSUFFICIENT_SCOPE' })
    })
  }
  it('is refused on the default (mcp:read) and on any-of scopes', async () => {
    keyRow = key(['runner:write'])
    expect((await run([adminOrApiKey() as unknown as Middleware], '/v1/admin/reports')).code).toBe('INSUFFICIENT_SCOPE')
    expect((await run([adminOrApiKey({ scope: ['mcp:read', 'voice:write'] }) as unknown as Middleware], '/v1/intake/voice/sessions')).code).toBe('INSUFFICIENT_SCOPE')
  })
})

describe('runner:write plumbing', () => {
  const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
  const read = (p: string) => readFileSync(resolve(FUNCTIONS, p), 'utf8')

  it('is typed, mintable and wired on the ingest route', () => {
    expect(read('_shared/auth.ts')).toMatch(/export type McpScope = [^\n]*'runner:write'/)
    expect(read('api/routes/project-keys.ts')).toMatch(/ALLOWED_KEY_SCOPES = \[[^\]]*'runner:write'[^\]]*\]/)
    const ci = read('api/routes/ci.ts')
    expect(ci).toContain("app.post('/v1/ingest/runner', deps.apiKeyAuth, deps.requireRunnerScope,")
    expect(ci).toContain("requireRunnerScope: requireApiKeyScope('runner:write')")
    expect(read('api/routes/openapi.ts')).toMatch(/'\/v1\/ingest\/runner'[\s\S]{0,900}security: \[\{ mushiApiKey: \['runner:write'\] \}\]/)
  })

  it('is allowed by the CHECK, which keeps every earlier scope', () => {
    const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261021111344_ci_runner_visibility.sql'), 'utf8')
    const m = /scopes <@ array\[([^\]]*)\]/.exec(sql)
    expect(m).not.toBeNull()
    for (const s of ['report:write', 'mcp:read', 'mcp:write', 'activity:write', 'rewards:read', 'voice:write', 'runner:write']) {
      expect(m![1]).toContain(`'${s}'`)
    }
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS project_api_keys_scopes_valid')
  })

  it('keeps the migration\'s function and tables closed to clients', () => {
    const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261021111344_ci_runner_visibility.sql'), 'utf8')
    // The only new function: definer rights, pinned search_path, service role only.
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1)
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.ci_claim_live_sync'), sql.indexOf('$$;', sql.indexOf('CREATE OR REPLACE FUNCTION public.ci_claim_live_sync')))
    expect(fn).toContain('SECURITY DEFINER')
    expect(fn).toContain("SET search_path = ''")
    expect(fn).toContain('INSERT INTO public.ci_collector_state')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ci_claim_live_sync(uuid, integer) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.ci_claim_live_sync(uuid, integer) TO service_role;')
    for (const t of ['ci_jobs', 'ci_runners', 'ci_runner_hosts', 'ci_runner_job_samples', 'ci_collector_state']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`)
    }
    // Clients get SELECT policies only; writes are the service role's.
    const policies = [...sql.matchAll(/CREATE POLICY %I ON public\.%I FOR (\w+) TO (\w+)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(policies.sort()).toEqual(['ALL service_role', 'SELECT authenticated', 'SELECT authenticated'])
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM authenticated")
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM anon")
  })

  it('does not stamp the SDK heartbeat for a runner push', () => {
    expect(read('_shared/auth.ts')).toContain("!c.req.path.endsWith('/ingest/runner')")
  })
})
