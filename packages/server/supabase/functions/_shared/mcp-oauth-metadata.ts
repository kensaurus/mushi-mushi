/**
 * RFC 9728 Protected Resource Metadata for hosted MCP (Smithery / MCP OAuth clients).
 * Smithery requires non-empty authorization_servers even for API-key configSchema auth.
 */

function mcpIssuerBase(url: URL): { issuer: string; fnPath: string } {
  const fnPath = url.pathname.split('/.well-known')[0] || '/mcp'
  const supabaseOrigin = Deno.env.get('SUPABASE_URL') ?? url.origin
  const issuer = `${supabaseOrigin.replace(/\/+$/, '')}/functions/v1${fnPath.replace(/\/+$/, '') || '/mcp'}`
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

/** RFC 8414 Authorization Server Metadata (Smithery OAuth probe). */
export function buildOAuthAuthorizationServerMetadata(url: URL): string {
  const { issuer } = mcpIssuerBase(url)
  return JSON.stringify({
    issuer,
    authorization_endpoint: 'https://kensaur.us/mushi-mushi/docs/connect',
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    scopes_supported: ['mcp:read', 'mcp:write'],
    response_types_supported: ['token'],
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
  })
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
  const { issuer } = mcpIssuerBase(url)
  return `${issuer}/.well-known/oauth-protected-resource`
}

/** MCP auth: 401 responses should advertise where to read PRM (Smithery OAuth probe). */
export function bearerWwwAuthenticateResourceMetadata(metadataUrl: string): string {
  return `Bearer resource_metadata="${metadataUrl}"`
}
