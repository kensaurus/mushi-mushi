/**
 * FILE: packages/server/supabase/functions/_shared/github-oidc.ts
 * PURPOSE: Verify a GitHub Actions OIDC token (RS256, Web Crypto only) so a
 *          workflow can call an edge function without holding a long-lived
 *          Supabase credential. Today the only caller is release.yml's
 *          `catalog-sync` job, which asks `sdk-versions-cron` to re-read npm
 *          right after a publish.
 *
 * What a token must prove (SDK_CATALOG_OIDC_POLICY):
 *   - issued by GitHub Actions (`iss`), for this audience (`aud`);
 *   - minted in kensaurus/mushi-mushi, by numeric repository and owner id
 *     (names can be renamed or re-registered, ids cannot);
 *   - by release.yml on master, exactly (`workflow_ref` is compared whole, so
 *     `@refs/heads/master-evil` or another workflow file is rejected);
 *   - on a push or workflow_dispatch, never a pull_request;
 *   - currently valid (`exp` / `nbf` / `iat`, 60 s clock skew).
 *
 * Every structural and claims check runs before any network call, so a junk
 * bearer never makes this function fetch the JWKS.
 */

import { fetchWithTimeout } from './http.ts'

export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
export const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`

/** Audience release.yml requests for its token. Keep in sync with the workflow. */
export const SDK_CATALOG_OIDC_AUDIENCE = 'mushi-sdk-catalog'

/**
 * Numeric ids of kensaurus/mushi-mushi and its owner, from
 * `gh api repos/kensaurus/mushi-mushi --jq '.id, .owner.id'` (2026-10-03).
 * GitHub sends both claims as strings.
 */
export const MUSHI_REPOSITORY_ID = '1212314514'
export const MUSHI_REPOSITORY_OWNER_ID = '26728829'

export const RELEASE_WORKFLOW_REF =
  'kensaurus/mushi-mushi/.github/workflows/release.yml@refs/heads/master'

const CLOCK_SKEW_SEC = 60
const JWKS_TTL_MS = 60 * 60 * 1_000
/** An unknown `kid` forces a refetch at most this often, so junk kids can't hammer GitHub. */
const JWKS_FORCED_REFRESH_MIN_MS = 60 * 1_000
const JWKS_FETCH_TIMEOUT_MS = 8_000

export interface GithubOidcPolicy {
  audience: string
  repositoryId: string
  repositoryOwnerId: string
  workflowRef: string
  events: readonly string[]
}

export const SDK_CATALOG_OIDC_POLICY: GithubOidcPolicy = {
  audience: SDK_CATALOG_OIDC_AUDIENCE,
  repositoryId: MUSHI_REPOSITORY_ID,
  repositoryOwnerId: MUSHI_REPOSITORY_OWNER_ID,
  workflowRef: RELEASE_WORKFLOW_REF,
  events: ['push', 'workflow_dispatch'],
}

export type GithubOidcClaims = Record<string, unknown>

export type GithubOidcResult =
  | { ok: true; claims: GithubOidcClaims }
  | { ok: false; reason: string }

export interface RsaJwk {
  kty: string
  kid?: string
  n?: string
  e?: string
  alg?: string
  use?: string
}

/**
 * Pure claims check: no network, no signature. `nowSec` is Unix seconds.
 * Only ever trust its `ok: true` together with a verified signature.
 */
export function checkGithubOidcClaims(
  claims: unknown,
  nowSec: number,
  policy: GithubOidcPolicy = SDK_CATALOG_OIDC_POLICY,
): GithubOidcResult {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    return { ok: false, reason: 'claims are not an object' }
  }
  const c = claims as GithubOidcClaims

  if (c.iss !== GITHUB_OIDC_ISSUER) return { ok: false, reason: 'wrong issuer' }

  const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!aud.includes(policy.audience)) return { ok: false, reason: 'wrong audience' }

  if (c.repository_id !== policy.repositoryId) return { ok: false, reason: 'wrong repository_id' }
  if (c.repository_owner_id !== policy.repositoryOwnerId) {
    return { ok: false, reason: 'wrong repository_owner_id' }
  }
  if (c.workflow_ref !== policy.workflowRef) return { ok: false, reason: 'wrong workflow_ref' }
  if (typeof c.event_name !== 'string' || !policy.events.includes(c.event_name)) {
    return { ok: false, reason: 'event_name not allowed' }
  }

  if (typeof c.exp !== 'number' || typeof c.iat !== 'number') {
    return { ok: false, reason: 'missing exp or iat' }
  }
  if (nowSec - CLOCK_SKEW_SEC >= c.exp) return { ok: false, reason: 'expired' }
  if (c.iat - CLOCK_SKEW_SEC > nowSec) return { ok: false, reason: 'issued in the future' }
  if (c.nbf !== undefined && (typeof c.nbf !== 'number' || c.nbf - CLOCK_SKEW_SEC > nowSec)) {
    return { ok: false, reason: 'not yet valid' }
  }

  return { ok: true, claims: c }
}

// ── JWT parsing + RS256 ───────────────────────────────────────────────

function base64UrlDecode(str: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('not base64url')
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i)
  return out
}

/** Copy into a fresh ArrayBuffer so Web Crypto's BufferSource typing is satisfied in Deno. */
function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

interface ParsedJwt {
  kid: string
  claims: unknown
  signingInput: ArrayBuffer
  signature: ArrayBuffer
}

function parseRs256Jwt(token: string): ParsedJwt | { error: string } {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return { error: 'malformed token' }
  let header: unknown
  let claims: unknown
  let signature: Uint8Array
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])))
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])))
    signature = base64UrlDecode(parts[2])
  } catch {
    return { error: 'malformed token' }
  }
  const h = (header ?? {}) as { alg?: unknown; kid?: unknown }
  if (h.alg !== 'RS256') return { error: 'alg is not RS256' }
  if (typeof h.kid !== 'string' || h.kid.length === 0) return { error: 'missing kid' }
  return {
    kid: h.kid,
    claims,
    signingInput: ownedArrayBuffer(new TextEncoder().encode(`${parts[0]}.${parts[1]}`)),
    signature: ownedArrayBuffer(signature),
  }
}

async function verifyRs256(parsed: ParsedJwt, jwk: RsaJwk): Promise<boolean> {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return false
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, parsed.signature, parsed.signingInput)
  } catch {
    return false
  }
}

// ── JWKS (module-level cache, keyed by kid) ───────────────────────────

let jwksCache: { byKid: Map<string, RsaJwk>; fetchedAt: number } | null = null

async function fetchGithubJwks(): Promise<Map<string, RsaJwk>> {
  const res = await fetchWithTimeout(
    GITHUB_OIDC_JWKS_URL,
    { headers: { Accept: 'application/json' } },
    JWKS_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(`GitHub OIDC JWKS fetch failed: ${res.status}`)
  const body = (await res.json()) as { keys?: RsaJwk[] }
  const byKid = new Map<string, RsaJwk>()
  for (const k of body.keys ?? []) if (k.kid) byKid.set(k.kid, k)
  return byKid
}

/** Resolve a signing key by kid; an unknown kid refetches once (key rotation). */
async function resolveGithubKey(kid: string): Promise<RsaJwk | null> {
  const now = Date.now()
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    const hit = jwksCache.byKid.get(kid)
    if (hit) return hit
    if (now - jwksCache.fetchedAt < JWKS_FORCED_REFRESH_MIN_MS) return null
  }
  jwksCache = { byKid: await fetchGithubJwks(), fetchedAt: now }
  return jwksCache.byKid.get(kid) ?? null
}

export interface VerifyGithubOidcOptions {
  policy?: GithubOidcPolicy
  /** Unix seconds; defaults to the wall clock. */
  nowSec?: number
  /** Key lookup by kid; defaults to GitHub's JWKS. Tests pass a local key. */
  resolveKey?: (kid: string) => Promise<RsaJwk | null>
}

/** Full verification: structure, claims, then the RS256 signature. */
export async function verifyGithubOidcToken(
  token: string,
  opts: VerifyGithubOidcOptions = {},
): Promise<GithubOidcResult> {
  const parsed = parseRs256Jwt(token)
  if ('error' in parsed) return { ok: false, reason: parsed.error }

  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1_000)
  const claimsCheck = checkGithubOidcClaims(parsed.claims, nowSec, opts.policy)
  if (!claimsCheck.ok) return claimsCheck

  let jwk: RsaJwk | null
  try {
    jwk = await (opts.resolveKey ?? resolveGithubKey)(parsed.kid)
  } catch (err) {
    return { ok: false, reason: `jwks unavailable: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!jwk) return { ok: false, reason: 'unknown kid' }
  if (!(await verifyRs256(parsed, jwk))) return { ok: false, reason: 'bad signature' }
  return claimsCheck
}

