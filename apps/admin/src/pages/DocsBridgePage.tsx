/**
 * FILE: apps/admin/src/pages/DocsBridgePage.tsx
 * PURPOSE: Cross-origin auth bridge for the docs Migration Hub checklist sync.
 *
 * FLOW (matches apps/docs/lib/migrationProgress.ts → openAdminAuthBridge):
 *   1. Docs opens this route in a popup with `?nonce=...&returnOrigin=...`.
 *   2. ProtectedRoute wraps every authenticated route, so unauthenticated
 *      visitors are bounced to /login first; on return Supabase restores
 *      the session and we land back here.
 *   3. We ask the user to confirm ("Sign in to the docs as <email>?").
 *      Only after Allow do we read the live Supabase session, capture the
 *      access token + active project + active org, and post a structured
 *      message back to the opener at the EXACT requested origin (never `*`).
 *   4. The opener verifies origin + nonce + message type before trusting
 *      the token and storing it in sessionStorage.
 *
 * SECURITY GUARDS HERE
 *   - returnOrigin must be in the allowlist (lib/docsBridgeOrigins.ts).
 *     Local docs origins are allowed only when this console runs locally.
 *   - Nothing is posted without an explicit Allow click.
 *   - nonce is required and forwarded back unchanged so the opener can
 *     pin the response to the request it initiated.
 *   - We refuse to post when window.opener is missing or cross-origin
 *     navigation has stripped it.
 *   - The token we forward is the SHORT-LIVED Supabase access token, never
 *     the refresh token. Docs sessions expire with the tab.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { RESOLVED_API_URL } from '../lib/env'
import { getActiveProjectIdSnapshot } from '../lib/activeProject'
import { getActiveOrgIdSnapshot } from '../lib/activeOrg'
import { docsBridgeAllowedOrigins, normalizeOrigin } from '../lib/docsBridgeOrigins'
import { SignalChip } from '../components/report-detail/ReportSurface'
import { docsUrl } from '../lib/docsUrl'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { Btn } from '../components/ui'

type BridgeStatus =
  | 'pending'
  | 'awaiting_consent'
  | 'sent'
  | 'cancelled'
  | 'invalid_origin'
  | 'missing_opener'
  | 'no_session'
  | 'no_nonce'

/* Allowed docs origins: the hosted docs, plus local docs dev servers only
 * when this console is itself running locally (see lib/docsBridgeOrigins).
 * VITE_DOCS_ORIGIN_ALLOWLIST mirrors MUSHI_DOCS_ORIGIN_ALLOWLIST on the API:
 *   VITE_DOCS_ORIGIN_ALLOWLIST="https://docs.example.com,https://staging.example.com"
 * `import.meta.env.VITE_*` is typed `any` here, so coerce to string early. */
const ALLOWED_DOCS_ORIGINS = docsBridgeAllowedOrigins(
  typeof window === 'undefined' ? '' : window.location.hostname,
  String(import.meta.env.VITE_DOCS_ORIGIN_ALLOWLIST ?? '').trim(),
)

