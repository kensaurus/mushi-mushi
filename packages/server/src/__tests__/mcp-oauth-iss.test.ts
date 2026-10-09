/**
 * FILE: mcp-oauth-iss.test.ts
 * PURPOSE: RFC 9207. The authorization server metadata now advertises
 *          authorization_response_iss_parameter_supported, which obliges every
 *          authorization response — the code redirect and each error
 *          redirect — to carry `iss`, and a client that sees the flag rejects
 *          a response without it. The api route handlers need a database, so
 *          their wiring is asserted at the source level (the same pattern as
 *          mcp-http-scope-filter.test.ts); the Smithery scan stub is pure and
 *          runs for real.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type StubModule = typeof import('../../supabase/functions/_shared/mcp-oauth-smithery-stub.ts')
let stub: StubModule

const env = new Map<string, string>()
const SUPABASE_URL = 'https://dxptnwrhwsqckaftyymj.supabase.co'
const FN_BASE = `${SUPABASE_URL}/functions/v1/mcp`
const PUBLIC_BASE = 'https://kensaur.us/mushi-mushi/hosted-mcp'

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => env.get(k) } }
  stub = await import('../../supabase/functions/_shared/mcp-oauth-smithery-stub.ts')
})

afterEach(() => env.clear())

const ROUTES = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/mcp-oauth.ts'), 'utf8')

describe('api/routes/mcp-oauth.ts authorization responses', () => {
  const section = (from: string, to: string) => ROUTES.split(from)[1]?.split(to)[0] ?? ''

  it('adds iss to every error redirect from /authorize', () => {
    const authorize = section("app.get('/v1/mcp-oauth/authorize'", "app.get('/v1/mcp-oauth/request'")
    expect(authorize).toMatch(/const iss = mcpOAuthIssuerForResource\(q\('resource'\) \|\| null/)
    expect(authorize).toMatch(/appendRedirectParams\(redirectUri, \{ error, error_description: description, state, iss \}\)/)
  })

  it('adds iss to the code redirect from /approve, from the stored resource', () => {
    const approve = section("app.post('/v1/mcp-oauth/approve'", "app.post('/v1/mcp-oauth/deny'")
    expect(approve).toMatch(/\.select\('[^']*\bresource\b[^']*'\)/)
    expect(approve).toMatch(/code,\s*state: row\.state,\s*iss: mcpOAuthIssuerForResource\(row\.resource/)
  })

  it('adds iss to the access_denied redirect from /deny', () => {
    const deny = section("app.post('/v1/mcp-oauth/deny'", "app.post('/v1/mcp-oauth/token'")
    expect(deny).toMatch(/\.select\('redirect_uri, state, resource'\)/)
    expect(deny).toMatch(/state: row\.state,\s*iss: mcpOAuthIssuerForResource\(row\.resource/)
  })
})

describe('Smithery scan authorize stub', () => {
  function authorize(query: Record<string, string>): URL {
    const url = new URL('http://edge-runtime.internal/mcp/oauth/authorize')
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    const res = stub.buildSmitheryAuthorizeRedirect(url)
    expect(res?.status).toBe(302)
    return new URL(res!.headers.get('location')!)
  }

  it('returns iss with the code — the proxy issuer for a proxy resource', () => {
    env.set('SUPABASE_URL', SUPABASE_URL)
    env.set('MCP_PUBLIC_BASE_URL', PUBLIC_BASE)
    const dest = authorize({ redirect_uri: 'https://smithery.ai/callback', state: 's1', resource: PUBLIC_BASE })
    expect(dest.searchParams.get('code')).toMatch(/^mushi-scan-/)
    expect(dest.searchParams.get('state')).toBe('s1')
    expect(dest.searchParams.get('iss')).toBe(PUBLIC_BASE)
  })

  it('returns the Supabase issuer when the client connected to the function URL', () => {
    env.set('SUPABASE_URL', SUPABASE_URL)
    env.set('MCP_PUBLIC_BASE_URL', PUBLIC_BASE)
    const dest = authorize({ redirect_uri: 'https://smithery.ai/callback', resource: FN_BASE })
    expect(dest.searchParams.get('iss')).toBe(FN_BASE)
  })
})
