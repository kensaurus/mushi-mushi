/**
 * Minimal OAuth authorize + token stubs for Smithery publisher verification.
 *
 * These only short-circuit for Smithery's scanner (smithery.ai redirect URIs
 * and `mushi-scan-` codes / client_credentials grants). Every other OAuth
 * request falls through (`null`) to the REAL authorization-code + PKCE flow
 * served by api/routes/mcp-oauth.ts, which is what `claude mcp login` and
 * other MCP clients use.
 */

const SMITHERY_REDIRECT_PREFIXES = ['https://smithery.run/', 'https://smithery.ai/']

export function isSmitheryRedirectUri(uri: string): boolean {
  return SMITHERY_REDIRECT_PREFIXES.some((p) => uri.startsWith(p))
}

/** RFC 6749 authorization redirect for Smithery publisher scan. */
export function buildSmitheryAuthorizeRedirect(url: URL): Response | null {
  if (!url.pathname.includes('/oauth/authorize')) return null

  const redirectUri = url.searchParams.get('redirect_uri')
  const state = url.searchParams.get('state')
  const responseType = url.searchParams.get('response_type')

  // Not a Smithery scan — fall through to the real authorization flow.
  if (!redirectUri || !isSmitheryRedirectUri(redirectUri)) return null

  if (responseType && responseType !== 'code') {
    return jsonError('unsupported_response_type', 'Only response_type=code is supported for publisher scan', 400)
  }

  const dest = new URL(redirectUri)
  dest.searchParams.set('code', `mushi-scan-${crypto.randomUUID().replace(/-/g, '')}`)
  if (state) dest.searchParams.set('state', state)

  return Response.redirect(dest.toString(), 302)
}

/**
 * Token endpoint stub — ONLY answers the publisher scan (client_credentials,
 * or an authorization_code minted by the authorize stub above, recognizable
 * by its `mushi-scan-` prefix). Real authorization codes (64-char hex from
 * mcp-oauth.ts) return null so the caller proxies to the real token endpoint.
 */
export function buildSmitheryTokenResponse(params: Map<string, string>): Response | null {
  const grantType = params.get('grant_type')
  const code = params.get('code') ?? ''

  const isScan =
    grantType === 'client_credentials' ||
    (grantType === 'authorization_code' && code.startsWith('mushi-scan-'))
  if (!isScan) return null

  return new Response(
    JSON.stringify({
      access_token: 'mushi-smithery-publisher-scan',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp:read mcp:write',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}

function jsonError(error: string, description: string, status: number): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
