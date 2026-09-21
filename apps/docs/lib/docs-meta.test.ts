/**
 * Guards for what search engines, answer engines and share cards read from
 * the docs — and for install claims a reader cannot act on.
 *
 *  - Every non-admin page ships its own `description:`; no two pages share
 *    one. 160 of 191 live pages once served the same site-wide description,
 *    which is what a search snippet or an answer engine quoted for all of them.
 *  - No page tells users to look for key prefixes the server never mints.
 *    Every key is `mushi_` + 32 hex (project-keys.ts, cli-auth.ts), yet pages
 *    told users to check for `mushi_pk_…` / `mushi_live_…` / `mush_pk_…` —
 *    at the exact moment a first report had not arrived.
 *  - No page promises a native registry install that 404s. The iOS, Android
 *    and Flutter SDKs are not on CocoaPods, a SwiftPM release tag or pub.dev
 *    yet. Delete the matching pattern here in the PR that publishes one.
 *  - The landing title/description fit a search result, and the OG card's
 *    declared size is the file's real size.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../../../scripts/lib/frontmatter.mjs'
import { LANDING_META, OG_CARD_HEIGHT, OG_CARD_WIDTH } from './structured-data'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOCS_ROOT = join(__dirname, '..')
const CONTENT = join(DOCS_ROOT, 'content')

function mdxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) mdxFiles(full, out)
    else if (entry.endsWith('.mdx')) out.push(full)
  }
  return out
}

const pages = mdxFiles(CONTENT).map((file) => {
  const source = readFileSync(file, 'utf8')
  return {
    rel: relative(CONTENT, file).replace(/\\/g, '/'),
    source,
    description: parseFrontmatter(source).data.description?.trim() ?? '',
  }
})

/** Search results cut descriptions a little past 155 characters. */
const MAX_DESCRIPTION = 160

describe('page descriptions', () => {
  it('every page outside the admin-console manual has its own description', () => {
    const missing = pages.filter((p) => !p.rel.startsWith('admin/') && !p.description).map((p) => p.rel)
    expect(missing).toEqual([])
  })

  it('no two pages share a description', () => {
    const seen = new Map<string, string>()
    const dupes: string[] = []
    for (const p of pages) {
      if (!p.description) continue
      const key = p.description.toLowerCase()
      const first = seen.get(key)
      if (first) dupes.push(`${p.rel} duplicates ${first}`)
      else seen.set(key, p.rel)
    }
    expect(dupes).toEqual([])
  })

  it(`descriptions stay within ${MAX_DESCRIPTION} characters`, () => {
    const long = pages
      .filter((p) => [...p.description].length > MAX_DESCRIPTION)
      .map((p) => `${p.rel} (${[...p.description].length})`)
    expect(long).toEqual([])
  })
})

describe('install and credential claims', () => {
  it('never names an API key prefix the server does not mint', () => {
    const phantom = /\bmushi_pk_|\bmushi_live_|\bmush_pk_/
    expect(pages.filter((p) => phantom.test(p.source)).map((p) => p.rel)).toEqual([])
  })

  it('does not promise native registry installs that do not exist yet', () => {
    const unpublished: ReadonlyArray<[string, RegExp]> = [
      ['CocoaPods pod', /pod\s+['"]MushiMushi['"]/],
      ['pub.dev version constraint', /mushi_mushi:\s*[\^~]?\d/],
      ['pub.dev package page', /pub\.dev\/packages\/mushi_mushi/],
      ['SwiftPM release version', /mushi-mushi(?:\.git)?["']\s*,\s*from:/],
    ]
    const hits: string[] = []
    for (const p of pages) {
      for (const [label, re] of unpublished) if (re.test(p.source)) hits.push(`${p.rel}: ${label}`)
    }
    expect(hits).toEqual([])
  })
})

describe('landing metadata and share card', () => {
  it('keeps the landing title and description inside search-result limits', () => {
    expect(LANDING_META.title.length).toBeLessThanOrEqual(60)
    expect(LANDING_META.description.length).toBeLessThanOrEqual(155)
  })

  it('declares the OG card at its real pixel size', () => {
    const png = readFileSync(join(DOCS_ROOT, 'public', 'social-preview', 'og-card.png'))
    // PNG signature (8 bytes), IHDR length + type (8 bytes), then width and height.
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({
      width: OG_CARD_WIDTH,
      height: OG_CARD_HEIGHT,
    })
  })
})
