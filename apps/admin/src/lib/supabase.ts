/**
 * FILE: apps/admin/src/lib/supabase.ts
 * PURPOSE: Supabase client initialization with cloud fallback.
 *          When no VITE_SUPABASE_URL is set, falls back to Mushi Mushi Cloud
 *          so the app works out-of-the-box without any .env setup.
 */

import { createClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/react'
import type { ZodType } from 'zod'
import { debugLog, debugWarn, debugError } from './debug'
import { RESOLVED_SUPABASE_URL, RESOLVED_SUPABASE_ANON_KEY, RESOLVED_API_URL } from './env'
import {
  getActiveProjectIdForApi,
  isValidProjectId,
} from './activeProject'
import { getActiveOrgIdSnapshot, isValidOrgId } from './activeOrg'
import { coerceApiResult, type ApiResult } from './apiEnvelope'

const authOptions = {
  // Web defaults are true today, but making them explicit documents the
  // session-continuity contract for the admin console: reloads restore the
  // existing session, tokens refresh in the background, and recovery links
  // are detected from the URL fragment/query payload.
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  // Supabase passkeys are experimental in current supabase-js. Keeping this
  // opt-in beside the client makes the passkey UI a progressive enhancement:
  // older builds simply report that passkeys are unavailable.
  experimental: { passkey: true },
}

export const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SUPABASE_ANON_KEY, {
  auth: authOptions,
})

const API_BASE = RESOLVED_API_URL

let _cachedToken: string | null = null
let _tokenExpiresAt = 0

async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const now = Date.now() / 1000
  if (!forceRefresh && _cachedToken && _tokenExpiresAt > now + 30) return _cachedToken

  const { data } = await supabase.auth.getSession()
  let session = data.session
  if (!session) {
    _cachedToken = null
    return null
  }

  const expiresAt = session.expires_at ?? 0
  if (forceRefresh || expiresAt <= now + 30) {
    const { data: refreshed, error } = await supabase.auth.refreshSession()
    if (!error && refreshed.session) {
      session = refreshed.session
    } else if (expiresAt <= now) {
      _cachedToken = null
      return null
    }
  }

  _cachedToken = session.access_token
  _tokenExpiresAt = session.expires_at ?? 0
  return _cachedToken
}

supabase.auth.onAuthStateChange((event, session) => {
  _cachedToken = session?.access_token ?? null
  _tokenExpiresAt = session?.expires_at ?? 0
  debugLog('auth', `State changed: ${event}`, {
    email: session?.user?.email,
    expiresAt: session?.expires_at,
  })
})

export type { ApiResult } from './apiEnvelope'

// ─── Request dedup + micro-cache ────────────────────────────────────────────
//
// The admin console mounts ~17 components that each call `useSetupStatus()`
// (DashboardPage, FixesPage, NextBestAction, QuickstartMegaCta, FirstRunTour,
// SetupNudge, ProjectSwitcher, GettingStartedEmpty, etc). Without dedup,
// every page load fires GET /v1/admin/setup 12+ times in parallel — wasted
// bandwidth, wasted Supabase function invocations, and duplicated render-time
// loading flickers. Same problem with /v1/admin/dashboard and /v1/admin/billing.
//
// Strategy:
//  1. Coalesce identical concurrent requests onto a single in-flight promise.
//  2. Hold the resolved value for COALESCE_TTL_MS so a component mounting
//     50ms after another doesn't trigger a second network round-trip.
//  3. Only dedupe IDEMPOTENT verbs (GET / HEAD) — never POST / PATCH / DELETE,
//     because those are intentional state mutations and must always run.
//  4. Bypass dedup whenever an explicit `cache: 'no-store'` is passed, so
//     `reload()` paths can force a fresh fetch.
//  5. Bound the `recent` map at MAX_CACHE_ENTRIES with FIFO eviction so a
//     long-running session that hits many distinct query-param permutations
//     can't grow the map without bound.
const COALESCE_TTL_MS = 200
const MAX_CACHE_ENTRIES = 64
const inFlight = new Map<string, Promise<ApiResult<unknown>>>()
const recent = new Map<string, { value: ApiResult<unknown>; expiresAt: number }>()

