/**
 * FILE: packages/server/supabase/functions/_shared/inventory-guards.ts
 *
 * Mushi Mushi v2 — security primitives for the bidirectional-inventory
 * surface. Four small, independently-testable helpers consolidated here
 * because they all share the same trust boundary: a project-scoped admin
 * action that may end up making an outbound HTTP call with the project's
 * stored credentials attached.
 *
 *   1. assertProjectScope(c, projectId, db)
 *        Replaces the inline "if (apiKeyProjectId && apiKeyProjectId !==
 *        projectId) ... else accessibleProjectIds()" block that used to
 *        live in every inventory route. Closes the cross-project
 *        privilege-escalation gap (see CHANGELOG/audit 2026-05-04).
 *
 *   2. assertSafeOutboundUrl(rawUrl, options)
 *        OWASP-aligned SSRF allowlist. Rejects non-https schemes, invalid
 *        hosts, and any IPv4/IPv6 address that resolves into a private,
 *        loopback, or link-local range — including cloud-metadata IPs
 *        (169.254.169.254 etc). Optionally enforces a host allowlist
 *        derived from inventory.app.{base,preview,staging}_url.
 *
 *   3. safeFetch(rawUrl, init, options)
 *        Wrapper around fetch() that uses redirect: 'manual' so we can
 *        re-validate every hop, strips Authorization/Cookie/Proxy-
 *        Authorization on cross-host hops (CVE-2025-21620 — Deno does
 *        NOT do this for us), and applies a hard timeout via
 *        AbortController.
 *
 *   4. RateLimiter (in-memory token bucket)
 *        Per-(project, route) rate gate for expensive operations
 *        (LLM proposals, gate runs, crawler triggers). Cheap because
 *        Edge Function instances are short-lived; a single hot project
 *        can spam at most one bucket per warm container per route.
 *
 * Everything below is pure: no Deno-only imports, no Hono types in the
 * URL/IP helpers, so the same module compiles + tests under Node/Vitest.
 * The Hono-typed `assertProjectScope` is fenced via a `Pick<...>`
 * structural type instead of pulling Hono into the test runner.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { accessibleProjectIds } from '../api/shared.ts'

// ────────────────────────────────────────────────────────────────────────
// 1. Project-scope assertion
// ────────────────────────────────────────────────────────────────────────

/**
 * Minimal Hono Context shape we need for project-scope checks.
 * Declared structurally so this file does not pull in `npm:hono@4` and
 * stays test-friendly.
 */
export interface ScopeContext {
  get(key: 'userId'): string | undefined
  get(key: 'projectId'): string | undefined
  get(key: 'authMethod'): string | undefined
  json(body: unknown, status?: number): Response
}

export type ProjectScopeOk = { ok: true; userId: string; authMethod: 'apiKey' | 'jwt' }
export type ProjectScopeDenied = { ok: false; response: Response }

/**
 * Assert the authenticated caller is allowed to act on `:projectId`.
 *
 * Two paths to "allowed":
 *
 *  - **API-key**: the key carries its own `projectId` (the project it was
 *    minted for). We require an exact match against the route param. This
 *    is the only safe shape for API-key auth — the previous
 *    `accessibleProjectIds(owner)` fallback let any key access every
 *    project the human owner happened to be in (audit C1, 2026-05-04).
 *
 *  - **JWT**: the user is a member of the project (owner / org member /
 *    project_members row). Resolved via `accessibleProjectIds`.
 *
 * Returns either `{ ok: true, ... }` or `{ ok: false, response }` so the
 * caller does `if (!check.ok) return check.response`. Centralising the
 * branch + the two error envelopes keeps the inventory routes uniform
 * and prevents anyone re-introducing the inline check (which had a
 * footgun: forgetting the `else` after the apiKey branch silently
 * granted access).
 */
export async function assertProjectScope(
  c: ScopeContext,
  projectId: string,
  db: SupabaseClient,
): Promise<ProjectScopeOk | ProjectScopeDenied> {
  const userId = c.get('userId')
  if (!userId) {
    return {
      ok: false,
      response: c.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'No userId on context' } },
        401,
      ),
    }
  }
  const apiKeyProjectId = c.get('projectId')
  const authMethod = (c.get('authMethod') ?? 'jwt') as 'apiKey' | 'jwt'

  if (apiKeyProjectId) {
    if (apiKeyProjectId !== projectId) {
      return {
        ok: false,
        response: c.json(
          {
            ok: false,
            error: {
              code: 'PROJECT_MISMATCH',
              message: 'API key is scoped to a different project than :projectId',
            },
          },
          403,
        ),
      }
    }
    return { ok: true, userId, authMethod }
  }

  const allowed = await accessibleProjectIds(db, userId)
  if (!allowed.includes(projectId)) {
    return {
      ok: false,
      response: c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } },
        403,
      ),
    }
  }
  return { ok: true, userId, authMethod }
}

