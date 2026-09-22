/**
 * FILE: packages/server/src/__tests__/mcp-key-browser-exposure.test.ts
 * PURPOSE: A key a web page has sent is public, so its mcp:* scopes are
 *          refused (_shared/auth.ts mcpKeyBrowserExposure).
 *
 * Audit #3 (2026-09-21): the CLI had minted mcp-scoped keys into public
 * browser env, and two live apps shipped one — anyone reading those bundles
 * could list and change every report. The keys were narrowed by hand; this is
 * the server-side defence so the next such key cannot be used as an agent key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface KeyRow {
  id: string
  key_prefix: string
  project_id: string
  is_org_scoped: boolean
  is_active: boolean
  scopes: string[]
  owner_user_id: string
  last_seen_origin: string | null
  browser_seen_at: string | null
  projects: { name: string }
}

let keyRow: KeyRow | null = null

/** Chainable stand-in for the supabase-js query builder used by auth.ts. */
function fakeDb() {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'eq', 'is', 'or', 'update']) chain[m] = () => chain
  chain.single = async () => ({ data: keyRow, error: keyRow ? null : { message: 'not found' } })
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
  return { from: () => chain, rpc: async () => ({ data: null, error: null }) }
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => fakeDb() }))
vi.mock('../../supabase/functions/_shared/sdk-observation.ts', () => ({ upsertProjectSdkObservationAsync: () => {} }))
vi.mock('../../supabase/functions/_shared/setup-funnel.ts', () => ({ emitFunnelEvent: async () => {} }))

const { adminOrApiKey, apiKeyAuth, requireApiKeyScope, mcpKeyBrowserExposure } = await import(
  '../../supabase/functions/_shared/auth.ts'
)

type Middleware = (c: never, next: () => Promise<void>) => Promise<Response | void>

/** The slice of Hono's Context that auth.ts reads and writes. */
function fakeContext(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  const vars = new Map<string, unknown>()
  return {
    req: { header: (name: string) => lower[name.toLowerCase()], path: '/api/v1/admin/reports', url: 'https://api.test/api/v1/admin/reports' },
    get: (k: string) => vars.get(k),
    set: (k: string, v: unknown) => void vars.set(k, v),
    json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  }
}

async function run(mw: Middleware[], headers: Record<string, string>): Promise<{ status: number; code?: string }> {
  const c = fakeContext(headers)
  let passed = false
  // Like Hono's compose: whichever layer returns a Response ends the request,
  // even when an outer layer only awaits next().
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

const agentKey = (over: Partial<KeyRow> = {}): KeyRow => ({
  id: 'k1',
  key_prefix: 'mushi_abc123',
  project_id: 'p1',
  is_org_scoped: false,
  is_active: true,
  scopes: ['report:write', 'mcp:read'],
  owner_user_id: 'u1',
  last_seen_origin: null,
  browser_seen_at: null,
  projects: { name: 'demo' },
  ...over,
})

const KEY = { 'X-Mushi-Api-Key': 'mushi_abc123_secret' }

beforeEach(() => {
  keyRow = null
})

describe('mcpKeyBrowserExposure', () => {
  it('flags a browser request and a key a browser has sent, and nothing else', () => {
    const clean = { last_seen_origin: null, browser_seen_at: null }
    expect(mcpKeyBrowserExposure({ origin: 'https://evil.example' }, clean)).toBe('browser_request')
    expect(mcpKeyBrowserExposure({ referer: 'https://evil.example/x' }, clean)).toBe('browser_request')
    expect(mcpKeyBrowserExposure({ secFetchSite: 'cross-site' }, clean)).toBe('browser_request')
    expect(mcpKeyBrowserExposure({}, { last_seen_origin: null, browser_seen_at: '2026-09-22T00:00:00Z' })).toBe(
      'key_seen_in_browser',
    )
    expect(mcpKeyBrowserExposure({}, { last_seen_origin: 'https://app.example', browser_seen_at: null })).toBe(
      'key_seen_in_browser',
    )
    expect(mcpKeyBrowserExposure({}, clean)).toBeNull()
  })
})

describe('adminOrApiKey with an mcp scope', () => {
  const mw = [adminOrApiKey({ scope: 'mcp:read' }) as unknown as Middleware]

  it('lets an agent (no browser headers, key never in a browser) through', async () => {
    keyRow = agentKey()
    expect(await run(mw, KEY)).toEqual({ status: 200 })
  })

  it('refuses the same key sent from a web page', async () => {
    keyRow = agentKey()
    expect(await run(mw, { ...KEY, Origin: 'https://someone-elses-site.example' })).toEqual({
      status: 403,
      code: 'KEY_EXPOSED_IN_BROWSER',
    })
  })

  it('refuses a key that a browser has sent before, even from a script', async () => {
    keyRow = agentKey({ browser_seen_at: '2026-09-01T00:00:00Z' })
    expect(await run(mw, KEY)).toEqual({ status: 403, code: 'KEY_EXPOSED_IN_BROWSER' })
  })

  it('does not apply to the voice scope', async () => {
    keyRow = agentKey({ scopes: ['voice:write'], browser_seen_at: '2026-09-01T00:00:00Z' })
    expect(await run([adminOrApiKey({ scope: 'voice:write' }) as unknown as Middleware], KEY)).toEqual({ status: 200 })
  })
})

describe('apiKeyAuth + requireApiKeyScope', () => {
  it('keeps SDK ingest working from a browser (no agent scope required)', async () => {
    keyRow = agentKey({ scopes: ['report:write'], last_seen_origin: 'https://app.example' })
    expect(await run([apiKeyAuth as unknown as Middleware], { ...KEY, Origin: 'https://app.example' })).toEqual({
      status: 200,
    })
  })

  it('refuses a /v1/sync/* call with a key a browser has sent', async () => {
    keyRow = agentKey({ last_seen_origin: 'https://app.example' })
    const mw = [apiKeyAuth as unknown as Middleware, requireApiKeyScope('mcp:read') as unknown as Middleware]
    expect(await run(mw, KEY)).toEqual({ status: 403, code: 'KEY_EXPOSED_IN_BROWSER' })
  })

  it('lets the same /v1/sync/* call through for a clean agent key', async () => {
    keyRow = agentKey()
    const mw = [apiKeyAuth as unknown as Middleware, requireApiKeyScope('mcp:read') as unknown as Middleware]
    expect(await run(mw, KEY)).toEqual({ status: 200 })
  })
})
