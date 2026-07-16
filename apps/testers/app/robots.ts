import type { MetadataRoute } from 'next'

// Served from the static export at kensaur.us/mushi-mushi/testers/robots.txt
// (subpath — advisory only; the apex robots.txt is the crawler-authoritative
// one). Mirrors apps/docs/app/robots.ts.
const SITE = 'https://kensaur.us/mushi-mushi/testers'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE}/sitemap.xml`,
  }
}
