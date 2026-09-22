import type { MetadataRoute } from 'next'
import type { PageMapItem } from 'nextra'
import { getPageMap } from 'nextra/page-map'
import { lastModifiedFromFrontMatter } from '../lib/sitemap-dates'
import { DOCS_SITE, PRODUCT_ROOT } from '../lib/structured-data'

// Canonical docs origin — matches `metadataBase` + openGraph in app/layout.tsx.
const SITE = DOCS_SITE

type FrontMatter = Readonly<Record<string, unknown>> | undefined

function frontMatterOf(item: PageMapItem): FrontMatter {
  return 'frontMatter' in item ? (item.frontMatter as FrontMatter) : undefined
}

/**
 * Walk Nextra’s nested page map and collect every route that is a real PAGE.
 *
 * A folder appears in the page map with a `route` whether or not it has an
 * index page, so adding every route emitted `/integrations` — a directory
 * holding only `_meta.ts` and `cursor.mdx` — and the sitemap advertised a URL
 * that 404s. Checked against production: every content folder carrying an
 * `index.mdx` returns 200 and `integrations`, the only one without, is the
 * single 404. So a folder counts only when it has an index child, and its
 * front matter (for `<lastmod>`) is that index page's.
 */
function collectRoutes(items: PageMapItem[], acc: Map<string, Date | undefined>): void {
  for (const item of items) {
    const children = 'children' in item && Array.isArray(item.children) ? item.children : null
    // A leaf is always a page. A folder is one only if it has an index child.
    const index = children?.find((c) => 'name' in c && c.name === 'index')
    const isPage = !children || index !== undefined
    if (isPage && 'route' in item && item.route.startsWith('/') && !item.route.includes('#')) {
      acc.set(item.route, lastModifiedFromFrontMatter(frontMatterOf(index ?? item)))
    }
    if (children) {
      collectRoutes(children, acc)
    }
  }
}

export const dynamic = 'force-static'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = new Map<string, Date | undefined>()
  collectRoutes(await getPageMap(), routes)

  // The landing's canonical is the product root (see [[...mdxPath]]/page.tsx),
  // so the sitemap must list that URL — not the /docs duplicate — for `/`.
  // `lastModified` only when the page's front matter dates it (lib/sitemap-dates.ts).
  return [...routes.keys()].sort().map((route) => {
    const lastModified = routes.get(route)
    return {
      url: route === '/' ? PRODUCT_ROOT : `${SITE}${route}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'weekly',
      priority: route === '/' ? 1 : 0.7,
    }
  })
}
