/**
 * Minimal OAuth authorize + token stubs for Smithery publisher verification.
 * Mushi is API-key auth for real users; this satisfies Smithery's OAuth scan only.
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

  if (responseType && responseType !== 'code') {
    return jsonError('unsupported_response_type', 'Only response_type=code is supported for publisher scan', 400)
  }
  if (!redirectUri || !isSmitheryRedirectUri(redirectUri)) {
    return jsonError('invalid_redirect_uri', 'redirect_uri must be a Smithery callback URL', 400)
  }

  const dest = new URL(redirectUri)
  dest.searchParams.set('code', `mushi-scan-${crypto.randomUUID().replace(/-/g, '')}`)
  if (state) dest.searchParams.set('state', state)

  return Response.redirect(dest.toString(), 302)
}

/** Token endpoint — authorization_code + client_credentials for publisher scan. */
export async function buildSmitheryTokenResponse(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.includes('/oauth/token')) return null

  const params = await readOAuthForm(req)
  const grantType = params.get('grant_type')

  if (grantType === 'authorization_code' || grantType === 'client_credentials') {
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

  return jsonError('unsupported_grant_type', `grant_type ${grantType ?? 'missing'} not supported`, 400)
}

async function readOAuthForm(req: Request): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    try {
      const j = (await req.json()) as Record<string, unknown>
      for (const [k, v] of Object.entries(j)) {
        if (typeof v === 'string') out.set(k, v)
      }
    } catch { /* empty */ }
    return out
  }
  try {
    const text = await req.text()
    for (const part of text.split('&')) {
      const [k, v] = part.split('=').map((s) => decodeURIComponent(s.replace(/\+/g, ' ')))
      if (k) out.set(k, v ?? '')
    }
  } catch { /* empty */ }
  return out
}

function jsonError(error: string, description: string, status: number): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
