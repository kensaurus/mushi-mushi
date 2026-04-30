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
  SwitchingFromStrip,
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
 * to fall back to a plain <a> for hash anchors (#loop) and any
 * external/mailto link. The MarketingLinkProps interface includes `target`
 * and `rel` so the marketing components can request that outbound links
 * (docs / GitHub / migration guides / pricing) open in a new tab without
 * losing the landing context. The plain <a> branch already forwards them
 * via `...rest`; the SPA <Link> branch ignores them since react-router
 * never crosses origins, but `rest` is still spread so future props work.
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
    () => {
      // Trailing-slash quirk of the docs deploy:
      //   - The site is `next build && next export` with `trailingSlash: false`.
      //   - That emits `out/index.html` (so `/docs/` 200s and `/docs` 404s on
      //     CloudFront) and per-page flat HTML for subpages (so
      //     `/docs/concepts/judge-loop` 200s and the trailing-slash variant
      //     404s). The previous helper returned a bare `/docs` URL for the
      //     no-arg case, which is exactly the one path CloudFront rejects.
      // Therefore: index URL gets an explicit trailing slash; subpage URLs
      // must NOT. Hash-only inputs (e.g. `'#plans'`) are appended directly
      // so callers can compose links like `urls.docs('/cloud#plans')` too.
      const docs = (path = '') => {
        if (!path) return `${DOCS_BASE}/`
        if (path.startsWith('#')) return `${DOCS_BASE}/${path}`
        return `${DOCS_BASE}${path.startsWith('/') ? '' : '/'}${path}`
      }
      const repo = (path = '') =>
        path ? `${REPO_BASE}${path.startsWith('/') ? '' : '/'}${path}` : REPO_BASE
      return {
        Link: ReactRouterLinkAdapter,
        urls: {
          // In the admin SPA we don't have a separate signup form; deep-link
          // straight into the auth-gated dashboard so the existing login page
          // collects credentials. The "next" param keeps the user-intent.
          signup: consoleHref,
          login: '/login',
          loopAnchor: '#loop',
          // Pricing lives on the docs site at /cloud (Free + Cloud + Enterprise
          // table). The previous `'#pricing'` anchor pointed at a section that
          // does not exist on this landing — a dead footer link. The hash
          // jumps the visitor to the "Plans" heading inside the cloud doc.
          pricing: docs('/cloud#plans'),
          docs,
          repo,
          contact: (subject) =>
            subject
              ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
              : `mailto:${CONTACT_EMAIL}`,
        },
      }
    },
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
              {/* "Loop" header link removed — it duplicated the Hero's
                  "Watch the loop" secondary CTA (which scrolls to the same
                  #loop anchor) and added a third semantic destination next
                  to Docs / Sign in / Get started without telling the
                  visitor anything new. The MushiCanvas section the anchor
                  pointed at is in the natural reading flow below the Hero,
                  so the redundant nav item was just chrome. */}
              <a
                /* Trailing slash matters: see the docs() helper below — the
                 * static export's `out/index.html` is only reachable via
                 * `/docs/`, never `/docs`. */
                href={`${DOCS_BASE}/`}
                target="_blank"
                rel="noreferrer"
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
          <SwitchingFromStrip />
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