function rememberRecent(key: string, value: ApiResult<unknown>): void {
  recent.set(key, { value, expiresAt: Date.now() + COALESCE_TTL_MS })
  if (recent.size > MAX_CACHE_ENTRIES) {
    // Map iteration order is insertion order, so the first key is the oldest.
    const oldest = recent.keys().next().value
    if (oldest !== undefined) recent.delete(oldest)
  }
}

function coalesceKey(
  method: string,
  path: string,
  body: BodyInit | null | undefined,
): string | null {
  if (method !== 'GET' && method !== 'HEAD') return null
  if (body != null) return null
  return `${method}:${getActiveOrgIdSnapshot() ?? 'no-org'}:${getActiveProjectIdForApi() ?? 'no-project'}:${path}`
}

export function invalidateApiCache(pathPrefix?: string): void {
  if (!pathPrefix) {
    inFlight.clear()
    recent.clear()
    return
  }
  for (const key of inFlight.keys()) if (key.includes(pathPrefix)) inFlight.delete(key)
  for (const key of recent.keys()) if (key.includes(pathPrefix)) recent.delete(key)
}

/**
 * FE-API-1 (audit 2026-04-21): optional runtime validation of the response
 * payload against a Zod schema. Without this, a backend contract drift (field
 * renamed, nullable suddenly null) silently produces `undefined` renders or
 * cryptic `Cannot read properties of undefined` deep inside a table row. With
 * a schema, the failure surfaces at the fetch boundary with the actual parse
 * error, breadcrumbed into Sentry so we see the mismatch the first time any
 * user hits it. Passing `schema` is opt-in per call site so we can roll out
 * validation incrementally on the top-10 endpoints first.
 */
export interface ApiFetchOptions<T> extends RequestInit {
  schema?: ZodType<T>
  /** When set, sends Idempotency-Key on POST/PATCH/DELETE mutations. */
  idempotencyKey?: string
  /**
   * Tenant scope headers sent to the API:
   * - `enumeration`: org only (project list / setup / switcher)
   * - `project`: org + active project (default)
   * - `none`: no tenant context headers
   */
  scope?: 'enumeration' | 'project' | 'none'
}

export async function apiFetch<T>(
  path: string,
  options?: ApiFetchOptions<T>,
): Promise<ApiResult<T>> {
  const method = (options?.method ?? 'GET').toUpperCase()
  const cacheKey = options?.cache === 'no-store' ? null : coalesceKey(method, path, options?.body)

  if (cacheKey) {
    const cached = recent.get(cacheKey)
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.value as ApiResult<T>
      }
      // Stale — drop it eagerly so the map stays trimmed even when callers
      // never re-request a path that was hit once.
      recent.delete(cacheKey)
    }
    const pending = inFlight.get(cacheKey) as Promise<ApiResult<T>> | undefined
    if (pending) return pending
  }

  const promise = doFetch<T>(path, options, method)
  if (cacheKey) {
    inFlight.set(cacheKey, promise as Promise<ApiResult<unknown>>)
    promise
      .then((value) => {
        rememberRecent(cacheKey, value as ApiResult<unknown>)
      })
      .catch(() => {})
      .finally(() => {
        inFlight.delete(cacheKey)
      })
  }
  return promise
}

/** POST/PATCH/DELETE helper — auto-generates Idempotency-Key unless provided. */
export async function apiFetchMutate<T>(
  path: string,
  options?: ApiFetchOptions<T>,
): Promise<ApiResult<T>> {
  const method = (options?.method ?? 'POST').toUpperCase()
  const idempotencyKey = options?.idempotencyKey ?? crypto.randomUUID()
  return apiFetch<T>(path, { ...options, method, idempotencyKey })
}

