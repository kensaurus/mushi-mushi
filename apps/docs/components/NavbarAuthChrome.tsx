'use client'

/**
 * FILE: apps/docs/components/NavbarAuthChrome.tsx
 *
 * Auth-aware right-side chrome for the Nextra docs Navbar.
 *
 * WHY THIS EXISTS
 * ---------------
 * The docs site is a static Next.js/Nextra export with no Supabase
 * client — holding a refresh token in docs would widen the attack surface
 * unnecessarily (see apps/docs/lib/migrationProgress.ts §SECURITY POSTURE).
 * Instead, auth flows through the existing postMessage bridge
 * (`openAdminAuthBridge`, started from the migration checklist): a minimal
 * popup at `/mushi-mushi/admin/docs-bridge` posts a short-lived *access
 * token* back. Signed out, the navbar links straight to the console's
 * sign-up and login (BL-173). We store it in
 * tab-scoped `sessionStorage` and listen to `mushi:docs:auth-change` events
 * so every component that needs the session stays in sync.
 *
 * DATA PROVENANCE
 * ---------------
 * • `session.email`  — Supabase `user.email` forwarded verbatim by DocsBridgePage
 *   (apps/admin/src/pages/DocsBridgePage.tsx line 122)
 * • `session.expiresAt` — Supabase `session.expires_at` (Unix seconds, line 121)
 * • Token lives in sessionStorage key `mushi:docs:auth` (see SESSION_KEY in
 *   migrationProgress.ts); expires with the browser tab.
 * • No `full_name` / `user_metadata` forwarded by bridge — only email is
 *   available here (by design: minimal surface area through the popup).
 *
 * HEURISTICS
 * ----------
 * NN/g #1 Visibility of System Status: show logged-in identity explicitly so
 *   the user knows their session is active without having to navigate away.
 * NN/g #6 Recognition over Recall: surface "Start free", "Sign in" and
 *   "Console" directly in the navbar so the user never has to remember the URL.
 * NN/g #4 Consistency: mirrors the identity pill from PublicHomePage.tsx in
 *   apps/admin so returning visitors get the same mental model across surfaces.
 *
 * STYLING
 * -------
 * Uses the `--mushi-*` CSS custom-property vocabulary (same tokens used by
 * MigrationChecklist) so the chrome integrates with Nextra's light/dark
 * theme cascade without fighting it. Classes intentionally match
 * MigrationChecklist.tsx's button and pill patterns.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ADMIN_CONSOLE_URL as ADMIN_CONSOLE,
  getDocsAuthSession,
  signOutDocs,
  type DocsAuthSession,
} from '../lib/migrationProgress'

// ── helpers ──────────────────────────────────────────────────────────────

/** Best one-char avatar initial from the docs session. */
function getInitial(session: DocsAuthSession): string {
  if (session.email) return session.email.charAt(0).toUpperCase()
  return '?'
}

/** Display label: email truncated for narrow viewports. */
function getDisplayLabel(session: DocsAuthSession): string {
  return session.email ?? 'your account'
}

// ── component ─────────────────────────────────────────────────────────────

export function NavbarAuthChrome() {
  // Always start anonymous on the server / SSR pass so we never flash a
  // stale identity before the bridge session is read from sessionStorage.
  const [session, setSession] = useState<DocsAuthSession | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // Hydrate once on mount
  useEffect(() => {
    setSession(getDocsAuthSession())
    setHydrated(true)
  }, [])

  // Keep in sync when bridge resolves or another tab signs out
  useEffect(() => {
    const handleChange = () => setSession(getDocsAuthSession())
    window.addEventListener('mushi:docs:auth-change', handleChange)
    return () => window.removeEventListener('mushi:docs:auth-change', handleChange)
  }, [])

  const handleSignOut = useCallback(() => {
    setSigningOut(true)
    try {
      signOutDocs()
      // signOutDocs fires mushi:docs:auth-change → listener clears session
    } finally {
      setSigningOut(false)
    }
  }, [])

  // The static export (and every visitor before hydration) renders the
  // signed-out chrome below. It used to render a bare "Console" link to the
  // auth-gated console root, so a first-time visitor landed on /admin/login
  // with nothing to try (MUSHI-f2ccc05f).
  if (hydrated && session) {
    const initial = getInitial(session)
    const label = getDisplayLabel(session)

    return (
      <div className="flex items-center gap-1">
        {/* Identity pill: avatar + email (email hidden below sm to prevent
            navbar wrap). Mirrors the admin SPA's SignedInChrome pattern. */}
        <a
          href={`${ADMIN_CONSOLE}/dashboard`}
          title={`Signed in as ${label}`}
          aria-label={`Signed in as ${label} — open console`}
          className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] py-1 pl-1 pr-2.5 transition hover:border-[var(--mushi-ink-muted)] hover:bg-[var(--mushi-paper-wash)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
        >
          {/* Avatar circle — text-3xs is the absolute floor for visible text */}
          <span
            aria-hidden
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--mushi-vermillion)] font-mono text-3xs font-semibold text-[var(--mushi-paper)] shadow-[inset_0_-1px_0_rgba(0,0,0,0.2)]"
          >
            {initial}
          </span>
          {/* Email — hidden on mobile to prevent navbar wrapping */}
          <span className="hidden max-w-36 truncate font-mono text-2xs uppercase tracking-[0.14em] text-[var(--mushi-ink)] sm:inline">
            {label}
          </span>
        </a>

        {/* Open console CTA */}
        <a
          href={`${ADMIN_CONSOLE}/dashboard`}
          className="rounded-full bg-[var(--mushi-ink)] px-2.5 py-1 font-mono text-2xs font-medium uppercase tracking-[0.16em] text-[var(--mushi-paper)] shadow-[inset_0_-1px_0_rgba(255,255,255,0.15)] transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
        >
          Console
        </a>

        {/* Sign out — ghost, recedes behind the CTA */}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out of Mushi Mushi docs sync"
          className="rounded-full px-2 py-1 font-mono text-2xs uppercase tracking-[0.14em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-paper-wash)] hover:text-[var(--mushi-ink)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
        >
          {signingOut ? '…' : 'Sign out'}
        </button>
      </div>
    )
  }

  // Signed-out state. A first-time visitor needs something to try before an
  // account: "Free check" runs the no-account Production Check (/check).
  // "Start free" opens the console's sign-up form and "Sign in" its login
  // (BL-173). Checklist sync keeps its own sign-in on the checklist
  // (MigrationChecklist). Below sm only "Free check" shows, so the row fits
  // at 390px. "Start free" waits for xl: from 640 to 1279px the row also holds
  // the logo, search and GitHub, and with it the logo ran off the left edge
  // (2026-11-14). Sign-up stays one click away on the landing and /check.
  return (
    <div className="flex items-center gap-1">
      <a
        href={`${ADMIN_CONSOLE}/login`}
        className="hidden whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-2xs uppercase sm:inline-block tracking-[0.16em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-paper-wash)] hover:text-[var(--mushi-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
      >
        Sign in
      </a>
      <a
        href={`${ADMIN_CONSOLE}/signup?src=docs-nav`}
        className="hidden whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-2xs uppercase xl:inline-block tracking-[0.16em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-paper-wash)] hover:text-[var(--mushi-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
      >
        Start free
      </a>
      <Link
        href="/check"
        className="whitespace-nowrap rounded-full border border-[var(--mushi-ink)] bg-[var(--mushi-ink)] px-2.5 py-1 font-mono text-2xs font-medium uppercase tracking-[0.16em] text-[var(--mushi-paper)] transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
      >
        Free check
      </Link>
    </div>
  )
}
