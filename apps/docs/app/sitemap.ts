import type { MetadataRoute } from 'next'
import type { PageMapItem } from 'nextra'
import { getPageMap } from 'nextra/page-map'

// Canonical docs origin — matches `metadataBase` + openGraph in app/layout.tsx.
const SITE = 'https://kensaur.us/mushi-mushi/docs'

/** Walk Nextra's nested page map and collect every concrete page route. */
function collectRoutes(items: PageMapItem[], acc: Set<string>): void {
  for (const item of items) {
    if ('route' in item && item.route.startsWith('/') && !item.route.includes('#')) {
      acc.add(item.route)
    }
    if ('children' in item && Array.isArray(item.children)) {
      collectRoutes(item.children, acc)
    }
  }
}

export const dynamic = 'force-static'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = new Set<string>()
  collectRoutes(await getPageMap(), routes)
  const lastModified = new Date()

  return [...routes].sort().map((route) => ({
    url: route === '/' ? SITE : `${SITE}${route}`,
    lastModified,
    changeFrequency: 'weekly',
    priority: route === '/' ? 1 : 0.7,
  }))
}
