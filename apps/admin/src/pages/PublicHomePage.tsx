/**
 * FILE: apps/admin/src/pages/PublicHomePage.tsx
 * PURPOSE: Public landing rendered at `/` (becomes `/mushi-mushi/admin/` in
 *          production). Uses the same editorial Hero / MushiCanvas /
 *          ClosingCta / MarketingFooter components that apps/cloud renders at
 *          kensaur.us/mushi-mushi/, via the shared @mushi-mushi/marketing-ui
 *          package — so visitors who hit either surface see the same brand
 *          presentation, just routed through their respective frameworks
 *          (Next.js for cloud, react-router for admin).
 *
 * ROUTING:
 *   - "Open dashboard" / "Sign in" CTAs use react-router <Link>.
 *   - In production, the cloud Next.js app at /mushi-mushi/ already serves
 *     a richer pricing / signup flow; this admin landing is the
 *     local-dev + admin-domain fallback so localhost:6464 isn't a bare
 *     redirect-to-login on first contact.
 */

import { useMemo, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import {
  ClosingCta,
  Hero,
  MarketingFooter,
  MarketingProvider,
  MushiCanvas,
  type MarketingLink,
  type MarketingLinkProps,
  type MarketingTheme,
} from '@mushi-mushi/marketing-ui'
import { useAuth } from '../lib/auth'

const DOCS_BASE = 'https://kensaur.us/mushi-mushi/docs'
const REPO_BASE = 'https://github.com/kensaurus/mushi-mushi'
const CONTACT_EMAIL = 'kensaurus@gmail.com'

/**
 * Adapter — react-router's <Link> uses `to` instead of `href`, and we need
 * to fall back to a plain <a> for hash anchors (#loop, #pricing) and any
 * external/mailto link. Mirrors the cloud-side adapter in shape.
 */
const ReactRouterLinkAdapter: MarketingLink = ({
  href,
  children,
  ...rest
}: MarketingLinkProps): ReactNode => {
  const isExternal =
    href.startsWith('http') ||
    href.startsWith('mailto:') ||
    href.startsWith('//')
  const isAnchor = href.startsWith('#')
  if (isExternal || isAnchor) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link to={href} {...(rest as Omit<LinkProps, 'to'>)}>
      {children}
    </Link>
  )
}

export function PublicHomePage() {
  const { session } = useAuth()
  const consoleHref = session ? '/dashboard' : '/login?next=%2Fdashboard'

  const theme = useMemo<MarketingTheme>(
    () => ({
      Link: ReactRouterLinkAdapter,
      urls: {
        // In the admin SPA we don't have a separate signup form; deep-link
        // straight into the auth-gated dashboard so the existing login page
        // collects credentials. The "next" param keeps the user-intent.
        signup: consoleHref,
        login: '/login',
        loopAnchor: '#loop',
        pricingAnchor: '#pricing',
        docs: (path = '') => (path ? `${DOCS_BASE}${path.startsWith('/') ? '' : '/'}${path}` : DOCS_BASE),
        repo: (path = '') => (path ? `${REPO_BASE}${path.startsWith('/') ? '' : '/'}${path}` : REPO_BASE),
        contact: (subject) =>
          subject
            ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
            : `mailto:${CONTACT_EMAIL}`,
      },
    }),
    [consoleHref],
  )

  return (
    <MarketingProvider value={theme}>
      <main className="mushi-marketing-surface min-h-screen">
        <div className="mx-auto max-w-6xl space-y-12 px-6 pb-10 pt-4">
          {/* Top nav — small, sticky, mirrors the cloud landing's silhouette
              but routes to the admin's auth surface (no signup form here). */}
          <header className="sticky top-3 z-30 flex items-center justify-between rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)] px-4 py-2 shadow-[0_18px_40px_-32px_rgba(14,13,11,0.5)] backdrop-blur sm:px-5">
            <Link
              to="/"
              className="flex items-center gap-2 font-serif text-base font-semibold text-[var(--mushi-ink)]"
              aria-label="Mushi Mushi home"
            >
              <span
                aria-hidden
                className="grid h-7 w-7 place-items-center rounded-sm bg-[var(--mushi-vermillion)] font-mono text-xs text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]"
              >
                虫
              </span>
              <span>Mushi Mushi</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm sm:gap-2">
              <a
                href="#loop"
                className="hidden rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)] sm:inline-block"
              >
                Loop
              </a>
              <a
                href={DOCS_BASE}
                className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)]"
              >
                Docs
              </a>
              <Link
                to="/login"
                className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)]"
              >
                Sign in
              </Link>
              <Link
                to={consoleHref}
                className="ml-1 rounded-full bg-[var(--mushi-ink)] px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--mushi-paper)] shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-[color-mix(in_oklch,var(--mushi-ink)_82%,var(--mushi-vermillion))]"
              >
                {session ? 'Open console' : 'Get started'}
              </Link>
            </nav>
          </header>

          <Hero />
          <MushiCanvas />
          <ClosingCta />
          {/* No public health endpoint reachable from the admin SPA, so the
              StatusPill stays in its muted "unknown" state — matches the
              cloud behaviour when NEXT_PUBLIC_API_BASE_URL isn't set. */}
          <MarketingFooter />
        </div>
      </main>
    </MarketingProvider>
  )
}
