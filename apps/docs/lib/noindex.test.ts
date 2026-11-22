/**
 * Operator-only docs pages are noindex and out of the sitemap, but still
 * reachable (growth audit 2026-11-14). One front-matter field drives both;
 * this pins the helper, the page list and the two consumers.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isNoindexFrontMatter } from './noindex'

const docs = resolve(__dirname, '..')

describe('isNoindexFrontMatter', () => {
  it('reads the object form and the string form', () => {
    expect(isNoindexFrontMatter({ robots: { index: false, follow: true } })).toBe(true)
    expect(isNoindexFrontMatter({ robots: 'noindex, follow' })).toBe(true)
    expect(isNoindexFrontMatter({ robots: { index: true } })).toBe(false)
    expect(isNoindexFrontMatter({ robots: 'index, follow' })).toBe(false)
    expect(isNoindexFrontMatter({ title: 'x' })).toBe(false)
    expect(isNoindexFrontMatter(undefined)).toBe(false)
  })
})

/**
 * The maintainer runbooks, the credits page, and the docs of every console
 * route navRegistry marks operatorOnly (pages about Mushi Mushi's own
 * machinery that a builder's console never shows, ADR 0052 / 0058).
 */
const OPERATOR_PAGES = [
  'operating/index',
  'operating/ci-runners',
  'operating/deployment',
  'operating/status',
  'admin/credits',
  'admin/skill-pipelines',
  'admin/ux-runs',
  'admin/iterate',
  'admin/fullstack-audit',
  'admin/ci',
  'admin/health',
  'admin/design',
  'admin/judge',
  'admin/prompt-lab',
  'admin/experiments',
  'admin/research',
  'admin/queue',
  'admin/query',
]

/** The YAML front matter block of a content page. */
function frontMatterText(page: string): string {
  const src = readFileSync(resolve(docs, 'content', `${page}.mdx`), 'utf8')
  const end = src.indexOf('\n---\n', 4)
  return src.slice(4, end)
}

describe('operator-only pages', () => {
  it.each(OPERATOR_PAGES)('%s sets robots index: false, follow: true', (page) => {
    expect(frontMatterText(page)).toMatch(/^robots:\n {2}index: false\n {2}follow: true$/m)
  })

  it('buyer pages stay indexable', () => {
    for (const page of ['quickstart/index', 'how-it-works', 'pricing', 'admin/journeys', 'self-hosting/index']) {
      expect(frontMatterText(page), page).not.toMatch(/^robots:/m)
    }
  })
})

describe('the consumers', () => {
  it('the sitemap skips a page whose front matter (or folder index) is noindex', () => {
    const sitemap = readFileSync(resolve(docs, 'app/sitemap.ts'), 'utf8')
    expect(sitemap).toContain("import { isNoindexFrontMatter } from '../lib/noindex'")
    expect(sitemap).toContain('const frontMatter = frontMatterOf(index ?? item)')
    expect(sitemap).toContain('!isNoindexFrontMatter(frontMatter)')
  })

  it('every docs page spreads its front matter into metadata, so robots reaches the <meta> tag', () => {
    const page = readFileSync(resolve(docs, 'app/[[...mdxPath]]/page.tsx'), 'utf8')
    expect(page).toContain('return { ...metadata, alternates }')
    const blog = page.slice(page.indexOf('const post = blogPostMeta('))
    expect(blog).toContain('...metadata,')
  })
})
