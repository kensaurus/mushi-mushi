/**
 * FILE: apps/docs/lib/sitemap-dates.ts
 * PURPOSE: The `<lastmod>` for a sitemap entry, taken from the page's own
 *          front matter — or none at all.
 *
 * The sitemap used to stamp every URL with the build time (`new Date()`), so
 * all ~200 `<lastmod>` values were identical and changed on every deploy.
 * Search engines learn to ignore a lastmod that is never accurate, so a page
 * now gets one only when its front matter says when it last changed.
 */

/** Front-matter keys checked in order: an explicit update date wins over the publish date. */
const DATE_KEYS = ['lastModified', 'updated', 'date'] as const

export function lastModifiedFromFrontMatter(frontMatter: Readonly<Record<string, unknown>> | undefined): Date | undefined {
  if (!frontMatter) return undefined
  for (const key of DATE_KEYS) {
    const value = frontMatter[key]
    const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined
    if (date && !Number.isNaN(date.getTime())) return date
  }
  return undefined
}
