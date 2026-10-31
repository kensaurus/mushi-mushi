import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DOCS_SITE, OG_CARD_IMAGE } from '../../lib/structured-data'

const TITLE = 'Free Production Check'
const DESCRIPTION =
  'Paste your live app’s address. Mushi Mushi reads your home page and three pages it links to, the way a first visitor sees them, and tells you in plain English what is broken and how to fix it. Public pages only.'
/** /check is an app route, not MDX, so the catch-all's canonical logic never reaches it. */
const CHECK_URL = `${DOCS_SITE}/check`

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: CHECK_URL },
  // Declaring openGraph here replaces the root layout's block wholesale, so
  // the image, URL and site name must be repeated or the share card is blank.
  openGraph: {
    title: `${TITLE} — Mushi Mushi`,
    description: DESCRIPTION,
    url: CHECK_URL,
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

export default function CheckLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
