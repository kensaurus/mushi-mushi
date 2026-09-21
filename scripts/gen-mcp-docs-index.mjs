#!/usr/bin/env node
/**
 * FILE: scripts/gen-mcp-docs-index.mjs
 * PURPOSE: Generate the static docs index that backs the `search_mushi_docs`
 *          MCP tool, in BOTH transports:
 *
 *            • packages/mcp/src/docs-index.ts                      (stdio, npm)
 *            • packages/server/supabase/functions/mcp/docs-index.ts (hosted, Deno)
 *
 *          Source of truth is `apps/docs/public/llms.txt` (itself generated
 *          from apps/docs/content by scripts/gen-llms-txt.mjs), so every URL
 *          the tool can return is a page that exists. Excerpts come from each
 *          page's frontmatter `description:` or, failing that, its first prose
 *          paragraph. Keywords are derived from the route, the title, and the
 *          short aliases llms.txt uses in its "Start here" sections.
 *
 *          Why: the previous hand-maintained arrays pointed at /guides/* and
 *          /reference/* which never existed under apps/docs/content — every
 *          agent that called search_mushi_docs got dead links (GTM plan,
 *          Workstream C finding #1).
 *
 * Usage:
 *   node scripts/gen-mcp-docs-index.mjs            # write both files
 *   node scripts/gen-mcp-docs-index.mjs --check    # CI: exit 1 when stale
 *
 * Run `pnpm gen:llms-txt` first if you added or renamed a docs page.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripMarkupToFixpoint } from './lib/strip-markup.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LLMS_TXT = path.join(ROOT, 'apps/docs/public/llms.txt')
const CONTENT = path.join(ROOT, 'apps/docs/content')
const OUTPUTS = [
  'packages/mcp/src/docs-index.ts',
  'packages/server/supabase/functions/mcp/docs-index.ts',
]

const checkMode = process.argv.includes('--check')
const EXCERPT_MAX = 180
const KEYWORD_MAX = 12

// ─── 1. Parse llms.txt ───────────────────────────────────────────────────────

const llmsSrc = readFileSync(LLMS_TXT, 'utf8').replace(/\r\n/g, '\n')
const baseMatch = llmsSrc.match(/^Canonical docs:\s*(\S+)\s*$/m)
if (!baseMatch) {
  console.error('FAIL  llms.txt has no "Canonical docs:" line — cannot derive the docs base URL')
  process.exit(1)
}
const BASE = baseMatch[1].replace(/\/+$/, '')

/** @type {Map<string, { title: string, aliases: Set<string>, section: string }>} */
const pages = new Map()
let section = ''
for (const line of llmsSrc.split('\n')) {
  const h = line.match(/^##\s+(.+)$/)
  if (h) {
    section = h[1].trim()
    continue
  }
  // llmstxt.org entry: `- [title](url)` with an optional `: notes` suffix.
  const m = line.match(/^- \[([^\]]+)\]\((\S+)\)(?::\s.*)?\s*$/)
  if (!m) continue
  const [, title, url] = m
  if (!url.startsWith(BASE)) continue
  const existing = pages.get(url)
  if (section === 'All pages') {
    // Canonical title wins; anything seen earlier becomes an alias.
    const aliases = existing?.aliases ?? new Set()
    if (existing && existing.title !== title) aliases.add(existing.title)
    pages.set(url, { title, aliases, section })
  } else if (existing) {
    if (existing.title !== title) existing.aliases.add(title)
  } else {
    pages.set(url, { title, aliases: new Set(), section })
  }
}

if (pages.size === 0) {
  console.error('FAIL  llms.txt yielded no docs pages — is it generated? (pnpm gen:llms-txt)')
  process.exit(1)
}

// ─── 2. Resolve each page to its MDX source and derive excerpt + keywords ────

function routeOf(url) {
  const rest = url.slice(BASE.length)
  return rest === '' ? '/' : rest
}

