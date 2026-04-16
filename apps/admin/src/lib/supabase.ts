import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const API_BASE = import.meta.env.VITE_API_URL ?? `${SUPABASE_URL}/functions/v1/api`

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

supabase.auth.onAuthStateChange((_event, session) => {
  _cachedToken = session?.access_token ?? null
  _tokenExpiresAt = session?.expires_at ?? 0
})

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  try {
    const token = await getAccessToken()

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      try { return JSON.parse(body) } catch { return { ok: false, error: { code: 'HTTP_ERROR', message: `${res.status}: ${body.slice(0, 200)}` } } }
    }

    return await res.json()
  } catch (err) {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: String(err) } }
  }
}
