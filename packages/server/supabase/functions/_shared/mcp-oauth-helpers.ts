/**
 * FILE: packages/server/supabase/functions/_shared/mcp-oauth-helpers.ts
 * PURPOSE: Pure helpers for the real MCP OAuth 2.1 flow (authorization code +
 *          PKCE) — extracted for unit tests, shared by api/routes/mcp-oauth.ts
 *          and the mcp function's /oauth/* endpoints.
 *
 * Companion to cli-auth-helpers.ts (RFC 8628 device flow). The one-time
 * token-delivery decision reuses `evaluateTokenDelivery` from there — the
 * grace-window semantics are identical, only the column names differ at the
 * call site.
 */

/** RFC 7636 §4.1: code_verifier is 43–128 chars of [A-Za-z0-9-._~]. */
const CODE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/

export function isValidCodeVerifier(verifier: string): boolean {
  return CODE_VERIFIER_RE.test(verifier)
}

/** Base64url (no padding) of SHA-256 — the S256 PKCE transform. */
export async function pkceS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let binary = ''
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Verify a PKCE S256 exchange. Rejects malformed verifiers up front so a
 * garbage value can't reach the hash comparison.
 */
export async function verifyPkceS256(verifier: string, storedChallenge: string): Promise<boolean> {
  if (!isValidCodeVerifier(verifier)) return false
  if (!storedChallenge) return false
  return (await pkceS256Challenge(verifier)) === storedChallenge
}

/**
 * OAuth public-client redirect URI policy:
 *   - https:// for anything remote,
 *   - http:// ONLY for loopback hosts (localhost / 127.0.0.1 / [::1]) — the
 *     RFC 8252 native-app pattern Claude Code and other MCP clients use.
 * Custom app schemes (e.g. cursor://) are also allowed — they can't be
 * intercepted remotely and several IDE MCP clients register them.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return false
  }
  if (parsed.protocol === 'https:') return true
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  }
  // Custom scheme (not http/https/file/javascript-ish). Reject the obviously
  // dangerous pseudo-schemes; accept app-registered ones.
  const banned = new Set(['javascript:', 'data:', 'file:', 'blob:', 'vbscript:'])
  return !banned.has(parsed.protocol)
}

/**
 * Map the requested OAuth scope string to project API key scopes.
 * `mcp:write` implies the full CLI-login key (report:write + both MCP scopes,
 * same set `mushi login` mints); anything else degrades to read-only.
 */
export function mapOAuthScopeToKeyScopes(scope: string | null | undefined): string[] {
  const parts = (scope ?? '').split(/[\s+]+/).filter(Boolean)
  if (parts.includes('mcp:write')) return ['report:write', 'mcp:read', 'mcp:write']
  return ['mcp:read']
}

/** Normalized scope string echoed back in the token response. */
export function grantedScopeString(keyScopes: string[]): string {
  return keyScopes.filter((s) => s.startsWith('mcp:')).join(' ')
}

/**
 * Append OAuth response params (?code=…&state=… or ?error=…) to a redirect
 * URI, preserving any query the client registered.
 */
export function appendRedirectParams(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v)
  }
  return url.toString()
}

/**
 * Read OAuth request params from either application/x-www-form-urlencoded
 * (spec) or JSON (lenient — some clients send JSON). Never throws.
 */
export async function readOAuthParams(req: Request): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const j = (await req.json()) as Record<string, unknown>
      for (const [k, v] of Object.entries(j)) {
        if (typeof v === 'string') out.set(k, v)
      }
      return out
    }
    const text = await req.text()
    for (const part of text.split('&')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      const k = decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' '))
      const v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '))
      if (k) out.set(k, v)
    }
  } catch {
    /* malformed body → empty map; route layer returns invalid_request */
  }
  return out
}