// ────────────────────────────────────────────────────────────────────────
// 2. SSRF allowlist + private-IP guard
// ────────────────────────────────────────────────────────────────────────

export interface SafeUrlOptions {
  /**
   * Optional set of host allowlist entries (`example.com`, `app.example.com`,
   * or `*.example.com`). When provided, the URL host MUST match an entry.
   * Falls through to private-IP guard if not provided.
   */
  allowHosts?: string[]
  /** Allow http:// in addition to https://. Defaults to false. */
  allowHttp?: boolean
  /**
   * Allow private/loopback IPs. Only ever set true for tests that wire up
   * a localhost mock server. Production callers MUST leave this false.
   */
  allowPrivateHosts?: boolean
}

export type SafeUrlResult =
  | { ok: true; url: URL }
  | {
      ok: false
      reason:
        | 'INVALID_URL'
        | 'BAD_SCHEME'
        | 'EMBEDDED_CREDENTIALS'
        | 'HOST_NOT_ALLOWED'
        | 'PRIVATE_HOST'
        | 'BLOCKED_PORT'
    }

const DEFAULT_BLOCKED_PORTS = new Set<number>([
  // Internal infra ports the crawler should never touch even if exposed.
  22, 23, 25, 110, 143, 445, 465, 587, 993, 995,
  3306, 5432, 6379, 9000, 9200, 11211, 27017, 50070,
])

/**
 * Validate a URL string against the SSRF allowlist.
 *
 * Returns `{ ok: false, reason }` on rejection so the caller can pick the
 * right HTTP status / log message. Pure — does no network IO except for
 * `URL` parsing.
 *
 * For allowed hosts, callers should rely on the host-allowlist path
 * (Case 1 in the OWASP cheatsheet); the private-IP fallback is a
 * defence-in-depth gate, not the primary control.
 */
export function assertSafeOutboundUrl(rawUrl: string, options: SafeUrlOptions = {}): SafeUrlResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'INVALID_URL' }
  }

  const allowHttp = options.allowHttp === true
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    return { ok: false, reason: 'BAD_SCHEME' }
  }

  // Reject embedded credentials — they would otherwise be sent to the
  // remote host even if we strip Authorization headers later.
  if (url.username || url.password) {
    return { ok: false, reason: 'EMBEDDED_CREDENTIALS' }
  }

  if (url.port) {
    const portNum = Number(url.port)
    if (!Number.isFinite(portNum) || DEFAULT_BLOCKED_PORTS.has(portNum)) {
      return { ok: false, reason: 'BLOCKED_PORT' }
    }
  }

  if (options.allowHosts && options.allowHosts.length > 0) {
    if (!hostMatchesAllowlist(url.hostname, options.allowHosts)) {
      return { ok: false, reason: 'HOST_NOT_ALLOWED' }
    }
    // Allowlisted host wins — assume the operator vetted it (typical
    // case: inventory.app.base_url is `app.acme.com`, not `127.0.0.1`).
    return { ok: true, url }
  }

  if (!options.allowPrivateHosts && isPrivateOrSpecialHost(url.hostname)) {
    return { ok: false, reason: 'PRIVATE_HOST' }
  }

  return { ok: true, url }
}

/**
 * Match a hostname against an allowlist that may contain wildcard entries
 * like `*.example.com`. Comparison is case-insensitive. A bare entry
 * matches exact hostname only — wildcards must be explicit.
 */
export function hostMatchesAllowlist(host: string, allow: string[]): boolean {
  const target = host.toLowerCase()
  for (const raw of allow) {
    const entry = raw.toLowerCase().trim()
    if (!entry) continue
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1) // ".example.com"
      // `*.example.com` matches `app.example.com` but NOT bare `example.com`.
      if (target.endsWith(suffix) && target.length > suffix.length) return true
    } else if (target === entry) {
      return true
    }
  }
  return false
}

