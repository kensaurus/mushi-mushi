import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  appendRedirectParams,
  grantedScopeString,
  isAllowedRedirectUri,
  isValidCodeVerifier,
  mapOAuthScopeToKeyScopes,
  pkceS256Challenge,
  readOAuthParams,
  verifyPkceS256,
} from '../../_shared/mcp-oauth-helpers.ts'

// ── PKCE ──────────────────────────────────────────────────────────────────────

// RFC 7636 Appendix B known-answer test vector.
const RFC7636_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const RFC7636_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

Deno.test('pkceS256Challenge matches the RFC 7636 test vector', async () => {
  assertEquals(await pkceS256Challenge(RFC7636_VERIFIER), RFC7636_CHALLENGE)
})

Deno.test('verifyPkceS256 accepts the matching verifier', async () => {
  assert(await verifyPkceS256(RFC7636_VERIFIER, RFC7636_CHALLENGE))
})

Deno.test('verifyPkceS256 rejects a wrong verifier', async () => {
  assertFalse(await verifyPkceS256('a'.repeat(43), RFC7636_CHALLENGE))
})

Deno.test('verifyPkceS256 rejects an empty stored challenge', async () => {
  assertFalse(await verifyPkceS256(RFC7636_VERIFIER, ''))
})

Deno.test('isValidCodeVerifier enforces RFC 7636 length and charset', () => {
  assert(isValidCodeVerifier('a'.repeat(43)))
  assert(isValidCodeVerifier('A1-._~'.repeat(10) + 'abc'))
  assertFalse(isValidCodeVerifier('short'))
  assertFalse(isValidCodeVerifier('a'.repeat(129)))
  assertFalse(isValidCodeVerifier('has spaces'.padEnd(50, 'x')))
  assertFalse(isValidCodeVerifier('has+plus'.padEnd(50, 'x')))
})

// ── Redirect URI policy ───────────────────────────────────────────────────────

Deno.test('isAllowedRedirectUri allows https and loopback http', () => {
  assert(isAllowedRedirectUri('https://smithery.ai/callback'))
  assert(isAllowedRedirectUri('http://localhost:33418/callback'))
  assert(isAllowedRedirectUri('http://127.0.0.1:8976/oauth/redirect'))
  assert(isAllowedRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback'))
})

Deno.test('isAllowedRedirectUri rejects remote http and dangerous schemes', () => {
  assertFalse(isAllowedRedirectUri('http://evil.example.com/callback'))
  assertFalse(isAllowedRedirectUri('javascript:alert(1)'))
  assertFalse(isAllowedRedirectUri('data:text/html,x'))
  assertFalse(isAllowedRedirectUri('file:///etc/passwd'))
  assertFalse(isAllowedRedirectUri('not a url'))
})

// ── Scope mapping ─────────────────────────────────────────────────────────────

Deno.test('mapOAuthScopeToKeyScopes grants the full CLI-login set for mcp:write', () => {
  assertEquals(mapOAuthScopeToKeyScopes('mcp:read mcp:write'), ['report:write', 'mcp:read', 'mcp:write'])
})

Deno.test('mapOAuthScopeToKeyScopes degrades to read-only otherwise', () => {
  assertEquals(mapOAuthScopeToKeyScopes('mcp:read'), ['mcp:read'])
  assertEquals(mapOAuthScopeToKeyScopes(''), ['mcp:read'])
  assertEquals(mapOAuthScopeToKeyScopes(null), ['mcp:read'])
  assertEquals(mapOAuthScopeToKeyScopes('something:else'), ['mcp:read'])
})

Deno.test('grantedScopeString echoes only mcp scopes', () => {
  assertEquals(grantedScopeString(['report:write', 'mcp:read', 'mcp:write']), 'mcp:read mcp:write')
  assertEquals(grantedScopeString(['mcp:read']), 'mcp:read')
})

// ── Redirect param handling ───────────────────────────────────────────────────

Deno.test('appendRedirectParams preserves existing query and skips empty values', () => {
  const out = appendRedirectParams('http://localhost:1234/cb?a=1', {
    code: 'abc',
    state: 'xyz',
    error: null,
  })
  const url = new URL(out)
  assertEquals(url.searchParams.get('a'), '1')
  assertEquals(url.searchParams.get('code'), 'abc')
  assertEquals(url.searchParams.get('state'), 'xyz')
  assertFalse(url.searchParams.has('error'))
})

// ── Body parsing ──────────────────────────────────────────────────────────────

Deno.test('readOAuthParams parses form-encoded bodies', async () => {
  const req = new Request('http://x/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=authorization_code&code=abc%2Bdef&code_verifier=v',
  })
  const params = await readOAuthParams(req)
  assertEquals(params.get('grant_type'), 'authorization_code')
  assertEquals(params.get('code'), 'abc+def')
  assertEquals(params.get('code_verifier'), 'v')
})

Deno.test('readOAuthParams parses JSON bodies and ignores non-strings', async () => {
  const req = new Request('http://x/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', nested: { a: 1 }, n: 5 }),
  })
  const params = await readOAuthParams(req)
  assertEquals(params.get('grant_type'), 'authorization_code')
  assertFalse(params.has('nested'))
  assertFalse(params.has('n'))
})

Deno.test('readOAuthParams returns an empty map on malformed JSON', async () => {
  const req = new Request('http://x/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  })
  const params = await readOAuthParams(req)
  assertEquals(params.size, 0)
})
