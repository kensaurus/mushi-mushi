/**
 * FILE: apps/admin/src/lib/supabase.ts
 * PURPOSE: Supabase client initialization with cloud fallback.
 *          When no VITE_SUPABASE_URL is set, falls back to Mushi Mushi Cloud
 *          so the app works out-of-the-box without any .env setup.
 */

import { createClient } from '@supabase/supabase-js'
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

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  const method = (options?.method ?? 'GET').toUpperCase()
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
      try { return JSON.parse(body) } catch { return { ok: false, error: { code: 'HTTP_ERROR', message: `${res.status}: ${body.slice(0, 200)}` } } }
    }

    const result = await res.json()
    debugLog('api', `${method} ${path} → ${res.status} (${ms}ms)`)
    return result
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    debugError('api', `${method} ${path} → NETWORK_ERROR (${ms}ms)`, { error: String(err) })
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
