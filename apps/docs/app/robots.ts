import type { MetadataRoute } from 'next'

// Canonical docs origin — matches `metadataBase` + openGraph in app/layout.tsx.
// Serves /robots.txt from the static docs export (kensaur.us/mushi-mushi/docs).
// crawler-authoritative; on kensaur.us it serves under /mushi-mushi/docs/ (a
// subpath, advisory only). Kept permissive on purpose: the CloudFront edge
// already tags Nextra's `.txt` RSC mirrors `X-Robots-Tag: noindex` (see
// scripts/cloudfront-mushi-docs-response.js), so we must NOT Disallow them here
// or we'd also block the LLM-friendly text mirrors from being fetched.
const SITE = 'https://kensaur.us/mushi-mushi/docs'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE}/sitemap.xml`,
  }
}
