/**
 * /r — public architecture diagram of one repo, published by its owner from
 * the Mushi console (Plan 020 §10.3.3).
 *
 * The docs build is a static export, so this is one shell page: the client
 * reads the repo from `/r/<owner>/<repo>` (CloudFront rewrites
 * kensaur.us/mushi-mushi/r/* to this shell and keeps the URL — see
 * scripts/cloudfront-mushi-spa-router.js) or from `?repo=<owner>/<repo>`,
 * and fetches the published diagram from the public API. Kept noindex: the
 * shell has no per-repo content for a crawler until the page renders.
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
