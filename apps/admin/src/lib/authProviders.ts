/**
 * FILE: apps/admin/src/lib/authProviders.ts
 * PURPOSE: Discover which auth methods the *backend* actually has enabled so
 *   the login UI never offers a provider that GoTrue immediately rejects.
 *
 *   supabase-js `signInWithOAuth({ provider })` performs a full-page redirect
 *   to `/auth/v1/authorize?provider=…` WITHOUT first checking whether that
 *   provider is enabled. When it is not (e.g. Google was never wired up on the
 *   project), GoTrue answers the navigation with a raw JSON error page:
 *     {"code":400,"error_code":"validation_failed",
 *      "msg":"Unsupported provider: provider is not enabled"}
 *   — a dead end the client-side promise never sees because the browser has
 *   already left the SPA.
 *
 *   GoTrue exposes the authoritative list at GET /auth/v1/settings (public,
 *   anon-key gated) — the same endpoint Supabase's own Auth UI reads to decide
 *   which provider buttons to render. We gate our buttons on it so a disabled
 *   provider is simply not offered, and the UI auto-heals the moment an
 *   operator enables the provider in the dashboard (no rebuild required).
 */

import { useEffect, useState } from 'react'
import { RESOLVED_SUPABASE_URL, RESOLVED_SUPABASE_ANON_KEY } from './env'

export interface AuthProviderAvailability {
  google: boolean
  github: boolean
  /**
   * GoTrue-native passkeys (WebAuthn). Offering the button ALSO requires
   * browser support (see `canUsePasskeys()`); this flag is the server half.
   */
  passkeys: boolean
}

interface GoTrueSettings {
  external?: Record<string, boolean>
  passkeys_enabled?: boolean
}

/**
 * Parse a GoTrue `/settings` payload into the subset of providers the login
 * page can offer. Unknown / missing fields default to `false` — fail closed,
 * because a hidden working button is strictly better than a visible one that
 * dumps the user on a raw JSON error page.
 */
export function parseAuthProviderAvailability(raw: unknown): AuthProviderAvailability {
  const settings = (raw ?? {}) as GoTrueSettings
  const external = settings.external ?? {}
  return {
    google: external.google === true,
    github: external.github === true,
    passkeys: settings.passkeys_enabled === true,
  }
}

export const NO_PROVIDERS: AuthProviderAvailability = {
  google: false,
  github: false,
  passkeys: false,
}

// Module-level cache: /settings is identical for every visitor and cheap, so
// we resolve it once per page load. A failed fetch clears the cache so the
// next mount can retry rather than being pinned to the fail-closed default.
let cached: Promise<AuthProviderAvailability> | null = null

export function fetchEnabledAuthProviders(): Promise<AuthProviderAvailability> {
  if (cached) return cached
  const url = `${RESOLVED_SUPABASE_URL}/auth/v1/settings`
  cached = fetch(url, {
    headers: RESOLVED_SUPABASE_ANON_KEY ? { apikey: RESOLVED_SUPABASE_ANON_KEY } : {},
  })
    .then(async (res) => (res.ok ? parseAuthProviderAvailability(await res.json()) : NO_PROVIDERS))
    .catch(() => {
      cached = null
      return NO_PROVIDERS
    })
  return cached
}

/**
 * React hook: which social / passkey providers the backend has enabled.
 * `loading` is true until the first `/settings` response resolves so the login
 * page can withhold OAuth buttons rather than flashing ones it may hide.
 */
export function useEnabledAuthProviders(): {
  providers: AuthProviderAvailability
  loading: boolean
} {
  const [providers, setProviders] = useState<AuthProviderAvailability>(NO_PROVIDERS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    fetchEnabledAuthProviders().then((next) => {
      if (!mounted) return
      setProviders(next)
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  return { providers, loading }
}
