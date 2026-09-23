'use client'

/**
 * Site footer for every docs/landing route.
 *
 * Why a client component: the footer is passed to Nextra's <Layout> once from
 * the root layout, so the only way to vary it per route is `usePathname()`.
 * The kensaurus portfolio table stays on ordinary docs pages (it is how the
 * rest of the portfolio is discovered) but is hidden on the surfaces a
 * prospective customer lands on — the marketing landing, pricing, connect,
 * the legal pages and the security summary — where "side project among
 * seven" undercuts the trust the page is trying to build.
 *
 * `next/link` (not a raw <a>) so the configured basePath is prepended; a raw
 * `<a href="/legal/privacy">` resolves against the origin root and 404s on the
 * kensaur.us deploy (see the changelog-link note in app/layout.tsx).
 */
import { KensaurusPortfolioTable } from '@mushi-mushi/marketing-ui'
import { Footer } from 'nextra-theme-docs'
import Link from 'next/link'
import { useSitePathname } from '../lib/site-pathname'

/** docs/adr/0015 — kensaurus@gmail.com is the product inbox. */
const CONTACT_EMAIL = 'kensaurus@gmail.com'
const STATUS_PAGE_URL = 'https://updown.io/p/b6lod'

/** Routes where the portfolio table is hidden (exact, or the `/legal/*` prefix). */
const PORTFOLIO_HIDDEN_EXACT = new Set(['/', '/pricing', '/connect', '/security'])

function shouldShowPortfolio(pathname: string | null): boolean {
  if (!pathname) return true
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (PORTFOLIO_HIDDEN_EXACT.has(normalized)) return false
  if (normalized === '/legal' || normalized.startsWith('/legal/')) return false
  return true
}

const FOOTER_LINKS: ReadonlyArray<{ label: string; href: string; external?: true }> = [
  { label: 'Privacy', href: '/legal/privacy' },
  { label: 'Terms', href: '/legal/terms' },
  { label: 'Security', href: '/security' },
  { label: 'Status', href: STATUS_PAGE_URL, external: true },
  { label: 'Contact', href: `mailto:${CONTACT_EMAIL}`, external: true },
]

export function SiteFooter() {
  // Site-relative: the landing is also served at /mushi-mushi/ (outside
  // basePath), which must count as "/" or the portfolio renders there and the
  // hydration fails (lib/site-pathname.ts).
  const pathname = useSitePathname()
  const showPortfolio = shouldShowPortfolio(pathname)

  return (
    <Footer>
      <div className="flex w-full flex-col gap-6">
        <nav aria-label="Legal and support" className="site-footer__links">
          <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-2 p-0 text-sm">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                {link.external ? (
                  <a
                    href={link.href}
                    className="underline-offset-2 hover:underline"
                    {...(link.href.startsWith('http')
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href} className="underline-offset-2 hover:underline">
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <p>
          MIT (SDKs) · AGPLv3 (server) · commercial (enterprise edition) — ©{' '}
          {new Date().getFullYear()} Mushi Mushi. Built with Nextra.
        </p>
        {showPortfolio ? <KensaurusPortfolioTable utmSource="mushi-docs" /> : null}
      </div>
    </Footer>
  )
}
