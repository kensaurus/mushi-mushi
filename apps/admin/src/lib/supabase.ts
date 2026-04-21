/**
 * FILE: apps/admin/src/lib/supabase.ts
 * PURPOSE: Supabase client initialization with cloud fallback.
 *          When no VITE_SUPABASE_URL is set, falls back to Mushi Mushi Cloud
 *          so the app works out-of-the-box without any .env setup.
 */

import { createClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/react'
import { debugLog, debugWarn, debugError } from './debug'
import { RESOLVED_SUPABASE_URL, RESOLVED_SUPABASE_ANON_KEY, RESOLVED_API_URL } from './env'

export const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SUPABASE_ANON_KEY)

const API_BASE = RESOLVED_API_URL

let _cachedToken: string | null = null
let _tokenExpiresAt = 0

async function getAccessToken(): Promise<string | null> {
  const now = Date.now() / 1000
  if (_cachedToken && _tokenExpiresAt > now + 30) return _cachedToken

  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) { _cachedToken = null; return null }

  _cachedToken = session.access_token
  _tokenExpiresAt = session.expires_at ?? 0
  return _cachedToken
}

supabase.auth.onAuthStateChange((event, session) => {
  _cachedToken = session?.access_token ?? null
  _tokenExpiresAt = session?.expires_at ?? 0
  debugLog('auth', `State changed: ${event}`, { email: session?.user?.email, expiresAt: session?.expires_at })
})

export type ApiResult<T> = { ok: boolean; data?: T; error?: { code: string; message: string } }

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

function coalesceKey(method: string, path: string, body: BodyInit | null | undefined): string | null {
  if (method !== 'GET' && method !== 'HEAD') return null
  if (body != null) return null
  return `${method}:${path}`
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

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<ApiResult<T>> {
  const method = (options?.method ?? 'GET').toUpperCase()
  const cacheKey = options?.cache === 'no-store'
    ? null
    : coalesceKey(method, path, options?.body)

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

async function doFetch<T>(
  path: string,
  options: RequestInit | undefined,
  method: string,
): Promise<ApiResult<T>> {
  const url = `${API_BASE}${path}`
  const t0 = performance.now()

  debugLog('api', `${method} ${path}`)

  try {
    const token = await getAccessToken()

    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    })

    const ms = Math.round(performance.now() - t0)

    if (!res.ok) {
      const body = await res.text()
      debugWarn('api', `${method} ${path} → ${res.status} (${ms}ms)`, { body: body.slice(0, 200) })
      // Telemetry: every non-2xx becomes a Sentry breadcrumb so we get a
      // request log for free in any Sentry event captured later in the same
      // session. 5xx is escalated to a captureMessage because server errors
      // are bugs we want to know about even when the user never crashes the
      // UI. 4xx (auth, validation) is intentionally NOT escalated to keep
      // the issue list signal-rich; auth flows trip 401 by design.
      Sentry.addBreadcrumb({
        category: 'api',
        type: 'http',
        level: res.status >= 500 ? 'error' : 'warning',
        data: { method, url: path, status_code: res.status, duration_ms: ms },
        message: `${method} ${path} → ${res.status}`,
      })
      if (res.status >= 500) {
        Sentry.captureMessage(`API ${res.status} ${method} ${path}`, {
          level: 'error',
          tags: { source: 'apiFetch', http_status: String(res.status), api_path: path },
          contexts: { http: { method, url: path, status_code: res.status, duration_ms: ms } },
          extra: { response_snippet: body.slice(0, 500) },
        })
      }
      try { return JSON.parse(body) } catch { return { ok: false, error: { code: 'HTTP_ERROR', message: `${res.status}: ${body.slice(0, 200)}` } } }
    }

    const result = await res.json()
    debugLog('api', `${method} ${path} → ${res.status} (${ms}ms)`)
    return result
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
      data: { method, url: path, duration_ms: ms, error: String(err).slice(0, 200) },
      message: `${method} ${path} → NETWORK_ERROR`,
    })
    if (err instanceof Error && err.name !== 'AbortError') {
      Sentry.captureException(err, {
        tags: { source: 'apiFetch', http_status: 'network_error', api_path: path },
        contexts: { http: { method, url: path, duration_ms: ms } },
      })
    }
    return { ok: false, error: { code: 'NETWORK_ERROR', message: String(err) } }
  }
}

// Same auth + base URL handling as apiFetch but returns the raw Response so
// callers can stream non-JSON payloads (HTML, CSV, blobs) without parsing.
export async function apiFetchRaw(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken()
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
}