export function DocsBridgePage() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const nonce = params.get('nonce') ?? ''
  const returnOrigin = useMemo(() => normalizeOrigin(params.get('returnOrigin')), [params])
  const [status, setStatus] = useState<BridgeStatus>('pending')
  const sentRef = useRef(false)

  // Validate the request, then wait for the user. Nothing is posted until
  // they press Allow: an allowed origin is not consent to hand it a token.
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
    setStatus((prev) => (prev === 'cancelled' ? prev : 'awaiting_consent'))
  }, [loading, nonce, returnOrigin, session])

  async function allow() {
    if (sentRef.current || !returnOrigin || !ALLOWED_DOCS_ORIGINS.has(returnOrigin)) return
    if (typeof window === 'undefined' || !window.opener) {
      setStatus('missing_opener')
      return
    }
    // Read the session at click time so the docs get the freshest token.
    const { data } = await supabase.auth.getSession()
    const current = data.session ?? session
    if (!current?.access_token) {
      setStatus('no_session')
      return
    }

    sentRef.current = true
    const payload = {
      type: 'mushi:docs-bridge:token' as const,
      nonce,
      accessToken: current.access_token,
      // Supabase exposes expires_at as a unix-seconds number; we forward
      // unchanged so the docs side can refresh-on-expiry without rederiving.
      expiresAt: current.expires_at ?? Math.floor(Date.now() / 1000) + 60 * 60,
      email: current.user?.email ?? null,
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
      sentRef.current = false
      setStatus('missing_opener')
    }
  }

  function cancel() {
    setStatus('cancelled')
    try {
      window.close()
    } catch {
      /* user agent may refuse to close non-script-opened windows */
    }
  }

  // Keep the access token fresh in case it was about to expire when the
  // popup opened, so the docs side gets a token that survives at least the
  // next PUT round-trip.
  //
  // CRITICAL — DO NOT remove the ref guard or the expiry threshold below.
  // `supabase.auth.refreshSession()` is NOT a no-op: it always hits
  // `/token?grant_type=refresh_token` and emits a TOKEN_REFRESHED event,
  // which `useAuth()` translates into a brand-new `session` object. With
  // a naive `[session]` dep, that new session re-runs this effect, which
  // calls `refreshSession()` again, which emits another session, etc. —
  // an unbounded loop against Supabase's auth endpoint.
  //
  // In the happy path (status === 'sent') the popup auto-closes after
  // 500ms, masking the loop to 2–3 wasted /token calls. But in error
  // states (`missing_opener`, `invalid_origin`, `no_nonce`, `no_session`)
  // the popup stays open until the user notices, and the loop runs
  // indefinitely — burning Supabase API quota and racking up rate-limit
  // 429s on the user's project.
  //
  // Fix: pin the refresh to AT MOST ONCE per popup mount via
  // `refreshedOnceRef`, and only fire it when the access token is within
  // the refresh window. Nothing is sent from an effect: `allow()` reads
  // `supabase.auth.getSession()` when the user presses Allow, so a click
  // after this refresh has finished sends the refreshed token. A token with
  // more than 5min left is never refreshed here and is sent as is.
  // Back to the docs that opened this window when that site is allowed;
  // otherwise the hosted docs home (never an unvetted origin).
  const backToDocsHref = returnOrigin && ALLOWED_DOCS_ORIGINS.has(returnOrigin) ? returnOrigin : docsUrl()

  const refreshedOnceRef = useRef(false)
  useEffect(() => {
    if (refreshedOnceRef.current) return
    if (loading || !session) return
    refreshedOnceRef.current = true

    const expiresAtSec = session.expires_at ?? 0
    const nowSec = Math.floor(Date.now() / 1000)
    const REFRESH_THRESHOLD_SEC = 5 * 60
    if (expiresAtSec - nowSec > REFRESH_THRESHOLD_SEC) return

    void supabase.auth.refreshSession().catch(() => null)
  }, [loading, session])

  return (
    <div className="space-y-4">
      <PageHeaderBar
        title="Docs bridge"

        helpTitle="About the docs bridge"
        helpWhatIsIt="Sign-in bridge opened by the docs Migration Hub. After you press Allow, it hands your current sign-in to the docs site that asked."
        helpUseCases={[
          'Sync migration checklist progress from docs to admin',
          'Authenticate the docs site without re-entering credentials',
        ]}
        helpHowToUse="Opened from the docs. Sign in if prompted, check the docs address shown, then press Allow. The window closes once the docs are signed in."
        showCopyLink={false}
      />
    <main className="grid place-items-center">
      {/* One level of box (2026-11-18 sweep): the card holds plain text, not
          tinted boxes, and every dead end offers the way back to the docs. */}
      <div className="max-w-md rounded-xl border border-edge bg-surface p-6 text-center shadow-sm space-y-3">
        {status === 'pending' && (
          <>
            <SignalChip tone="brand">Docs bridge</SignalChip>
            <p className="text-sm text-fg-muted">Connecting your Mushi Mushi account to the docs…</p>
          </>
        )}
        {status === 'awaiting_consent' && (
          <>
            <SignalChip tone="brand">Docs sign-in</SignalChip>
            <p className="text-base font-medium text-fg">
              Sign in to the docs as {session?.user?.email ?? 'your Mushi Mushi account'}?
            </p>
            <p className="text-sm text-fg-muted">
              <span className="font-mono text-fg">{returnOrigin}</span> is asking to use your Mushi Mushi
              sign-in so it can sync your migration checklist. Only allow this if you opened it from
              the Mushi Mushi docs.
            </p>
            <div className="flex justify-center gap-2">
              <Btn variant="ghost" size="sm" onClick={cancel}>
                Cancel
              </Btn>
              <Btn variant="primary" size="sm" onClick={() => void allow()}>
                Allow
              </Btn>
            </div>
          </>
        )}
        {status === 'cancelled' && (
          <p className="text-sm text-fg">
            Cancelled. The docs did not get your sign-in. You can close this window.
          </p>
        )}
        {status === 'sent' && (
          <>
            <SignalChip tone="ok">Connected</SignalChip>
            <p className="text-base font-medium text-fg">Docs sync connected</p>
            <p className="text-sm text-fg-muted">
              You can close this window. Your migration checklist progress will sync automatically.
            </p>
          </>
        )}
        {status === 'no_session' && (
          <BridgeDeadEnd backHref={backToDocsHref}>
            Sign in to your Mushi Mushi account in this browser, then open this again from the docs.
          </BridgeDeadEnd>
        )}
        {status === 'no_nonce' && (
          <BridgeDeadEnd backHref={backToDocsHref}>
            This sign-in link has expired. Open it again from the docs.
          </BridgeDeadEnd>
        )}
        {status === 'invalid_origin' && (
          <BridgeDeadEnd backHref={backToDocsHref}>
            This sign-in came from a site Mushi Mushi doesn't recognise, so it was blocked.
          </BridgeDeadEnd>
        )}
        {status === 'missing_opener' && (
          <BridgeDeadEnd backHref={backToDocsHref}>
            The docs window that asked for this sign-in is gone. Open it again from the docs.
          </BridgeDeadEnd>
        )}
      </div>
    </main>
    </div>
  )
}

/** A state the user can't finish here: one plain line and the way back. */
function BridgeDeadEnd({ children, backHref }: { children: ReactNode; backHref: string }) {
  return (
    <div className="space-y-3" data-testid="docs-bridge-dead-end">
      <p className="text-sm text-fg">{children}</p>
      <Btn href={backHref} variant="primary" size="sm" className="whitespace-nowrap">
        Back to docs
      </Btn>
    </div>
  )
}