// ── Caller authorization for self-authenticating functions ───────────

export type CallerAuthorization =
  | { ok: true; via: 'service_role' }
  | { ok: true; via: 'github_oidc'; claims: GithubOidcClaims }
  | { ok: false; reason: string; response: Response }

export interface AuthorizeCallerDeps extends VerifyGithubOidcOptions {
  /** `requireServiceRoleAuth` from auth.ts: null when the bearer is the service role. */
  serviceRoleCheck: (req: Request) => Response | null
}

/**
 * Accept the service-role bearer (pg_cron) OR a GitHub OIDC token that passes
 * the policy. Anything else is a 401 with a generic message; the precise
 * reason is returned for server-side logging only.
 */
export async function authorizeServiceRoleOrGithubOidc(
  req: Request,
  deps: AuthorizeCallerDeps,
): Promise<CallerAuthorization> {
  if (deps.serviceRoleCheck(req) === null) return { ok: true, via: 'service_role' }

  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const result = token
    ? await verifyGithubOidcToken(token, deps)
    : ({ ok: false, reason: 'no bearer token' } as const)
  if (result.ok) return { ok: true, via: 'github_oidc', claims: result.claims }

  return {
    ok: false,
    reason: result.reason,
    response: new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Requires the service-role bearer or a GitHub OIDC token from the release workflow',
        },
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ),
  }
}
