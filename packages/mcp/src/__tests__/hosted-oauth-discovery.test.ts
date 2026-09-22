/**
 * FILE: packages/mcp/src/__tests__/hosted-oauth-discovery.test.ts
 * PURPOSE: Runs the official MCP SDK's OAuth orchestrator — the code path
 *          `claude mcp login` and other SDK clients take — against the hosted
 *          server's real discovery documents
 *          (packages/server/supabase/functions/_shared/mcp-oauth-metadata.ts).
 *
 *          Live, both published URLs used to abort inside the SDK before
 *          client registration: the openid-configuration document failed the
 *          SDK's OpenID provider schema, and the Supabase URL's Protected
 *          Resource Metadata named the kensaur.us proxy as its resource. This
 *          test fails if either comes back.
 *
 *          The fake network models production as it is deployed today:
 *            - the Supabase origin serves only /functions/v1/mcp/*, so every
 *              RFC 8414 / RFC 9728 path-inserted URL at its root 404s;
 *            - the CloudFront proxy strips /mushi-mushi/hosted-mcp, forwards to
 *              the same function and stamps X-Amz-Cf-Id + Via, and has no
 *              route for path-inserted well-known URLs.
 *
 *          The SDK lives here (devDependency), the documents live in the
 *          server package; the module is loaded by computed path so this
 *          package's tsc never type-checks a Deno file.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  auth,
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  selectResourceURL,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

interface HostedOAuthMetadata {
  mcpOAuthDiscoveryDocument(url: URL, headers: Headers): string | null
  mcpProtectedResourceMetadataUrl(url: URL, headers: Headers): string
  bearerWwwAuthenticateResourceMetadata(metadataUrl: string): string
}

const SUPABASE_URL = 'https://dxptnwrhwsqckaftyymj.supabase.co'
const FN_BASE = `${SUPABASE_URL}/functions/v1/mcp`
const PUBLIC_BASE = 'https://kensaur.us/mushi-mushi/hosted-mcp'
const RUNTIME_ORIGIN = 'http://edge-runtime.internal'
const CLOUDFRONT_HEADERS: Record<string, string> = {
  'x-amz-cf-id': 'fixture-cf-request-id',
  via: '1.1 0123456789abcdef.cloudfront.net (CloudFront)',
}

const env = new Map<string, string>([
  ['SUPABASE_URL', SUPABASE_URL],
  ['MCP_PUBLIC_BASE_URL', PUBLIC_BASE],
])

let hosted: HostedOAuthMetadata

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => env.get(k) } }
  const here = dirname(fileURLToPath(import.meta.url))
  const modulePath = resolve(here, '../../../server/supabase/functions/_shared/mcp-oauth-metadata.ts')
  hosted = (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)) as HostedOAuthMetadata
})

/** Map a public URL to what the edge function receives, or null when nothing serves it. */
function toFunctionRequest(publicUrl: URL): { url: URL; headers: Headers } | null {
  const href = publicUrl.href.split('?')[0]
  for (const [base, headers] of [
    [FN_BASE, {}],
    [PUBLIC_BASE, CLOUDFRONT_HEADERS],
  ] as const) {
    if (href === base || href.startsWith(`${base}/`)) {
      // Inside the edge runtime req.url carries /mcp, not /functions/v1/mcp.
      return { url: new URL(`${RUNTIME_ORIGIN}/mcp${href.slice(base.length)}`), headers: new Headers(headers) }
    }
  }
  return null
}

interface FakeNetwork {
  fetchFn: (input: string | URL, init?: RequestInit) => Promise<Response>
  requests: string[]
}

