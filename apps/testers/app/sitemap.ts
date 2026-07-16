import type { MetadataRoute } from 'next'

// Static route list — /apps/[slug] pages are client-fetched HTML shells (the
// CloudFront router rewrites every slug to the same shell), so listing them
// would only advertise thin duplicate content. next.config.mjs sets
// `trailingSlash: true`, so every URL below ends in a slash.
const SITE = 'https://kensaur.us/mushi-mushi/testers'

export const dynamic = 'force-static'

const ROUTES = ['/', '/apps/', '/how-it-works/', '/join/', '/leaderboard/', '/roadmap/']

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return ROUTES.map((route) => ({
    url: `${SITE}${route}`,
    lastModified,
    changeFrequency: 'weekly',
    priority: route === '/' ? 1 : 0.7,
  }))
}
