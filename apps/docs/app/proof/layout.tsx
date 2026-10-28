import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DOCS_SITE, OG_CARD_IMAGE } from '../../lib/structured-data'

const TITLE = 'Mushi on its own apps'
const DESCRIPTION =
  'Live numbers from the founder’s own apps running Mushi: bug reports from users, fixes merged, AI reviews that said do not merge, and the median time from report to merged fix.'
/** /proof is an app route, not MDX, so the catch-all's canonical logic never reaches it. */
const PROOF_URL = `${DOCS_SITE}/proof`

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PROOF_URL },
  // Declaring openGraph here replaces the root layout's block wholesale, so
  // the image, URL and site name must be repeated or the share card is blank.
  openGraph: {
    title: `${TITLE} — Mushi Mushi`,
    description: DESCRIPTION,
    url: PROOF_URL,
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

export default function ProofLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
