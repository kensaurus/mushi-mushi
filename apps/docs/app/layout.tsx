import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import Link from 'next/link'
import { NavbarAuthChrome } from '../components/NavbarAuthChrome'
/* globals.css imports both `tailwindcss` AND `nextra-theme-docs/style.css`,
 * so we only import the one entry file to keep the cascade ordering stable
 * (Tailwind base layer before Nextra theme styles). */
import './globals.css'
import changelog from '../data/changelog.json'
import { JsonLd } from '../components/JsonLd'
import {
  DOCS_SITE,
  OG_CARD_URL,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../lib/structured-data'

import type { ReactNode } from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  metadataBase: new URL('https://kensaur.us/mushi-mushi'),
  title: {
    default: 'Mushi Mushi — know why your AI-built app broke, with the fix ready',
    template: '%s · Mushi Mushi',
  },
  description:
    'Know why your AI-built app broke — plain-English diagnosis + ready fix, in your editor. Open source. Sentry optional.',
  openGraph: {
    siteName: 'Mushi Mushi',
    type: 'website',
    // OG_CARD_URL is fully absolute — a root-relative URL here gets
    // metadataBase.pathname joined on and double-prefixes /mushi-mushi
    // (GSC-visible 404 on every docs page's social preview).
    images: [{ url: OG_CARD_URL, width: 1200, height: 630 }],
  },
  robots: { index: true, follow: true },
  // Fully-absolute asset URLs: Next joins metadataBase.pathname onto
  // root-relative metadata URLs, which doubles the /mushi-mushi prefix
  // (e.g. /mushi-mushi/mushi-mushi/docs/…). Absolute URLs bypass the join.
  icons: {
    icon: [
      { url: `${DOCS_SITE}/favicon.svg`, type: 'image/svg+xml' },
      { url: `${DOCS_SITE}/icon-192.png`, type: 'image/png', sizes: '192x192' },
      { url: `${DOCS_SITE}/icon-512.png`, type: 'image/png', sizes: '512x512' },
    ],
    apple: `${DOCS_SITE}/apple-touch-icon.png`,
  },
  twitter: {
    card: 'summary_large_image',
    site: '@mushimushi_dev',
  },
}

/* Banner is the *single* release-note channel on the index page; we removed
 * the duplicate "What's new in v0.8.0" callout from index.mdx because the
 * same content rendered twice in one fold flattened hierarchy (NN/g H14
 * information duplication). The mono eyebrow gives the banner the same
 * editorial voice as `<EditorialHero>` so it reads as part of the same
 * publication, not a generic toast.
 *
 * The headline text is sourced from `data/changelog.json` (generated from
 * Changesets on every publish) instead of being hand-typed, so the banner
 * can't drift out of sync with the actual shipped version the way the
 * hardcoded "v0.8.0 · shipped" copy did while the SDKs were already on
 * v1.22.x. `storageKey` is derived from the release so it naturally rotates
 * (and re-shows the banner) on every new majorMinor.
 *
 * `next/link` (NOT a raw `<a>`) is required so Next.js prepends the
 * configured `basePath` (set by MUSHI_BASE_PATH at build time, see
 * apps/docs/next.config.mjs). A plain `<a href="/changelog">` resolves
 * against the origin root and ships as a literal `/changelog` in every
 * page's HTML — on the kensaur.us deploy that path 404s because the docs
 * are mounted at `/mushi-mushi/docs/changelog`. Google Search Console
 * flagged this as one of the "Not found (404)" sources on 2026-05-07
 * (the only true `<a>`-emitted leak; everything else came from the
 * static-export `.txt` route-payload mirrors blocked at the CloudFront
 * edge by `scripts/cloudfront-mushi-docs-response.js`).
 */
const latestRelease = changelog[0]
const latestVersion = latestRelease.versions?.[0] ?? latestRelease.majorMinor
const latestHeadline =
  latestRelease.headline ??
  latestRelease.highlights
    ?.slice(0, 2)
    .map((h) => h.title.replace(/:$/, ''))
    .join(', ') ??
  'See what shipped.'

const banner = (
  <Banner storageKey={`v${latestRelease.majorMinor.replace(/\./g, '-')}-release`}>
    <span className="docs-banner-eyebrow">
      v{latestVersion} · {latestRelease.pending ? 'upcoming' : 'shipped'}
    </span>{' '}
    {latestHeadline}{' '}
    <Link href="/changelog" className="underline underline-offset-2">
      Read the changelog →
    </Link>
  </Banner>
)

const navbar = (
  <Navbar
    logo={
      <span className="font-semibold tracking-tight">
        Mushi Mushi <span className="opacity-60">— docs</span>
      </span>
    }
    projectLink="https://github.com/kensaurus/mushi-mushi"
  >
    {/* Auth-aware chrome: renders avatar pill + "Console" + "Sign out" when
        a session is active (populated via the postMessage bridge in
        migrationProgress.ts), or a "Console" link + "Sign in" button when
        signed out. Client component — SSR pass renders the anonymous shell
        so there's never a flash of wrong identity. */}
    <NavbarAuthChrome />
  </Navbar>
)

const footer = (
  <Footer>
    MIT (SDKs) · AGPLv3 (server) · commercial (enterprise edition) — ©{' '}
    {new Date().getFullYear()} Mushi Mushi. Built with Nextra.
  </Footer>
)

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
      </Head>
      <body>
        <JsonLd data={ORGANIZATION_JSONLD} />
        <JsonLd data={WEBSITE_JSONLD} />
        <Layout
          banner={banner}
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/kensaurus/mushi-mushi/tree/master/apps/docs"
          footer={footer}
          editLink="Edit this page on GitHub"
          feedback={{ content: 'Question? Give us feedback', labels: 'docs-feedback' }}
          sidebar={{ defaultMenuCollapseLevel: 1, toggleButton: true }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