/**
 * Return true when the host parses to a private, loopback, link-local, or
 * otherwise non-routable address — including the cloud-metadata IPs used
 * by AWS/Azure/DigitalOcean/OpenStack (169.254.169.254 / fd00:ec2::254).
 *
 * IPv4 ranges blocked (RFC 1918, link-local, loopback, CGNAT, unspecified):
 *   - 0.0.0.0/8
 *   - 10.0.0.0/8
 *   - 100.64.0.0/10
 *   - 127.0.0.0/8
 *   - 169.254.0.0/16  (link-local — covers AWS/Azure/DigitalOcean metadata)
 *   - 172.16.0.0/12
 *   - 192.168.0.0/16
 *   - 224.0.0.0/4     (multicast)
 *   - 240.0.0.0/4     (reserved)
 *
 * IPv6 ranges blocked:
 *   - ::/128, ::1/128 (unspecified, loopback)
 *   - fc00::/7 (unique local — covers fc00::/8 + fd00::/8)
 *   - fe80::/10 (link-local)
 *   - ::ffff:0:0/96 (IPv4-mapped — re-classify on the embedded v4)
 *   - ff00::/8 (multicast)
 *
 * Hostnames that are NOT IP literals are treated as "not private" — a
 * plain DNS name like `localhost` or `metadata.google.internal` would
 * pass this check, so callers concerned about DNS rebinding MUST use
 * the host allowlist path. We add `localhost` and the GCE metadata DNS
 * name explicitly because they're well-known SSRF traps.
 */
export function isPrivateOrSpecialHost(host: string): boolean {
  const h = host.toLowerCase().trim()
  if (!h) return true

  // Explicit DNS-only landmines.
  if (h === 'localhost' || h === 'localhost.localdomain') return true
  if (h === 'metadata.google.internal' || h === 'metadata') return true

  // IPv6 literals arrive as `[::1]` from URL parsing — strip brackets.
  const v6Candidate = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
  if (v6Candidate.includes(':')) {
    return isPrivateIPv6(v6Candidate)
  }

  if (looksLikeIPv4(h)) {
    return isPrivateIPv4(h)
  }

  // Plain DNS — let it through. Operators control what they put in the
  // crawler_base_url, and the host-allowlist path is the right defence
  // for that case.
  return false
}

function looksLikeIPv4(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s)
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4) return true
  if (parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  if (a === 0) return true                    // 0.0.0.0/8 (unspecified)
  if (a === 10) return true                   // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true                  // 127.0.0.0/8
  if (a === 169 && b === 254) return true     // 169.254.0.0/16 (link-local + cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true     // 192.168.0.0/16
  if (a >= 224) return true                   // 224.0.0.0/4 + 240.0.0.0/4
  return false
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase()
  if (lower === '::' || lower === '::1') return true

  // IPv4-mapped IPv6 (`::ffff:a.b.c.d`). The WHATWG URL serializer canonicalises
  // `[::ffff:127.0.0.1]` into `[::ffff:7f00:1]`, so a regex against the
  // dotted-quad form catches almost nothing in practice. We block the
  // entire `::ffff:` prefix instead: there's no legitimate server-side
  // outbound reason to dial an IPv4-mapped address — anything you could
  // reach that way is reachable via plain IPv4 already, where the v4
  // private-range guard fires.
  if (lower.startsWith('::ffff:')) return true

  // First hextet — fc00::/7 covers fc00::/8 and fd00::/8 (unique local),
  // fe80::/10 covers link-local. Anything starting with ff is multicast.
  const firstHextet = lower.split(':')[0] ?? ''
  if (firstHextet.length === 0) return false
  const head = parseInt(firstHextet, 16)
  if (Number.isFinite(head)) {
    if ((head & 0xfe00) === 0xfc00) return true // fc00::/7
    if ((head & 0xffc0) === 0xfe80) return true // fe80::/10
    if ((head & 0xff00) === 0xff00) return true // ff00::/8 multicast
  }
  return false
}

// ────────────────────────────────────────────────────────────────────────
// 3. safeFetch — SSRF-aware wrapper around fetch()
// ────────────────────────────────────────────────────────────────────────

export interface SafeFetchOptions {
  /** Hard deadline. Defaults to 15s — generous for crawler / synthetic. */
  timeoutMs?: number
  /** Max redirect hops we will follow ourselves. Defaults to 3. */
  maxRedirects?: number
  /** Same shape as assertSafeOutboundUrl — applied to EVERY hop. */
  url: SafeUrlOptions
}

