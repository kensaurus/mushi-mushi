/**
 * Tests for the helpers behind the generated agent surfaces
 * (scripts/gen-llms-txt.mjs, scripts/generate-llms-full.mjs) and for the
 * shape of what they write into public/.
 *
 *  - Front matter is read as YAML, so a title with an apostrophe survives
 *    ("Here's what the data said" used to come out as "Here").
 *  - MDX-only syntax — multi-line imports, `{EXPRESSION}` lines, `{/* *\/}`
 *    comments, bracket residue of stripped JSX — never reaches the Markdown,
 *    while fenced code is copied untouched.
 *  - llms-full.txt leads with getting started and ends with the admin manual,
 *    llms-ctx.txt stays under 50 KB, and no twin outlives its page.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildRssFeed, escapeXml } from '../../../scripts/lib/blog-feed.mjs'
import { parseFrontmatter } from '../../../scripts/lib/frontmatter.mjs'
import { mdxToPlainMarkdown } from '../../../scripts/lib/mdx-prose.mjs'
import { BLOG_FEED_URL, blogPostingJsonLd } from './structured-data'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, '..', 'public')

describe('parseFrontmatter', () => {
  it('keeps apostrophes in plain, single- and double-quoted scalars', () => {
    const { data, body } = parseFrontmatter(
      [
        '---',
        `title: "I shipped a bug tool and got 9 signups. Here's what the data said."`,
        "description: 'It''s a single-quoted value: with a colon'",
        "slug: plain value it's fine # trailing comment",
        'date: 2026-09-21',
        '---',
        '',
        '# Heading',
      ].join('\n'),
    )
    expect(data.title).toBe("I shipped a bug tool and got 9 signups. Here's what the data said.")
    expect(data.description).toBe("It's a single-quoted value: with a colon")
    expect(data.slug).toBe("plain value it's fine")
    expect(data.date).toBe('2026-09-21')
    expect(body).toBe('\n# Heading')
  })

  it('reads folded and literal block scalars and skips nested values', () => {
    const { data } = parseFrontmatter(
      ['---', 'description: >-', '  one', '  two', 'theme:', '  toc: false', 'notes: |', '  a', '  b', '---', 'x'].join('\n'),
    )
    expect(data).toEqual({ description: 'one two', notes: 'a\nb' })
  })

  it('handles CRLF files and files without front matter', () => {
    expect(parseFrontmatter("---\r\ntitle: 'Win'\r\n---\r\nbody").data.title).toBe('Win')
    expect(parseFrontmatter('# No front matter')).toEqual({ data: {}, body: '# No front matter' })
    expect(parseFrontmatter('---\ntitle: never closed')).toEqual({ data: {}, body: '---\ntitle: never closed' })
  })
})

describe('mdxToPlainMarkdown', () => {
  const src = [
    '---',
    'title: Page',
    '---',
    '',
    'import { Callout } from "nextra/components"',
    'import {',
    '  LANDING_HERO,',
    '  LANDING_FAQ,',
    "} from '@/lib/landing-copy'",
    '',
    '{/* a comment',
    '    over two lines */}',
    '',
    '{LANDING_HERO.lead}',
    '',
    '<Callout type="info">Keep this prose.</Callout>',
    '',
    '<Checklist items={[',
    '  {',
    "    id: 'a',",
    '  },',
    ']}/>',
    '',
    '```tsx',
    "import { MushiProvider } from '@mushi-mushi/react'",
    '{children}',
    '```',
    '',
    'Import edges are drawn as arrows.',
  ].join('\n')
  const out = mdxToPlainMarkdown(src)

  it('drops MDX imports, comments and expression-only lines from prose', () => {
    expect(out).not.toMatch(/from ["']nextra\/components["']/)
    expect(out).not.toContain('LANDING_FAQ')
    expect(out).not.toContain('a comment')
    expect(out).not.toContain('{LANDING_HERO.lead}')
  })

  it('drops bracket-only residue of stripped JSX but keeps prose', () => {
    expect(out).toContain('Keep this prose.')
    expect(out).toContain('Import edges are drawn as arrows.')
    for (const line of out.split('\n').filter((l) => !l.includes('children'))) {
      expect(line.trim()).not.toMatch(/^[{}()[\],;]+$/)
    }
  })

  it('copies fenced code verbatim', () => {
    expect(out).toContain("```tsx\nimport { MushiProvider } from '@mushi-mushi/react'\n{children}\n```")
  })
})