function fakeNetwork(): FakeNetwork {
  const requests: string[] = []
  const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    requests.push(`${method} ${url.href}`)
    if (method === 'POST' && url.href === `${FN_BASE}/oauth/register`) {
      // Stand-in for api/routes/mcp-oauth.ts — reaching it is the point.
      const body = JSON.parse(String(init?.body)) as OAuthClientMetadata
      return Response.json({ ...body, client_id: 'fixture-client-id', client_id_issued_at: 0 }, { status: 201 })
    }
    const target = toFunctionRequest(url)
    const document = target ? hosted.mcpOAuthDiscoveryDocument(target.url, target.headers) : null
    if (document === null) return new Response('not found', { status: 404 })
    return new Response(document, { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetchFn, requests }
}

/** The WWW-Authenticate challenge the function sends on an unauthenticated POST. */
function challengeFor(serverUrl: string): URL {
  const target = toFunctionRequest(new URL(serverUrl))
  if (!target) throw new Error(`no route for ${serverUrl}`)
  const metadataUrl = hosted.mcpProtectedResourceMetadataUrl(target.url, target.headers)
  const res = new Response(null, {
    status: 401,
    headers: { 'WWW-Authenticate': hosted.bearerWwwAuthenticateResourceMetadata(metadataUrl) },
  })
  const { resourceMetadataUrl } = extractWWWAuthenticateParams(res)
  if (!resourceMetadataUrl) throw new Error('401 challenge carries no resource_metadata')
  return resourceMetadataUrl
}

class RecordingProvider implements OAuthClientProvider {
  client: OAuthClientInformationMixed | undefined
  authorizationUrl: URL | undefined
  verifier = ''
  readonly redirectUrl = 'http://localhost:33418/callback'
  readonly clientMetadata: OAuthClientMetadata = {
    redirect_uris: ['http://localhost:33418/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    client_name: 'hosted-oauth-discovery.test',
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.client
  }
  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.client = info
  }
  tokens(): OAuthTokens | undefined {
    return undefined
  }
  saveTokens(): void {}
  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url
  }
  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier
  }
  codeVerifier(): string {
    return this.verifier
  }
}

// Every URL a published config or listing points at, with and without the
// trailing slash a client may have stored.
const SERVER_URLS: Array<[label: string, serverUrl: string, expectedResource: string]> = [
  ['Supabase function URL', FN_BASE, FN_BASE],
  ['Supabase function URL, trailing slash', `${FN_BASE}/`, FN_BASE],
  ['kensaur.us proxy URL', PUBLIC_BASE, PUBLIC_BASE],
  ['kensaur.us proxy URL, trailing slash', `${PUBLIC_BASE}/`, PUBLIC_BASE],
]

describe('hosted MCP OAuth discovery under the official SDK', () => {
  it.each(SERVER_URLS)('%s: discovery resolves AS metadata with a registration endpoint', async (_l, serverUrl) => {
    const { fetchFn } = fakeNetwork()
    const info = await discoverOAuthServerInfo(serverUrl, { resourceMetadataUrl: challengeFor(serverUrl), fetchFn })
    expect(info.resourceMetadata).toBeDefined()
    expect(info.authorizationServerMetadata?.registration_endpoint).toBe(`${FN_BASE}/oauth/register`)
    expect(info.authorizationServerMetadata?.code_challenge_methods_supported).toContain('S256')
  })

  it.each(SERVER_URLS)('%s: selectResourceURL accepts the advertised resource', async (_l, serverUrl, expected) => {
    const { fetchFn } = fakeNetwork()
    const info = await discoverOAuthServerInfo(serverUrl, { resourceMetadataUrl: challengeFor(serverUrl), fetchFn })
    const resource = await selectResourceURL(serverUrl, new RecordingProvider(), info.resourceMetadata)
    expect(resource?.href.replace(/\/$/, '')).toBe(expected)
  })

  it.each(SERVER_URLS)('%s: auth() registers a client and redirects to authorize', async (_l, serverUrl, expected) => {
    const { fetchFn, requests } = fakeNetwork()
    const provider = new RecordingProvider()
    const result = await auth(provider, { serverUrl, resourceMetadataUrl: challengeFor(serverUrl), fetchFn })
    expect(result).toBe('REDIRECT')
    expect(requests).toContain(`POST ${FN_BASE}/oauth/register`)
    const authorize = provider.authorizationUrl
    expect(authorize?.origin + (authorize?.pathname ?? '')).toBe(`${FN_BASE}/oauth/authorize`)
    expect(authorize?.searchParams.get('client_id')).toBe('fixture-client-id')
    expect(authorize?.searchParams.get('resource')?.replace(/\/$/, '')).toBe(expected)
  })

  it('reaches the AS metadata through the path-appended openid-configuration the Supabase origin can serve', async () => {
    const { fetchFn, requests } = fakeNetwork()
    await discoverOAuthServerInfo(FN_BASE, { resourceMetadataUrl: challengeFor(FN_BASE), fetchFn })
    expect(requests).toContain(`GET ${FN_BASE}/.well-known/openid-configuration`)
  })
})
