import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import Link from 'next/link'
/* globals.css imports both `tailwindcss` AND `nextra-theme-docs/style.css`,
 * so we only import the one entry file to keep the cascade ordering stable
 * (Tailwind base layer before Nextra theme styles). */
import './globals.css'

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
    images: [{ url: '/mushi-mushi/docs/social-preview/og-card.png', width: 1200, height: 630 }],
  },
  robots: { index: true, follow: true },
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
const banner = (
  <Banner storageKey="v0-8-0-wave-c">
    <span className="docs-banner-eyebrow">v0.8.0 · shipped</span>
    Native iOS / Android / Flutter / Capacitor SDKs, A2A discovery, SOC 2
    readiness, residency, BYO storage, BYOK.{' '}
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
  />
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
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </Head>
      <body>
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
