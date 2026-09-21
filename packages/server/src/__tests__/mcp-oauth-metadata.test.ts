/**
 * FILE: mcp-oauth-metadata.test.ts
 * PURPOSE: Pins the hosted MCP OAuth discovery documents
 *          (_shared/mcp-oauth-metadata.ts) to what the MCP SDK's discovery
 *          accepts. Two defects aborted `claude mcp login` before client
 *          registration on both published URLs:
 *            1. the openid-configuration document lacked
 *               subject_types_supported / id_token_signing_alg_values_supported,
 *               so the SDK's OpenID provider schema threw a ZodError;
 *            2. Protected Resource Metadata fetched from the Supabase URL named
 *               the kensaur.us proxy as its `resource`, which the SDK's
 *               selectResourceURL rejects (origin mismatch).
 *          The same documents are run through the real SDK discovery in
 *          packages/mcp/src/__tests__/hosted-oauth-discovery.test.ts; this file
 *          pins the fields so the server package catches a regression on its
 *          own. (The Deno test beside the module is excluded from CI by
 *          deno-check.yml's `! -path './_shared/*'`, so it cannot be the gate.)
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

type MetadataModule = typeof import('../../supabase/functions/_shared/mcp-oauth-metadata.ts')
let meta: MetadataModule

const env = new Map<string, string>()

const SUPABASE_URL = 'https://dxptnwrhwsqckaftyymj.supabase.co'
const FN_BASE = `${SUPABASE_URL}/functions/v1/mcp`
const PUBLIC_BASE = 'https://kensaur.us/mushi-mushi/hosted-mcp'
// Inside the Supabase edge runtime req.url carries the function name but not
// the /functions/v1 gateway prefix.
const RUNTIME_ORIGIN = 'http://edge-runtime.internal'

function runtimeUrl(path: string): URL {
  return new URL(`${RUNTIME_ORIGIN}/mcp${path}`)
}

const DIRECT = new Headers()
const VIA_CLOUDFRONT = new Headers({
  'x-amz-cf-id': 'fixture-cf-request-id',
  via: '1.1 0123456789abcdef.cloudfront.net (CloudFront)',
})
const FORWARDED_PUBLIC_HOST = new Headers({ 'x-forwarded-host': 'kensaur.us' })

function parse(body: string | null): Record<string, unknown> {
  expect(body).not.toBeNull()
  return JSON.parse(body as string) as Record<string, unknown>
}

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => env.get(k) } }
  meta = await import('../../supabase/functions/_shared/mcp-oauth-metadata.ts')
})

afterEach(() => {
  env.clear()
})

function productionEnv(): void {
  env.set('SUPABASE_URL', SUPABASE_URL)
  env.set('MCP_PUBLIC_BASE_URL', `${PUBLIC_BASE}/`)
}

describe('direct requests to the Supabase function URL', () => {
  it('describe the Supabase URL, not the proxy, even when MCP_PUBLIC_BASE_URL is set', () => {
    productionEnv()
    const prm = parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/oauth-protected-resource'), DIRECT))
    expect(prm.resource).toBe(FN_BASE)
    expect(prm.authorization_servers).toEqual([FN_BASE])
    expect(meta.mcpProtectedResourceMetadataUrl(runtimeUrl(''), DIRECT)).toBe(
      `${FN_BASE}/.well-known/oauth-protected-resource`,
    )
  })

  it('never double the /functions/v1 prefix (regression: /functions/v1/functions/v1/mcp)', () => {
    env.set('SUPABASE_URL', SUPABASE_URL)
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      const doc = meta.mcpOAuthDiscoveryDocument(runtimeUrl(path), DIRECT)
      expect(doc).not.toContain('/functions/v1/functions/v1')
    }
    const as = parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/oauth-authorization-server'), DIRECT))
    expect(as.issuer).toBe(FN_BASE)
    expect(as.jwks_uri).toBe(`${FN_BASE}/.well-known/jwks.json`)
  })

  it('ignore an X-Forwarded-Host that names some other host (e.g. the Supabase gateway)', () => {
    productionEnv()
    const headers = new Headers({ 'x-forwarded-host': 'dxptnwrhwsqckaftyymj.supabase.co' })
    expect(meta.isPublicProxyRequest(headers)).toBe(false)
    const prm = parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/oauth-protected-resource'), headers))
    expect(prm.resource).toBe(FN_BASE)
  })
})

describe('requests through the CloudFront proxy', () => {
  it.each([
    ['CloudFront origin-request headers', VIA_CLOUDFRONT],
    ['X-Forwarded-Host naming the public host', FORWARDED_PUBLIC_HOST],
  ])('describe MCP_PUBLIC_BASE_URL when identified by %s', (_label, headers) => {
    productionEnv()
    expect(meta.isPublicProxyRequest(headers)).toBe(true)
    const prm = parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/oauth-protected-resource'), headers))
    expect(prm.resource).toBe(PUBLIC_BASE)
    expect(prm.authorization_servers).toEqual([PUBLIC_BASE])
    expect(meta.mcpProtectedResourceMetadataUrl(runtimeUrl(''), headers)).toBe(
      `${PUBLIC_BASE}/.well-known/oauth-protected-resource`,
    )
  })

  it('still fall back to the Supabase URL when no public base is configured', () => {
    env.set('SUPABASE_URL', SUPABASE_URL)
    expect(meta.isPublicProxyRequest(VIA_CLOUDFRONT)).toBe(false)
    const prm = parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/oauth-protected-resource'), VIA_CLOUDFRONT))
    expect(prm.resource).toBe(FN_BASE)
  })

  it('keep operational OAuth endpoints on the Supabase origin', () => {
    productionEnv()
    const as = parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/oauth-authorization-server'), VIA_CLOUDFRONT))
    expect(as.issuer).toBe(PUBLIC_BASE)
    expect(as.authorization_endpoint).toBe(`${FN_BASE}/oauth/authorize`)
    expect(as.token_endpoint).toBe(`${FN_BASE}/oauth/token`)
    expect(as.registration_endpoint).toBe(`${FN_BASE}/oauth/register`)
  })
})

describe('trailing slashes', () => {
  it('well-known PRM never ends in a slash (the SDK prefix check rejects /mcp/ for a client on /mcp)', () => {
    productionEnv()
    for (const headers of [DIRECT, VIA_CLOUDFRONT]) {
      const prm = parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/oauth-protected-resource'), headers))
      expect(String(prm.resource).endsWith('/')).toBe(false)
    }
  })

  it('a bare-URL GET echoes the slash it was sent with, and only then', () => {
    productionEnv()
    const withSlash = parse(meta.buildOAuthProtectedResourceMetadata(runtimeUrl('/'), VIA_CLOUDFRONT))
    expect(withSlash.resource).toBe(`${PUBLIC_BASE}/`)
    const withoutSlash = parse(meta.buildOAuthProtectedResourceMetadata(runtimeUrl(''), VIA_CLOUDFRONT))
    expect(withoutSlash.resource).toBe(PUBLIC_BASE)
    // Either way the issuer is the slash-less base.
    expect(withSlash.authorization_servers).toEqual([PUBLIC_BASE])
  })
})

describe('OpenID Connect discovery document', () => {
  // The SDK parses the path-appended openid-configuration with its OpenID
  // provider schema; these are that schema's required members.
  const OIDC_REQUIRED = [
    'issuer',
    'authorization_endpoint',
    'token_endpoint',
    'jwks_uri',
    'response_types_supported',
    'subject_types_supported',
    'id_token_signing_alg_values_supported',
  ]

  it('carries every member the SDK OpenID provider schema requires', () => {
    productionEnv()
    for (const headers of [DIRECT, VIA_CLOUDFRONT]) {
      const oidc = parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/openid-configuration'), headers))
      for (const key of OIDC_REQUIRED) expect(oidc, key).toHaveProperty(key)
      expect(oidc.subject_types_supported).toEqual(['public'])
      expect(oidc.id_token_signing_alg_values_supported).toEqual(['RS256'])
      expect(oidc.code_challenge_methods_supported).toEqual(['S256'])
    }
  })

  it('RFC 8414 metadata keeps the OAuth shape without OIDC-only members', () => {
    productionEnv()
    const as = parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/oauth-authorization-server'), DIRECT))
    expect(as).not.toHaveProperty('subject_types_supported')
    expect(as.response_types_supported).toEqual(['code'])
  })

  it('JWKS stays an empty key set and unrelated paths are not discovery documents', () => {
    expect(parse(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/jwks.json'), DIRECT))).toEqual({ keys: [] })
    expect(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/oauth/token'), DIRECT)).toBeNull()
    expect(meta.mcpOAuthDiscoveryDocument(runtimeUrl('/.well-known/mcp/server-card.json'), DIRECT)).toBeNull()
  })
})

describe('response headers', () => {
  it('declare the request headers the document varies on', () => {
    expect(meta.MCP_OAUTH_METADATA_HEADERS.Vary).toContain('X-Forwarded-Host')
    expect(meta.MCP_OAUTH_METADATA_HEADERS.Vary).toContain('X-Amz-Cf-Id')
  })
})