function mdxFileFor(route) {
  const rel = route === '/' ? 'index' : route.replace(/^\//, '')
  const candidates = [path.join(CONTENT, `${rel}.mdx`), path.join(CONTENT, rel, 'index.mdx')]
  return candidates.find((p) => existsSync(p)) ?? null
}

function frontmatterDescription(src) {
  const fm = src.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fm) return null
  const d = fm[1].match(/^description:\s*(?:>-?\s*\n((?:[ \t]+.*\n?)+)|['"]?(.+?)['"]?\s*$)/m)
  if (!d) return null
  const raw = d[1] ? d[1].replace(/\n[ \t]+/g, ' ').replace(/^[ \t]+/, '') : d[2]
  return raw.trim()
}

function stripMdxBody(src) {
  // Markup removal runs to a fixpoint (see lib/strip-markup.mjs): one pass can
  // splice the text either side of a removed tag into a fresh tag.
  return stripMarkupToFixpoint(
    src
      .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
      .replace(/^import\s.+from\s+['"].+['"]\s*;?\s*$/gm, '')
      .replace(/^export\s+(?:default\s+)?(?:const|function|class)\s.*/gm, '')
      .replace(/```[\s\S]*?```/g, ''),
  )
}

function firstParagraph(src) {
  const body = stripMdxBody(src)
  const blocks = body.split(/\n\s*\n/)
  for (const block of blocks) {
    const text = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
    if (!text) continue
    if (/^[#|>{<\-*]/.test(text)) continue // heading, table, callout, JSX expr, list
    if (/^\d+\.\s/.test(text)) continue // ordered list
    if (/^\{.*\}$/.test(text)) continue // bare MDX expression
    const clean = text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
      .replace(/[`*_]/g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (clean.length < 20) continue
    return clean
  }
  return null
}

function truncate(text, max) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.\s]+$/, '')}…`
}

const STOP = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'your', 'you', 'or', 'is', 'at',
  'by', 'vs', 'from', 'it', 'as', 'how', 'why', 'what', 'into', 'up', 'mushi', 'docs',
])

function words(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9@/.\-\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[./-]+|[./-]+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
}

function keywordsFor(route, title, aliases, section) {
  const out = []
  const push = (k) => {
    if (k && !out.includes(k)) out.push(k)
  }
  const segments = route.split('/').filter(Boolean)
  for (const seg of segments) {
    push(seg)
    for (const part of seg.split('-')) if (part.length > 2 && !STOP.has(part)) push(part)
  }
  for (const w of words(title)) push(w)
  for (const alias of aliases) for (const w of words(alias)) push(w)
  if (section && section !== 'All pages') for (const w of words(section)) push(w)
  return out.slice(0, KEYWORD_MAX)
}

const entries = []
const missingSources = []
let fromFrontmatter = 0
for (const [url, meta] of pages) {
  const route = routeOf(url)
  const file = mdxFileFor(route)
  if (!file) {
    // App routes (apps/docs/app/connect/page.tsx) have no MDX to index; any
    // other link without a source means llms.txt is stale.
    if (!existsSync(path.join(ROOT, 'apps/docs/app', ...route.split('/').filter(Boolean), 'page.tsx'))) {
      missingSources.push(url)
    }
    continue
  }
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const fm = frontmatterDescription(src)
  if (fm) fromFrontmatter++
  const excerpt = truncate(
    fm ?? firstParagraph(src) ?? `${meta.title} — Mushi Mushi docs (${route})`,
    EXCERPT_MAX,
  )
  entries.push({
    title: meta.title,
    route,
    keywords: keywordsFor(route, meta.title, meta.aliases, meta.section),
    excerpt,
  })
}

if (missingSources.length > 0) {
  console.error(`FAIL  ${missingSources.length} llms.txt page(s) have no apps/docs/content source:`)
  for (const u of missingSources) console.error(`      ${u}`)
  console.error('      Run `pnpm gen:llms-txt` to resync llms.txt with the content tree.')
  process.exit(1)
}

entries.sort((a, b) => a.route.localeCompare(b.route))

// ─── 3. Render the TypeScript module (identical for Node and Deno) ───────────

const q = (s) => JSON.stringify(s)

function render() {
  const lines = [
    '// GENERATED — do not edit.',
    '// Source: apps/docs/public/llms.txt + apps/docs/content/**/*.mdx',
    '// Regenerate: node scripts/gen-mcp-docs-index.mjs   (CI: --check)',
    '',
    '/**',
    ' * Static index behind the `search_mushi_docs` MCP tool. Every path is a',
    ' * page that exists in the docs site at generation time, so the tool can',
    ' * never hand an agent a dead link. Keep this file in lock-step across the',
    ' * stdio (packages/mcp) and hosted (functions/mcp) servers by regenerating',
    ' * — never by hand-editing one copy.',
    ' */',
    '',
    'export interface DocIndexEntry {',
    '  title: string',
    '  path: string',
    '  keywords: string[]',
    '  excerpt: string',
    '}',
    '',
    `const BASE = ${q(BASE)}`,
    '',
    'function docPath(suffix: string): string {',
    "  return suffix === '/' ? BASE : BASE + suffix",
    '}',
    '',
    `/** ${entries.length} pages, generated from llms.txt. */`,
    'export const MUSHI_DOCS_INDEX: DocIndexEntry[] = [',
  ]
  for (const e of entries) {
    lines.push('  {')
    lines.push(`    title: ${q(e.title)},`)
    lines.push(`    path: docPath(${q(e.route)}),`)
    lines.push(`    keywords: [${e.keywords.map(q).join(', ')}],`)
    lines.push(`    excerpt: ${q(e.excerpt)},`)
    lines.push('  },')
  }
  lines.push(']')
  lines.push('')
  lines.push(
    ...`export function searchMushiDocs(query: string, limit = 8): Array<DocIndexEntry & { score: number }> {
  const q = query.trim().toLowerCase()
  if (!q) {
    return MUSHI_DOCS_INDEX.slice(0, limit).map((e) => ({ ...e, score: 0 }))
  }
  const terms = q.split(/\\s+/).filter(Boolean)
  const scored = MUSHI_DOCS_INDEX.map((entry) => {
    const title = entry.title.toLowerCase()
    const hay = (entry.title + ' ' + entry.keywords.join(' ') + ' ' + entry.excerpt).toLowerCase()
    let score = 0
    for (const term of terms) {
      if (title.includes(term)) score += 4
      if (entry.keywords.some((k) => k === term)) score += 4
      else if (entry.keywords.some((k) => k.includes(term))) score += 2
      if (hay.includes(term)) score += 1
    }
    // Every term matched somewhere → strong signal the page is about the query.
    if (terms.length > 1 && terms.every((t) => hay.includes(t))) score += 3
    // Shallow routes (quickstart, sdks) are the pages agents usually want first.
    if (score > 0 && entry.path.split('/').length <= BASE.split('/').length + 2) score += 1
    return { ...entry, score }
  })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  return scored.slice(0, limit)
}
`.split('\n'),
  )
  return lines.join('\n')
}

const output = render()

// ─── 4. Write or check ───────────────────────────────────────────────────────

let stale = 0
for (const rel of OUTPUTS) {
  const abs = path.join(ROOT, rel)
  if (checkMode) {
    let existing
    try {
      existing = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
    } catch {
      console.error(`FAIL  ${rel} missing — run: node scripts/gen-mcp-docs-index.mjs`)
      stale++
      continue
    }
    if (existing !== output) {
      console.error(`FAIL  ${rel} is stale — run: node scripts/gen-mcp-docs-index.mjs`)
      stale++
    }
  } else {
    writeFileSync(abs, output, 'utf8')
    console.log(`Wrote ${rel}`)
  }
}

const summary = `${entries.length} pages · ${fromFrontmatter} excerpts from frontmatter · ${
  entries.length - fromFrontmatter
} from first paragraph`
if (checkMode) {
  if (stale > 0) process.exit(1)
  console.log(`docs-index OK (${summary})`)
} else {
  console.log(summary)
}
