/**
 * FILE: apps/docs/lib/sitemap-dates.ts
 * PURPOSE: Dates a page states about itself in front matter — the sitemap's
 *          `<lastmod>` and a blog post's `datePublished` — or none at all.
 *
 * The sitemap used to stamp every URL with the build time (`new Date()`), so
 * all ~200 `<lastmod>` values were identical and changed on every deploy.
 * Search engines learn to ignore a lastmod that is never accurate, so a page
 * now gets one only when its front matter says when it last changed.
 */

/** A YAML date (already parsed to `Date`) or an ISO-ish string; anything else is no date. */
export function dateFromFrontMatter(value: unknown): Date | undefined {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined
  return date && !Number.isNaN(date.getTime()) ? date : undefined
}

/** Front-matter keys checked in order: an explicit update date wins over the publish date. */
const DATE_KEYS = ['lastModified', 'updated', 'date'] as const

export function lastModifiedFromFrontMatter(frontMatter: Readonly<Record<string, unknown>> | undefined): Date | undefined {
  if (!frontMatter) return undefined
  for (const key of DATE_KEYS) {
    const date = dateFromFrontMatter(frontMatter[key])
    if (date) return date
  }
  return undefined
}
