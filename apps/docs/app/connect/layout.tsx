import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DOCS_SITE, OG_CARD_IMAGE } from '../../lib/structured-data'

const TITLE = 'Connect your AI client'
const DESCRIPTION =
  'Pick your AI coding client and connect Mushi MCP in one click — Cursor, VS Code, Windsurf, Cline, Claude, Zed, and more.'
/** /connect is an app route, not MDX, so the catch-all's canonical logic never reaches it. */
const CONNECT_URL = `${DOCS_SITE}/connect`

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: CONNECT_URL },
  // Declaring openGraph here replaces the root layout's block wholesale, so
  // the image, URL and site name must be repeated or the share card is blank.
  openGraph: {
    title: `${TITLE} — Mushi Mushi`,
    description: DESCRIPTION,
    url: CONNECT_URL,
    siteName: 'Mushi Mushi',
    type: 'website',
    images: [OG_CARD_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} — Mushi Mushi`,
    description: DESCRIPTION,
    images: [OG_CARD_IMAGE.url],
  },
}

export default function ConnectLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
