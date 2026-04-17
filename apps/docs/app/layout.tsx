import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

import type { ReactNode } from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.mushimushi.dev'),
  title: {
    default: 'Mushi Mushi — User-side bug intelligence',
    template: '%s · Mushi Mushi Docs',
  },
  description:
    'Capture, classify, and fix bugs your users find — across web, mobile, and AI agents. Mushi Mushi is the open-source bug-report platform with an LLM triage pipeline, a knowledge graph, and an agentic fix orchestrator.',
  openGraph: {
    siteName: 'Mushi Mushi Docs',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@mushimushi_dev',
  },
}

const banner = (
  <Banner storageKey="v0-8-0-wave-c">
    Wave C shipped — native iOS / Android / Flutter / Capacitor SDKs, A2A
    discovery, SOC 2 readiness, residency, BYO storage, BYOK.{' '}
    <a href="/changelog" className="underline">
      See changelog
    </a>
    .
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
    MIT (SDKs) / BSL (server) — © {new Date().getFullYear()} Mushi Mushi.
    Built with Nextra.
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
