/**
 * Tests for LLM docs parity — validates that llms.txt, llms-full.txt, and
 * the content/MDX tree stay in sync.
 *
 * Verifies:
 *  - llms.txt exists and is non-empty
 *  - llms-full.txt exists and is substantially larger than llms.txt
 *  - llms-full.txt covers all pages referenced in llms.txt (by URL slug)
 *  - llms-full.txt opens with the expected header marker
 *  - The .md twins directory exists and is non-empty
 *  - No MDX file in content/ is zero-bytes
 *  - llms-full.txt page count matches the MDX file count in content/
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOCS_ROOT = join(__dirname, '..')
const PUBLIC_DIR = join(DOCS_ROOT, 'public')
const CONTENT_DIR = join(DOCS_ROOT, 'content')
const LLMS_TXT = join(PUBLIC_DIR, 'llms.txt')
const LLMS_FULL_TXT = join(PUBLIC_DIR, 'llms-full.txt')
const MD_TWINS_DIR = join(PUBLIC_DIR, 'llm-md')

// ── helpers ───────────────────────────────────────────────────────────────────

function collectFiles(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectFiles(full, ext, out)
    else if (entry.endsWith(ext)) out.push(full)
  }
  return out
}

function extractLlmsLinks(txt: string): string[] {
  const links: string[] = []
  for (const m of txt.matchAll(/\(https?:\/\/[^)]+\/docs(\/[^)]+)?\)/g)) {
    const path = (m[1] ?? '').replace(/\/$/, '') || '/'
    links.push(path)
  }
  return [...new Set(links)]
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('llms.txt', () => {
  it('exists in public/', () => {
    expect(existsSync(LLMS_TXT)).toBe(true)
  })

  it('is non-empty (>= 1 KB)', () => {
    const txt = readFileSync(LLMS_TXT, 'utf8')
    expect(txt.length).toBeGreaterThan(1024)
  })

  it('starts with a # header', () => {
    const txt = readFileSync(LLMS_TXT, 'utf8')
    expect(txt.trimStart()).toMatch(/^#\s/)
  })

  it('contains at least 30 unique page links', () => {
    const txt = readFileSync(LLMS_TXT, 'utf8')
    const links = extractLlmsLinks(txt)
    expect(links.length).toBeGreaterThanOrEqual(30)
  })
})

describe('llms-full.txt', () => {
  it('exists in public/', () => {
    expect(existsSync(LLMS_FULL_TXT)).toBe(true)
  })

  it('is at least 10× larger than llms.txt', () => {
    const compact = statSync(LLMS_TXT).size
    const full = statSync(LLMS_FULL_TXT).size
    expect(full).toBeGreaterThan(compact * 10)
  })

  it('starts with the expected header marker', () => {
    const txt = readFileSync(LLMS_FULL_TXT, 'utf8')
    expect(txt).toContain('# Mushi Mushi — full documentation dump')
  })

  it('contains a "Pages:" count line', () => {
    const txt = readFileSync(LLMS_FULL_TXT, 'utf8')
    expect(txt).toMatch(/^Pages:\s+\d+/m)
  })

  it('page count matches MDX file count in content/', () => {
    const mdxFiles = collectFiles(CONTENT_DIR, '.mdx')
    const txt = readFileSync(LLMS_FULL_TXT, 'utf8')
    const m = txt.match(/^Pages:\s+(\d+)/m)
    expect(m).not.toBeNull()
    const reportedCount = parseInt(m![1]!, 10)
    // Allow ±1 for the root index.mdx (may or may not be counted differently)
    expect(Math.abs(reportedCount - mdxFiles.length)).toBeLessThanOrEqual(1)
  })

  it('covers all pages referenced in llms.txt (by URL slug)', () => {
    const llmsTxt = readFileSync(LLMS_TXT, 'utf8')
    const fullTxt = readFileSync(LLMS_FULL_TXT, 'utf8')
    const links = extractLlmsLinks(llmsTxt)
    const missing: string[] = []
    for (const slug of links) {
      // The llms-full.txt contains "Source: https://…/docs<slug>"
      const expected = `kensaur.us/mushi-mushi/docs${slug === '/' ? '' : slug}`
      if (!fullTxt.includes(expected)) missing.push(slug)
    }
    expect(missing, `These llms.txt slugs missing from llms-full.txt: ${missing.join(', ')}`).toHaveLength(0)
  })
})

describe('.md twins (public/llm-md/)', () => {
  it('directory exists after generate-llms-full.mjs runs', () => {
    expect(existsSync(MD_TWINS_DIR)).toBe(true)
  })

  it('contains at least 100 .md files', () => {
    const mdFiles = collectFiles(MD_TWINS_DIR, '.md')
    expect(mdFiles.length).toBeGreaterThanOrEqual(100)
  })

  it('each .md twin starts with a # header', () => {
    const mdFiles = collectFiles(MD_TWINS_DIR, '.md').slice(0, 20) // spot-check first 20
    for (const f of mdFiles) {
      const content = readFileSync(f, 'utf8')
      expect(content.trimStart(), `${relative(MD_TWINS_DIR, f)} should start with # header`).toMatch(/^#\s/)
    }
  })

  it('each .md twin has a "Source:" URL line', () => {
    const mdFiles = collectFiles(MD_TWINS_DIR, '.md').slice(0, 20)
    for (const f of mdFiles) {
      const content = readFileSync(f, 'utf8')
      expect(content, `${relative(MD_TWINS_DIR, f)} should have Source: line`).toContain('Source: https://')
    }
  })
})

describe('MDX content/ health', () => {
  it('no MDX file is zero-bytes', () => {
    const mdxFiles = collectFiles(CONTENT_DIR, '.mdx')
    const empty = mdxFiles.filter(f => statSync(f).size === 0)
    expect(empty, `Zero-byte MDX files: ${empty.map(f => relative(CONTENT_DIR, f)).join(', ')}`).toHaveLength(0)
  })

  it('at least 100 MDX files exist', () => {
    const mdxFiles = collectFiles(CONTENT_DIR, '.mdx')
    expect(mdxFiles.length).toBeGreaterThanOrEqual(100)
  })
})