async function doFetch<T>(
  path: string,
  options: ApiFetchOptions<T> | undefined,
  method: string,
): Promise<ApiResult<T>> {
  const url = `${API_BASE}${path}`
  const t0 = performance.now()

  debugLog('api', `${method} ${path}`)

  // Mint outside the try so network-failure catch can still attach it.
  const requestId =
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `req-${Date.now()}`
    ).slice(0, 12)

  try {
    const scope = options?.scope ?? 'project'
    const storedProjectId = scope === 'project' ? getActiveProjectIdForApi() : null
    const storedOrgId = scope === 'none' ? null : getActiveOrgIdSnapshot()
    const activeProjectId =
      storedProjectId && isValidProjectId(storedProjectId) ? storedProjectId : null
    const activeOrgId = storedOrgId && isValidOrgId(storedOrgId) ? storedOrgId : null

    let res: Response | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getAccessToken(attempt > 0)
      res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(activeProjectId ? { 'X-Mushi-Project-Id': activeProjectId } : {}),
          // Also stamp legacy `x-org-id` for any remote handlers that still
          // read that name (portfolio briefly did before getOrgIdFromContext).
          ...(activeOrgId
            ? { 'X-Mushi-Org-Id': activeOrgId, 'x-org-id': activeOrgId }
            : {}),
          ...options?.headers,
        },
      })
      if (res.status !== 401 || attempt > 0) break
      const peek = await res.clone().text()
      if (!peek.includes('INVALID_TOKEN') && !peek.includes('MISSING_AUTH')) break
      debugWarn('api', `${method} ${path} → 401, refreshing session and retrying once`)
    }

    if (!res) {
      return {
        ok: false,
        requestId,
        error: { code: 'NETWORK_ERROR', message: 'Request failed', requestId },
      }
    }

    const ms = Math.round(performance.now() - t0)
    const responseRequestId =
      res.headers.get('X-Request-Id')?.trim() ||
      res.headers.get('x-request-id')?.trim() ||
      requestId

    const attachRequestId = <TResult>(result: ApiResult<TResult>): ApiResult<TResult> => ({
      ...result,
      requestId: responseRequestId,
      error: result.error
        ? { ...result.error, requestId: result.error.requestId ?? responseRequestId }
        : result.error,
    })

    if (!res.ok) {
      const body = await res.text()
      debugWarn('api', `${method} ${path} → ${res.status} (${ms}ms)`, { body: body.slice(0, 200) })
      // Entitlement gate (Phase 1d, 2026-04-27): the server's
      // `requireFeature` middleware returns 402 + `code: 'feature_not_in_plan'`
      // when a Hobby user tries to hit a paid endpoint (SSO, BYOK, plugins,
      // intelligence). We dispatch a window event so a single root-mounted
      // <UpgradePromptHost> can render the modal once, instead of every
      // calling site having to know the upgrade UX. The original error
      // body still propagates to the caller via the JSON.parse below so
      // callers that want their own inline UI (the gated *pages* render
      // <UpgradePrompt> in-place anyway) keep working.
      if (res.status === 402) {
        try {
          const parsed = JSON.parse(body) as {
            error?: {
              code?: string
              flag?: string
              current_plan?: string
              upgrade_to?: { id: string; display_name: string; monthly_price_usd: number } | null
            }
          }
          if (parsed?.error?.code === 'feature_not_in_plan' && typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('mushi:entitlement-blocked', {
                detail: {
                  flag: parsed.error.flag,
                  currentPlan: parsed.error.current_plan,
                  upgradeTo: parsed.error.upgrade_to,
                  method,
                  path,
                },
              }),
            )
          }
        } catch {
          /* malformed 402 body — fall through to generic handling */
        }
      }
      // Telemetry: every non-2xx becomes a Sentry breadcrumb so we get a
      // request log for free in any Sentry event captured later in the same
      // session. 5xx is escalated to a captureMessage because server errors
      // are bugs we want to know about even when the user never crashes the
      // UI. 4xx (auth, validation) is intentionally NOT escalated to keep
      // the issue list signal-rich; auth flows trip 401 by design, BUT
      // FE-API-5 samples 4xx at a low rate so we can spot contract drift
      // (400 validation errors that shouldn't happen) without drowning in
      // expected 401s during login.
      Sentry.addBreadcrumb({
        category: 'api',
        type: 'http',
        level: res.status >= 500 ? 'error' : 'warning',
        data: {
          method,
          url: path,
          status_code: res.status,
          duration_ms: ms,
          request_id: responseRequestId,
        },
        message: `${method} ${path} → ${res.status}`,
      })
      if (res.status >= 500) {
        Sentry.captureMessage(`API ${res.status} ${method} ${path}`, {
          level: 'error',
          // FE-API-4: fingerprint by path+status so "POST /reports 503"
          // events group as ONE issue, not one-per-user. Without this,
          // every reporter session that hit the same degraded endpoint
          // opened a fresh Sentry issue and the noise drowned the signal.
          fingerprint: ['apiFetch', method, path, String(res.status)],
          tags: {
            source: 'apiFetch',
            http_status: String(res.status),
            api_path: path,
            request_id: responseRequestId,
          },
          contexts: {
            http: {
              method,
              url: path,
              status_code: res.status,
              duration_ms: ms,
              request_id: responseRequestId,
            },
          },
          extra: { response_snippet: body.slice(0, 500), request_id: responseRequestId },
        })
      } else if (res.status === 400 || res.status === 422) {
        // FE-API-5: sample 400/422 at 5% — these are contract-drift signals
        // (server changed a required field, frontend sent the old shape).
        // Normal auth 401/403 stays off the radar.
        if (Math.random() < 0.05) {
          Sentry.captureMessage(`API ${res.status} ${method} ${path} (sampled)`, {
            level: 'warning',
            fingerprint: ['apiFetch', method, path, String(res.status)],
            tags: {
              source: 'apiFetch',
              http_status: String(res.status),
              api_path: path,
              sampled: 'true',
              request_id: responseRequestId,
            },
            contexts: {
              http: {
                method,
                url: path,
                status_code: res.status,
                duration_ms: ms,
                request_id: responseRequestId,
              },
            },
            extra: { response_snippet: body.slice(0, 500), request_id: responseRequestId },
          })
        }
      }
      try {
        const coerced = coerceApiResult<T>(JSON.parse(body))
        // A non-2xx body without an explicit error envelope (e.g. a proxy's
        // `{ "message": "..." }`) must never coerce into a success.
        if (coerced.ok) {
          return attachRequestId({
            ok: false,
            error: { code: 'HTTP_ERROR', message: `${res.status}: ${body.slice(0, 200)}` },
          })
        }
        return attachRequestId(coerced)
      } catch {
        return attachRequestId({
          ok: false,
          error: { code: 'HTTP_ERROR', message: `${res.status}: ${body.slice(0, 200)}` },
        })
      }
    }

    const result = coerceApiResult<T>(await res.json())
    debugLog('api', `${method} ${path} → ${res.status} (${ms}ms)`)

    // FE-API-1: opt-in Zod validation. We only validate the `data` slice —
    // the ApiResult envelope itself (`ok`, `error`) is stable across routes.
    // Validation failure is reported via Sentry (fingerprinted) and degrades
    // to returning an error result so the UI can render a fallback rather
    // than exploding mid-render.
    if (options?.schema && result.ok && result.data != null) {
      const parsed = options.schema.safeParse(result.data)
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]
        const issueSummary = firstIssue
          ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
          : 'validation failed'
        Sentry.captureMessage(`API response failed Zod validation ${method} ${path}`, {
          level: 'error',
          fingerprint: ['apiFetch-zod', method, path, firstIssue?.code ?? 'unknown'],
          tags: {
            source: 'apiFetch',
            api_path: path,
            validation: 'zod',
            request_id: responseRequestId,
          },
          contexts: {
            http: {
              method,
              url: path,
              status_code: res.status,
              duration_ms: ms,
              request_id: responseRequestId,
            },
          },
          extra: { issues: parsed.error.issues.slice(0, 5), request_id: responseRequestId },
        })
        debugWarn('api', `Zod validation failed ${method} ${path}: ${issueSummary}`)
        return attachRequestId({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: issueSummary },
        })
      }
      return attachRequestId({ ok: true, data: parsed.data })
    }

    return attachRequestId(result)
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    debugError('api', `${method} ${path} → NETWORK_ERROR (${ms}ms)`, { error: String(err) })
    // Network-level errors (DNS, TLS, offline, CORS) are real reachability
    // bugs — capture them. We strip the URL to the path so we don't leak
    // the Supabase project ref into Sentry's free-text fields.
    Sentry.addBreadcrumb({
      category: 'api',
      type: 'http',
      level: 'error',
      data: {
        method,
        url: path,
        duration_ms: ms,
        error: String(err).slice(0, 200),
        request_id: requestId,
      },
      message: `${method} ${path} → NETWORK_ERROR`,
    })
    if (err instanceof Error && err.name !== 'AbortError') {
      Sentry.captureException(err, {
        tags: {
          source: 'apiFetch',
          http_status: 'network_error',
          api_path: path,
          request_id: requestId,
        },
        contexts: { http: { method, url: path, duration_ms: ms, request_id: requestId } },
      })
    }
    // Prefer a host-tagged message so UI can show "Failed to fetch (host)"
    // without leaking full URLs/query strings into Sentry free-text fields.
    let hostHint = ''
    try {
      if (url.startsWith('http')) hostHint = ` (${new URL(url).host})`
      else if (typeof window !== 'undefined') hostHint = ` (${window.location.host} → API proxy)`
    } catch { /* ignore */ }
    const baseMsg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      requestId,
      error: {
        code: 'NETWORK_ERROR',
        message: `${baseMsg}${hostHint}`,
        requestId,
      },
    }
  }
}