/**
 * Cross-host safe fetch. Validates the initial URL, opens with
 * `redirect: 'manual'`, then follows up to N redirects ourselves —
 * re-validating the target on every hop AND stripping Authorization /
 * Cookie / Proxy-Authorization on origin change.
 *
 * Why we follow redirects manually
 * ────────────────────────────────
 * Two reasons:
 *
 *  1. Per the OWASP cheatsheet, every redirect target must be
 *     re-classified for SSRF. A `redirect: 'follow'` would let
 *     `https://allowlisted.example.com/` 30x to `http://169.254.169.254/`
 *     and the Deno runtime would chase it without our gates firing.
 *
 *  2. CVE-2025-21620 — Deno's auto-follow does NOT strip Authorization
 *     across origins until 2.1.2, and even then it deviates from the
 *     WHATWG spec elsewhere. Doing the hop ourselves lets us implement
 *     the safer behaviour deterministically across runtimes.
 *
 * Returns the final Response. Throws on validation failure with a
 * predictable `Error.message` shape so callers can render a useful
 * `gate_findings` row (e.g. `crawl-blocked: PRIVATE_HOST 169.254.x`).
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit,
  options: SafeFetchOptions,
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const maxRedirects = options.maxRedirects ?? 3

  let currentUrl = rawUrl
  let currentInit: RequestInit = { ...init, redirect: 'manual' }

  // We perform up to (maxRedirects + 1) fetches: 1 initial + maxRedirects
  // follow-ups. If the (maxRedirects + 1)-th hop is ALSO a 3xx, we throw
  // TOO_MANY_REDIRECTS rather than handing back a Location-only response
  // that no caller knows what to do with.
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validation = assertSafeOutboundUrl(currentUrl, options.url)
    if (!validation.ok) {
      throw new Error(`outbound-blocked: ${validation.reason} ${maskUrl(currentUrl)}`)
    }
    const validated = validation.url

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(validated, { ...currentInit, signal: ac.signal })
    } finally {
      clearTimeout(timer)
    }

    const isRedirect =
      res.status >= 300 && res.status < 400 && res.headers.get('Location') !== null

    if (!isRedirect) return res

    if (hop >= maxRedirects) {
      // We've used our hop budget AND the server still wants to redirect
      // — fail closed, the caller gets a useful exception instead of a
      // confusing 3xx response with stripped credentials.
      throw new Error('outbound-blocked: TOO_MANY_REDIRECTS')
    }

    // Re-validate before following — the new target gets the SAME safe-URL
    // check and Authorization is dropped on cross-origin hops.
    const next = new URL(res.headers.get('Location')!, validated).toString()
    const nextUrl = new URL(next)
    const sameOrigin =
      nextUrl.protocol === validated.protocol &&
      nextUrl.hostname === validated.hostname &&
      nextUrl.port === validated.port
    currentInit = stripCredentialsOnCrossHost(currentInit, sameOrigin)
    currentUrl = next
  }
  // Unreachable — the loop body either returns or throws on every path.
  throw new Error('outbound-blocked: TOO_MANY_REDIRECTS')
}

/**
 * Drop Authorization / Cookie / Proxy-Authorization on cross-origin hops.
 * No-op for same-origin redirects so behaviour matches the WHATWG fetch
 * spec (and what Deno >= 2.1.2 now does natively for `redirect: 'follow'`).
 */
export function stripCredentialsOnCrossHost(init: RequestInit, sameOrigin: boolean): RequestInit {
  if (sameOrigin) return init
  const headers = new Headers(init.headers ?? {})
  headers.delete('Authorization')
  headers.delete('Cookie')
  headers.delete('Proxy-Authorization')
  return { ...init, headers }
}

/** Mask query strings + path tail so the failure message doesn't leak any token-in-URL pattern. */
function maskUrl(u: string): string {
  try {
    const url = new URL(u)
    return `${url.protocol}//${url.hostname}${url.pathname.length > 12 ? url.pathname.slice(0, 12) + '…' : url.pathname}`
  } catch {
    return '<invalid>'
  }
}

// ────────────────────────────────────────────────────────────────────────
// 4. Per-(project, route) rate limiter — in-memory token bucket
// ────────────────────────────────────────────────────────────────────────

export interface RateLimitVerdict {
  allowed: boolean
  retryAfterSeconds: number
  remainingTokens: number
}

interface BucketState {
  tokens: number
  lastRefillMs: number
}

/**
 * Token-bucket rate limiter keyed by an arbitrary string (typically
 * `${projectId}:${routeName}`). Pure, in-memory, no external deps.
 *
 * Edge-Function deployments
 * ─────────────────────────
 * Each warm container holds its own bucket map — there is no shared
 * state across instances. For low-frequency expensive operations (LLM
 * proposals, gate runs, crawler triggers) this is sufficient: a single
 * abusive client gets capped per-instance, and the worst-case "fan out
 * to 4 warm instances and fire 4× the limit" is still 4× cheaper than
 * an unbounded loop. If we ever need cross-instance accuracy, swap the
 * Map for an Upstash REST client behind the same interface.
 *
 * Defaults match the audit recommendation: 5 req/min for /propose
 * (Sonnet 4.6 with 8K output × 3 retries = ~$0.30 per call) and 12 / min
 * for /reconcile + /gates/run (cheap themselves but they enqueue work).
 */
