/**
 * /r — the interactive public architecture diagram (docs/operators/public-diagram-pages.md).
 *
 * The indexable page for a repo lives at kensaur.us/mushi-mushi/r/<owner>/<repo>:
 * a static HTML file the api writes on publish. This docs page is the
 * interactive view it links to (`/mushi-mushi/docs/r?repo=<owner>/<repo>`):
 * click a part to read about it, or report a wrong diagram privately. The same
 * client also renders inside the docs 404 page when no static file exists yet.
 * Kept noindex: the static page is the one search engines should find.
 */

import type { Metadata } from 'next'
import { PublicDiagramClient } from './PublicDiagramClient'

export const metadata: Metadata = {
  title: 'Architecture diagram',
  description:
    'An AI architecture diagram of an open-source repo, published by its owner with Mushi. Every file path is checked against the repo.',
  robots: { index: false, follow: true },
}

export default function PublicDiagramPage() {
  return <PublicDiagramClient />
}
