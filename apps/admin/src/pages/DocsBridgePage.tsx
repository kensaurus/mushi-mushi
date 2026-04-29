/**
 * FILE: apps/admin/src/pages/DocsBridgePage.tsx
 * PURPOSE: Cross-origin auth bridge for docs.mushimushi.dev's Migration Hub
 *          checklist sync.
 *
 * FLOW (matches apps/docs/lib/migrationProgress.ts → openAdminAuthBridge):
 *   1. Docs opens this route in a popup with `?nonce=...&returnOrigin=...`.
 *   2. ProtectedRoute wraps every authenticated route, so unauthenticated
 *      visitors are bounced to /login first; on return Supabase restores
 *      the session and we land back here.
 *   3. We read the live Supabase session, capture the access token + active
 *      project + active org, and post a structured message back to the
 *      opener at the EXACT requested origin (never `*`).
 *   4. The opener verifies origin + nonce + message type before trusting
 *      the token and storing it in sessionStorage.
 *
 * SECURITY GUARDS HERE
 *   - returnOrigin must be in the allowlist below (mirrors the cors block
 *     in packages/server/supabase/functions/api/index.ts → DOCS_ORIGIN_ALLOWLIST).
 *   - nonce is required and forwarded back unchanged so the opener can
 *     pin the response to the request it initiated.
 *   - We refuse to post when window.opener is missing or cross-origin
 *     navigation has stripped it.
 *   - The token we forward is the SHORT-LIVED Supabase access token, never
 *     the refresh token. Docs sessions expire with the tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { RESOLVED_API_URL } from '../lib/env'
import { getActiveProjectIdSnapshot } from '../lib/activeProject'
import { getActiveOrgIdSnapshot } from '../lib/activeOrg'

type BridgeStatus = 'pending' | 'sent' | 'invalid_origin' | 'missing_opener' | 'no_session' | 'no_nonce'

const ALLOWED_DOCS_ORIGINS = new Set<string>(
  [
    'https://docs.mushimushi.dev',
    'https://kensaur.us',
    'https://www.kensaur.us',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ].map((s) => s.replace(/\/+$/, '')),
)

function normalizeOrigin(raw: string | null): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return `${u.protocol}//${u.host}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function DocsBridgePage() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const nonce = params.get('nonce') ?? ''
  const returnOrigin = useMemo(() => normalizeOrigin(params.get('returnOrigin')), [params])
  const [status, setStatus] = useState<BridgeStatus>('pending')
  const sentRef = useRef(false)

  useEffect(() => {
    if (sentRef.current) return
    if (loading) return

    if (!nonce) {
      setStatus('no_nonce')
      return
    }
    if (!returnOrigin || !ALLOWED_DOCS_ORIGINS.has(returnOrigin)) {
      setStatus('invalid_origin')
      return
    }
    if (!session?.access_token) {
      setStatus('no_session')
      return
    }
    if (typeof window === 'undefined' || !window.opener) {
      setStatus('missing_opener')
      return
    }

    sentRef.current = true
    const payload = {
      type: 'mushi:docs-bridge:token' as const,
      nonce,
      accessToken: session.access_token,
      // Supabase exposes expires_at as a unix-seconds number; we forward
      // unchanged so the docs side can refresh-on-expiry without rederiving.
      expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + 60 * 60,
      email: session.user?.email ?? null,
      projectId: getActiveProjectIdSnapshot(),
      organizationId: getActiveOrgIdSnapshot(),
      apiUrl: RESOLVED_API_URL,
    }

    try {
      window.opener.postMessage(payload, returnOrigin)
      setStatus('sent')
      // Auto-close after a short delay so the user sees the success state.
      window.setTimeout(() => {
        try {
          window.close()
        } catch {
          /* user agent may refuse to close non-script-opened windows */
        }
      }, 500)
    } catch {
      setStatus('missing_opener')
    }
  }, [loading, nonce, returnOrigin, session])

  // Keep the session fresh in case it was about to expire when the popup
  // opened — refreshSession is a no-op when nothing is needed.
  useEffect(() => {
    if (!session) return
    void supabase.auth.refreshSession().catch(() => null)
  }, [session])

  return (
    <main className="grid min-h-screen place-items-center bg-surface p-6">
      <div className="max-w-md rounded-xl border border-border bg-bg p-6 text-center shadow-sm">
        {status === 'pending' && (
          <p className="text-sm text-fg-muted">Connecting your Mushi account to the docs…</p>
        )}
        {status === 'sent' && (
          <>
            <p className="text-base font-medium text-fg">Docs sync connected</p>
            <p className="mt-1 text-sm text-fg-muted">
              You can close this window. Your migration checklist progress will sync automatically.
            </p>
          </>
        )}
        {status === 'no_session' && (
          <p className="text-sm text-fg">
            Sign in to your Mushi account in this browser, then re-open this window from the docs.
          </p>
        )}
        {status === 'no_nonce' && (
          <p className="text-sm text-fg">This window is missing a sign-in nonce; close it and try again from the docs.</p>
        )}
        {status === 'invalid_origin' && (
          <p className="text-sm text-fg">
            The docs site that requested this sign-in isn't on the allowlist. Close this window —
            this is a safety check.
          </p>
        )}
        {status === 'missing_opener' && (
          <p className="text-sm text-fg">
            We can't talk back to the docs window. Re-open this from the docs site so the bridge
            can post the token securely.
          </p>
        )}
      </div>
    </main>
  )
}

export default DocsBridgePage