// Same auth + base URL handling as apiFetch but returns the raw Response so
// callers can stream non-JSON payloads (HTML, CSV, blobs) without parsing.
// Unlike apiFetch, network failures reject/throw rather than returning
// `{ ok: false, error }` — callers must catch.
//
// FE-API-2 (audit 2026-04-21): emits the same breadcrumb + 5xx capture pattern
// as apiFetch, but leaves body-parsing to the caller.
export async function apiFetchRaw(path: string, options?: RequestInit): Promise<Response> {
  const method = (options?.method ?? 'GET').toUpperCase()
  const t0 = performance.now()
  try {
    const token = await getAccessToken()
    const activeProjectId = getActiveProjectIdForApi()
    const activeOrgId = getActiveOrgIdSnapshot()
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(activeProjectId ? { 'X-Mushi-Project-Id': activeProjectId } : {}),
        ...(activeOrgId
          ? { 'X-Mushi-Org-Id': activeOrgId, 'x-org-id': activeOrgId }
          : {}),
        ...options?.headers,
      },
    })
    const ms = Math.round(performance.now() - t0)
    Sentry.addBreadcrumb({
      category: 'api',
      type: 'http',
      level: res.ok ? 'info' : res.status >= 500 ? 'error' : 'warning',
      data: { method, url: path, status_code: res.status, duration_ms: ms, raw: true },
      message: `raw ${method} ${path} → ${res.status}`,
    })
    if (!res.ok && res.status >= 500) {
      Sentry.captureMessage(`API ${res.status} ${method} ${path} (raw)`, {
        level: 'error',
        fingerprint: ['apiFetchRaw', method, path, String(res.status)],
        tags: { source: 'apiFetchRaw', http_status: String(res.status), api_path: path },
        contexts: { http: { method, url: path, status_code: res.status, duration_ms: ms } },
      })
    }
    return res
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    Sentry.addBreadcrumb({
      category: 'api',
      type: 'http',
      level: 'error',
      data: { method, url: path, duration_ms: ms, raw: true, error: String(err).slice(0, 200) },
      message: `raw ${method} ${path} → NETWORK_ERROR`,
    })
    if (err instanceof Error && err.name !== 'AbortError') {
      Sentry.captureException(err, {
        tags: { source: 'apiFetchRaw', http_status: 'network_error', api_path: path },
        contexts: { http: { method, url: path, duration_ms: ms } },
      })
    }
    throw err
  }
}