describe('blog feed and BlogPosting', () => {
  const feed = buildRssFeed({
    title: 'Blog',
    link: 'https://example.test/blog',
    description: 'Notes & numbers',
    feedUrl: 'https://example.test/blog/feed.xml',
    author: 'Kenji Sakuramoto',
    posts: [
      { title: 'Old', url: 'https://example.test/blog/old', date: '2026-06-17' },
      { title: 'Undated', url: 'https://example.test/blog/undated' },
      { title: "Here's <new>", url: 'https://example.test/blog/new', description: 'A & B', date: '2026-09-21' },
    ],
  })

  it('escapes text and orders dated posts newest first, undated last', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;')
    expect(feed).toContain('<title>Here&apos;s &lt;new&gt;</title>')
    expect(feed).toContain('<description>A &amp; B</description>')
    const order = [...feed.matchAll(/<item>\s*<title>([^<]+)<\/title>/g)].map((m) => m[1])
    expect(order).toEqual(['Here&apos;s &lt;new&gt;', 'Old', 'Undated'])
  })

  it('uses the newest post for lastBuildDate so regenerating is deterministic', () => {
    expect(feed).toContain(`<lastBuildDate>${new Date('2026-09-21').toUTCString()}</lastBuildDate>`)
    expect(feed).toContain('<atom:link href="https://example.test/blog/feed.xml" rel="self" type="application/rss+xml"/>')
  })

  it('builds BlogPosting JSON-LD with the publish date only when the post has one', () => {
    const dated = blogPostingJsonLd({
      title: 'Post',
      url: 'https://kensaur.us/mushi-mushi/docs/blog/post',
      datePublished: new Date('2026-09-21'),
    })
    expect(dated).toMatchObject({ '@type': 'BlogPosting', headline: 'Post', datePublished: '2026-09-21T00:00:00.000Z' })
    expect(blogPostingJsonLd({ title: 'Post', url: 'https://x.test' })).not.toHaveProperty('datePublished')
  })
})

describe('generated files in public/', () => {
  it('blog/feed.xml lists the dated posts', () => {
    const xml = readFileSync(join(PUBLIC_DIR, 'blog', 'feed.xml'), 'utf8')
    expect(xml).toContain(`<atom:link href="${BLOG_FEED_URL}"`)
    expect(xml).toContain('<link>https://kensaur.us/mushi-mushi/docs/blog/nine-signups-what-the-data-said</link>')
  })

  it('llms.txt keeps full titles and adds page descriptions', () => {
    const txt = readFileSync(join(PUBLIC_DIR, 'llms.txt'), 'utf8')
    expect(txt).toContain("Here's what the data said.](")
    expect(txt).toMatch(/^- \[Pricing\]\(https:\/\/kensaur\.us\/mushi-mushi\/docs\/pricing\): \S/m)
    expect(txt).toMatch(/^- \[MCP tools reference\]\(https:\/\/kensaur\.us\/mushi-mushi\/docs\/sdks\/mcp-tools\)/m)
    expect(txt).not.toContain('mcp-tools.generated')
  })

  it('llms-full.txt puts getting started first and the admin manual last', () => {
    const full = readFileSync(join(PUBLIC_DIR, 'llms-full.txt'), 'utf8')
    const at = (path: string) => full.indexOf(`Source: https://kensaur.us/mushi-mushi/docs${path}\n`)
    const sources = [...full.matchAll(/^Source: (\S+)$/gm)].map((m) => m[1] ?? '')
    expect(at('/quickstart/incident-loop')).toBeGreaterThan(-1)
    expect(at('/quickstart/incident-loop')).toBeLessThan(at('/pricing'))
    expect(at('/pricing')).toBeLessThan(at('/sdks/web'))
    expect(at('/sdks/web')).toBeLessThan(at('/admin'))
    const firstAdmin = sources.findIndex((s) => s.includes('/docs/admin'))
    expect(sources.slice(firstAdmin).every((s) => s.includes('/docs/admin'))).toBe(true)
  })

  it('llms-ctx.txt exists and stays under 50 KB', () => {
    const ctx = join(PUBLIC_DIR, 'llms-ctx.txt')
    expect(existsSync(ctx)).toBe(true)
    expect(statSync(ctx).size).toBeLessThan(50 * 1024)
    expect(readFileSync(ctx, 'utf8')).toContain('Source: https://kensaur.us/mushi-mushi/docs/quickstart/incident-loop')
  })

  it('no Markdown twin outlives a renamed page', () => {
    expect(existsSync(join(PUBLIC_DIR, 'llm-md', 'sdks', 'mcp-tools.generated.md'))).toBe(false)
    expect(existsSync(join(PUBLIC_DIR, 'llm-md', 'sdks', 'mcp-tools.md'))).toBe(true)
  })
})