export class RateLimiter {
  private readonly buckets = new Map<string, BucketState>()
  private readonly capacity: number
  private readonly refillPerSecond: number

  constructor(opts: { tokensPerMinute: number; burst?: number }) {
    this.refillPerSecond = opts.tokensPerMinute / 60
    this.capacity = opts.burst ?? opts.tokensPerMinute
  }

  /**
   * Try to consume one token from `key`'s bucket. If the bucket is dry,
   * returns `{ allowed: false, retryAfterSeconds }` so callers can shape
   * a 429 response with a Retry-After header.
   */
  consume(key: string, now: number = Date.now()): RateLimitVerdict {
    const existing = this.buckets.get(key)
    const last = existing?.lastRefillMs ?? now
    const dt = Math.max(0, (now - last) / 1000)
    const refilled = Math.min(this.capacity, (existing?.tokens ?? this.capacity) + dt * this.refillPerSecond)

    if (refilled >= 1) {
      const remaining = refilled - 1
      this.buckets.set(key, { tokens: remaining, lastRefillMs: now })
      return { allowed: true, retryAfterSeconds: 0, remainingTokens: Math.floor(remaining) }
    }

    // Dry: persist the refilled fractional state so successive calls
    // don't reset the wait. Retry-after = (1 - tokens) / refillPerSecond.
    this.buckets.set(key, { tokens: refilled, lastRefillMs: now })
    const wait = (1 - refilled) / this.refillPerSecond
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(wait)),
      remainingTokens: 0,
    }
  }

  /** Test-only: clear all buckets so each test starts from a clean slate. */
  reset(): void {
    this.buckets.clear()
  }

  /** Test-only: peek at internal state without mutating it. */
  __debugTokens(key: string): number | undefined {
    return this.buckets.get(key)?.tokens
  }
}

/**
 * Module-level limiters for the three expensive inventory endpoints.
 * Exported so the routes share a single instance per warm container
 * (per-route singletons are what makes the bucket actually limit
 * across calls — instantiating a new limiter inside the handler would
 * reset every request).
 *
 * Tweakable per-environment via env vars so we can dial down in dev
 * without code changes.
 */
function envInt(name: string, fallback: number): number {
  // deno-lint-ignore no-explicit-any -- Deno typing is added by callers.
  const env = (globalThis as any).Deno?.env
  const raw = env?.get?.(name)
  if (typeof raw !== 'string') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const proposeRateLimiter = new RateLimiter({
  tokensPerMinute: envInt('MUSHI_INVENTORY_PROPOSE_RPM', 5),
  burst: envInt('MUSHI_INVENTORY_PROPOSE_BURST', 5),
})

export const reconcileRateLimiter = new RateLimiter({
  tokensPerMinute: envInt('MUSHI_INVENTORY_RECONCILE_RPM', 12),
  burst: envInt('MUSHI_INVENTORY_RECONCILE_BURST', 12),
})

export const gatesRunRateLimiter = new RateLimiter({
  tokensPerMinute: envInt('MUSHI_INVENTORY_GATES_RPM', 12),
  burst: envInt('MUSHI_INVENTORY_GATES_BURST', 12),
})

// ────────────────────────────────────────────────────────────────────────
// 5. Inventory app-host allowlist helper
// ────────────────────────────────────────────────────────────────────────

/**
 * Build the SafeUrlOptions.allowHosts list from an inventory.app shape.
 * The crawler + synthetic monitor are only ever supposed to talk to the
 * customer's own app, so we lock the host set to whatever the YAML
 * declares (base_url, preview_url, staging_url).
 *
 * If the inventory has no app_url at all we fall back to the private-IP
 * blocklist alone — the operator gets a clear "host not allowlisted"
 * error from `assertSafeOutboundUrl` if they configure a base_url not
 * present in the inventory, which is the right safety default.
 */
export function inventoryAppAllowHosts(app: {
  base_url?: string | null
  preview_url?: string | null
  staging_url?: string | null
}): string[] {
  const hosts = new Set<string>()
  for (const u of [app.base_url, app.preview_url, app.staging_url]) {
    if (!u) continue
    try {
      const parsed = new URL(u)
      hosts.add(parsed.hostname.toLowerCase())
    } catch {
      // Ignore malformed entries — the inventory schema enforces URL
      // shape so this only fires on deeply hand-edited data.
    }
  }
  return Array.from(hosts)
}
