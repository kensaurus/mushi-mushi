/**
 * OAuth discovery documents for the hosted MCP function: RFC 9728 Protected
 * Resource Metadata, RFC 8414 Authorization Server Metadata, and the OpenID
 * Connect Discovery document the MCP SDK falls back to.
 *
 * One deployment answers on two public URLs:
 *   - the Supabase function URL  https://<ref>.supabase.co/functions/v1/mcp
 *     (every published client config uses this one), and
 *   - the CloudFront proxy       MCP_PUBLIC_BASE_URL, e.g.
 *     https://kensaur.us/mushi-mushi/hosted-mcp (Smithery, directory listings).
 *
 * The MCP SDK rejects a Protected Resource Metadata `resource` whose origin
 * differs from the URL the client connected to (selectResourceURL →
 * checkResourceAllowed), so every document describes the URL THIS request came
 * in on. Advertising the proxy URL to direct callers used to abort OAuth
 * inside the SDK before client registration.
 */

/** Discovery metadata advertised to every client. */
const SCOPES_SUPPORTED = ['mcp:read', 'mcp:write']
const RESOURCE_DOCUMENTATION = 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp'

function publicBaseFromEnv(): string | null {
  const raw = Deno.env.get('MCP_PUBLIC_BASE_URL')?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

/**
 * Base URL of THIS deployment's mcp function at the raw Supabase origin.
 * Inside the edge runtime `req.url` carries the function name but not the
 * `/functions/v1` gateway prefix, so the public URL is rebuilt from
 * SUPABASE_URL rather than read off the request.
 */
function mcpSupabaseFnBase(url: URL): string {
  const supabaseOrigin = (Deno.env.get('SUPABASE_URL') ?? url.origin).replace(/\/+$/, '')
  return `${supabaseOrigin}/functions/v1/mcp`
}

/**
 * True when the request reached this function through the public CloudFront
 * proxy instead of the Supabase URL. The proxy strips its path prefix and its
 * origin request policy forwards only User-Agent and Referer, so the public
 * URL cannot be read off the request. Two signals remain:
 *   - X-Forwarded-Host naming the proxy's host, once the proxy forwards it;
 *   - X-Amz-Cf-Id or a CloudFront `Via` hop, which CloudFront adds to every
 *     origin request whatever the policy. The Supabase URL is fronted by
 *     Cloudflare, not CloudFront, so a direct request carries neither.
 * This only picks which of our own URLs the discovery documents describe; it
 * is never an auth input, and a caller that forges it misdirects only itself.
 */
export function isPublicProxyRequest(headers: Headers): boolean {
  const publicBase = publicBaseFromEnv()
  if (!publicBase) return false
  let publicHost: string
  try {
    publicHost = new URL(publicBase).host.toLowerCase()
  } catch {
    return false
  }
  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase()
  if (forwardedHost) return forwardedHost === publicHost
  if (headers.has('x-amz-cf-id')) return true
  return /\bcloudfront\b/i.test(headers.get('via') ?? '')
}

/**
 * The protected resource (and OAuth issuer) this request addressed: the proxy
 * base for proxied requests, otherwise the Supabase function URL. Never ends
 * in a slash — the SDK's resource check is a path-prefix match that rejects a
 * configured `/mcp/` for a client that connected to `/mcp`.
 */
function mcpResourceBase(url: URL, headers: Headers): string {
  if (isPublicProxyRequest(headers)) {
    const publicBase = publicBaseFromEnv()
    if (publicBase) return publicBase
  }
  return mcpSupabaseFnBase(url)
}

export function buildOAuthProtectedResourceMetadata(url: URL, headers: Headers): string {
  const base = mcpResourceBase(url, headers)
  // A document fetched from a well-known URL describes the resource the
  // suffix was attached to, which is the slash-less base. A GET on the bare
  // resource URL (Smithery setup) describes the URL it was sent to, so a
  // trailing slash there is echoed back to match what that client stored.
  const bareResourceWithSlash = !url.pathname.includes('/.well-known/') && url.pathname.endsWith('/')
  return JSON.stringify({
    resource: bareResourceWithSlash ? `${base}/` : base,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: SCOPES_SUPPORTED,
    resource_documentation: RESOURCE_DOCUMENTATION,
  })
}

function authorizationServerMetadata(url: URL, headers: Headers): Record<string, unknown> {
  const issuer = mcpResourceBase(url, headers)
  // Operational endpoints stay on the Supabase origin even behind the proxy:
  // the proxy's viewer-request function once 400'd every non-Smithery
  // /oauth/authorize (breaking `claude mcp login` for all real clients), and
  // the Supabase origin is reachable regardless of CDN state. OAuth does not
  // require endpoints to share the issuer's host.
  const fnBase = mcpSupabaseFnBase(url)
  return {
    issuer,
    authorization_endpoint: `${fnBase}/oauth/authorize`,
    token_endpoint: `${fnBase}/oauth/token`,
    registration_endpoint: `${fnBase}/oauth/register`,
    // Strict clients (Claude Code SDK zod schema) require jwks_uri to be a
    // string; without it they discard the whole metadata document and fall
    // back to origin-root default endpoints, which 404 on Supabase
    // ("requested path is invalid"). Access tokens are opaque `mushi_` API
    // keys — not JWTs — so the document at this URL is an empty key set.
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
  }
}

/** RFC 8414 Authorization Server Metadata. */
export function buildOAuthAuthorizationServerMetadata(url: URL, headers: Headers): string {
  return JSON.stringify(authorizationServerMetadata(url, headers))
}

/**
 * OpenID Connect Discovery 1.0 document. For an issuer with a path, the SDK
 * tries the RFC 8414 path-inserted URL first and this path-appended one last;
 * the Supabase origin cannot serve path-inserted well-known URLs, so for
 * direct callers this is the only document discovery can reach. The SDK
 * parses it with its OpenID provider schema, which requires
 * subject_types_supported and id_token_signing_alg_values_supported — their
 * absence threw a ZodError that aborted OAuth before client registration.
 * No ID tokens are ever issued (`openid` is not a supported scope and the only
 * response type is `code`); the values are the ones the OIDC spec mandates.
 */
export function buildOpenIdProviderMetadata(url: URL, headers: Headers): string {
  return JSON.stringify({
    ...authorizationServerMetadata(url, headers),
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
  })
}

/**
 * RFC 7517 JSON Web Key Set. Deliberately empty: the OAuth flow mints opaque
 * project API keys, never signed JWTs, so there are no verification keys to
 * publish. Served only so `jwks_uri` in the AS metadata resolves to valid JSON.
 */
export function buildJwksDocument(): string {
  return JSON.stringify({ keys: [] })
}

/**
 * The discovery document for a well-known GET, or null when `url` is not a
 * discovery path. The edge handler and the SDK-discovery regression test both
 * route through this, so the test exercises the paths production serves.
 */
export function mcpOAuthDiscoveryDocument(url: URL, headers: Headers): string | null {
  const path = url.pathname
  if (path.includes('oauth-protected-resource')) return buildOAuthProtectedResourceMetadata(url, headers)
  // Advertised as jwks_uri in the AS metadata; empty on purpose (see above).
  if (path.includes('jwks.json')) return buildJwksDocument()
  if (path.includes('openid-configuration')) return buildOpenIdProviderMetadata(url, headers)
  if (path.includes('oauth-authorization-server')) return buildOAuthAuthorizationServerMetadata(url, headers)
  return null
}

export const MCP_OAUTH_METADATA_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=3600',
  // The body depends on which public URL the request came through.
  Vary: 'X-Forwarded-Host, X-Amz-Cf-Id, Via',
}

/** RFC 9728 Protected Resource Metadata document URL for the resource this request addressed. */
export function mcpProtectedResourceMetadataUrl(url: URL, headers: Headers): string {
  return `${mcpResourceBase(url, headers)}/.well-known/oauth-protected-resource`
}

/** MCP auth: 401 responses advertise where to read PRM (RFC 9728 §5.1). */
export function bearerWwwAuthenticateResourceMetadata(metadataUrl: string): string {
  return `Bearer resource_metadata="${metadataUrl}"`
}
