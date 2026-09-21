/**
 * FILE: scripts/lib/blog-feed.mjs
 * PURPOSE: Build the RSS 2.0 feed for the docs blog (apps/docs/public/blog/feed.xml).
 *
 * The launch plan leans on the blog, and it had no feed: nothing a reader,
 * an aggregator or an agent could subscribe to. generate-llms-full.mjs calls
 * this from the docs prebuild, so the feed is rebuilt from the posts' front
 * matter on every deploy. Output is deterministic (lastBuildDate is the
 * newest post's date, not the build time) so regenerating is a no-op unless
 * a post changed.
 */

/** Escape text for an XML element or attribute value. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** A front-matter date as a Date, or null when absent or unparseable. */
function toDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * @param {{
 *   title: string,
 *   link: string,
 *   description: string,
 *   feedUrl: string,
 *   author: string,
 *   posts: Array<{ title: string, url: string, description?: string, date?: string | null }>,
 * }} feed
 * @returns {string} RSS 2.0 XML, newest dated post first, undated posts last.
 */
export function buildRssFeed(feed) {
  const posts = feed.posts
    .map((p) => ({ ...p, published: toDate(p.date) }))
    .sort((a, b) => {
      if (a.published && b.published) return b.published.getTime() - a.published.getTime()
      if (a.published) return -1
      if (b.published) return 1
      return a.title.localeCompare(b.title)
    })
  const newest = posts.find((p) => p.published)?.published ?? null

  const items = posts.map((p) =>
    [
      '    <item>',
      `      <title>${escapeXml(p.title)}</title>`,
      `      <link>${escapeXml(p.url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(p.url)}</guid>`,
      p.description ? `      <description>${escapeXml(p.description)}</description>` : null,
      `      <dc:creator>${escapeXml(feed.author)}</dc:creator>`,
      p.published ? `      <pubDate>${p.published.toUTCString()}</pubDate>` : null,
      '    </item>',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escapeXml(feed.title)}</title>`,
    `    <link>${escapeXml(feed.link)}</link>`,
    `    <description>${escapeXml(feed.description)}</description>`,
    '    <language>en</language>',
    `    <atom:link href="${escapeXml(feed.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    newest ? `    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>` : null,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n')
}
