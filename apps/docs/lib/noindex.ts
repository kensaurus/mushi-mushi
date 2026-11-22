/**
 * FILE: apps/docs/lib/noindex.ts
 * PURPOSE: One front-matter field decides whether a docs page is indexed.
 *
 * A page that sets
 *
 *   robots:
 *     index: false
 *     follow: true
 *
 * gets `<meta name="robots" content="noindex, follow">` (the catch-all page
 * spreads front matter into Next.js metadata, app/[[...mdxPath]]/page.tsx)
 * and is left out of the sitemap (app/sitemap.ts), which may list only
 * indexable URLs. The page stays in the sidebar and every link to it works.
 *
 * Used for operator-only pages (growth audit 2026-11-14): the maintainer
 * runbooks under /operating and the console pages only Mushi staff see
 * (navRegistry `operatorOnly`, ADR 0052 / 0058), which were indexed next to
 * the pages builders search for.
 */

/** True when front matter opts the page out of indexing. */
export function isNoindexFrontMatter(frontMatter: Readonly<Record<string, unknown>> | undefined): boolean {
  const robots = frontMatter?.robots
  if (typeof robots === 'string') return /\bnoindex\b/i.test(robots)
  if (robots && typeof robots === 'object') return (robots as { index?: unknown }).index === false
  return false
}
