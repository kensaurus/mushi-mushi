/**
 * RFC 9728 Protected Resource Metadata for hosted MCP (Smithery / MCP OAuth clients).
 * Smithery requires non-empty authorization_servers even for API-key configSchema auth.
 *
 * When `MCP_PUBLIC_BASE_URL` is set (e.g. https://kensaur.us/mushi-mushi/hosted-mcp),
 * OAuth discovery URLs match the CloudFront proxy — not the raw Supabase origin.
 */

function normalizeMcpFnPath(pathname: string): string {
  let path = pathname.split('/.well-known')[0] || '/functions/v1/mcp'
  path = path.replace(/\/index\.html$/i, '')
  const match = path.match(/(.*\/functions\/v1\/mcp)/i)
  return match ? match[1] : '/functions/v1/mcp'
}

function publicBaseFromEnv(): string | null {
  const raw = Deno.env.get('MCP_PUBLIC_BASE_URL')?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

function mcpIssuerBase(url: URL): { issuer: string; fnPath: string } {
  const publicBase = publicBaseFromEnv()
  if (publicBase) {
    return { issuer: publicBase, fnPath: '/mcp' }
  }
  const fnPath = normalizeMcpFnPath(url.pathname)
  const supabaseOrigin = (Deno.env.get('SUPABASE_URL') ?? url.origin).replace(/\/+$/, '')
  const issuer = `${supabaseOrigin}/functions/v1${fnPath.replace(/\/+$/, '') || '/mcp'}`
  return { issuer, fnPath }
}

export function buildOAuthProtectedResourceMetadata(url: URL): string {
  const { issuer } = mcpIssuerBase(url)
  // Smithery setup stores upstream with trailing slash — keep resource aligned.
  const resource = url.pathname.endsWith('/') ? `${issuer}/` : issuer
  return JSON.stringify({
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
    resource_documentation: 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp',
  })
}

/**
 * Base URL of THIS deployment's mcp function at the raw Supabase origin.
 * Operational OAuth endpoints are advertised here rather than on the
 * CloudFront proxy: the proxy's viewer-request function once 400'd every
 * non-Smithery /oauth/authorize (breaking `claude mcp login` for all real
 * clients), and the Supabase origin is reachable regardless of CDN state.
 * The issuer/PRM resource stay on MCP_PUBLIC_BASE_URL for Smithery
 * discovery alignment — OAuth does not require endpoints to share the
 * issuer's host.
 */
function mcpSupabaseFnBase(url: URL): string {
  const supabaseOrigin = (Deno.env.get('SUPABASE_URL') ?? url.origin).replace(/\/+$/, '')
  return `${supabaseOrigin}/functions/v1/mcp`
}

/** RFC 8414 Authorization Server Metadata (Smithery OAuth probe). */
export function buildOAuthAuthorizationServerMetadata(url: URL): string {
  const { issuer } = mcpIssuerBase(url)
  const fnBase = mcpSupabaseFnBase(url)
  return JSON.stringify({
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
    scopes_supported: ['mcp:read', 'mcp:write'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
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

export const MCP_OAUTH_METADATA_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=3600',
}

export const MCP_OAUTH_AS_METADATA_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=3600',
}

/** RFC 9728 Protected Resource Metadata document URL for this MCP deployment. */
export function mcpProtectedResourceMetadataUrl(url: URL): string {
  const publicBase = publicBaseFromEnv()
  if (publicBase) {
    return `${publicBase}/.well-known/oauth-protected-resource`
  }
  const { issuer } = mcpIssuerBase(url)
  return `${issuer}/.well-known/oauth-protected-resource`
}

/** MCP auth: 401 responses should advertise where to read PRM (Smithery OAuth probe). */
export function bearerWwwAuthenticateResourceMetadata(metadataUrl: string): string {
  return `Bearer resource_metadata="${metadataUrl}"`
}
