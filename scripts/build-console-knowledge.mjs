#!/usr/bin/env node
/**
 * FILE: scripts/build-console-knowledge.mjs
 * PURPOSE: Compile console help corpus (recipes + route page docs) for the NL assistant index.
 *
 * OVERVIEW:
 * - Reads recipe markdown from packages/server/console-knowledge/recipes/
 * - Loads STATIC_ROUTES from apps/admin/src/lib/searchIndex.ts via jiti. The
 *   palette routes are derived from navRegistry at runtime (buildStaticRoutes),
 *   so there are no literals left to regex out of the file; importing the
 *   module is the only way to see what the command palette actually shows.
 * - Emits console-knowledge-corpus.json for the edge-function builder
 * - Emits console-routes.generated.ts (canonical route directory for LLM nav validation)
 *
 * USAGE:
 *   node scripts/build-console-knowledge.mjs           # write both files
 *   node scripts/build-console-knowledge.mjs --check   # CI: exit 1 when stale
 *
 * The corpus carries a `generatedAt` stamp, so write mode leaves the JSON
 * untouched when its docs are unchanged, and --check compares docs only.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CHECK_MODE = process.argv.includes('--check')

const RECIPES_DIR = join(ROOT, 'packages/server/console-knowledge/recipes')
const SEARCH_INDEX = join(ROOT, 'apps/admin/src/lib/searchIndex.ts')
const CORPUS_OUT = join(
  ROOT,
  'packages/server/supabase/functions/_shared/console-knowledge-corpus.json',
)
const ROUTES_OUT = join(
  ROOT,
  'packages/server/supabase/functions/_shared/console-routes.generated.ts',
)

/** @typedef {{ id: string, label: string, path: string, description: string, group: string, keywords: string[] }} StaticRoute */

/**
 * Load STATIC_ROUTES from searchIndex.ts. The module (and navRegistry, which
 * it calls) only has type imports, so jiti can evaluate it under plain Node.
 * Same pattern as scripts/generate-config-reference.mjs.
 *
 * This used to regex-parse `{ id: '…', label: '…' }` literals out of the file.
 * Those literals moved into navRegistry in June 2026 (#230); the regex then
 * matched nothing and the script threw before writing, so the committed corpus
 * stayed at its 2026-06-16 snapshot until this was fixed.
 */
async function loadStaticRoutes() {
  const jiti = createJiti(import.meta.url, { interopDefault: true })
  const mod = await jiti.import(SEARCH_INDEX)
  const routes = mod?.STATIC_ROUTES
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error(`STATIC_ROUTES missing or empty in ${relative(ROOT, SEARCH_INDEX)}`)
  }
  for (const r of routes) {
    const ok =
      typeof r?.id === 'string' &&
      typeof r.label === 'string' &&
      typeof r.path === 'string' &&
      r.path.startsWith('/') &&
      typeof r.description === 'string' &&
      typeof r.group === 'string' &&
      Array.isArray(r.keywords) &&
      r.keywords.every((k) => typeof k === 'string')
    if (!ok) throw new Error(`Malformed STATIC_ROUTES entry: ${JSON.stringify(r)}`)
  }
  return routes.map(({ id, label, path, description, group, keywords }) => ({
    id,
    label,
    path,
    description,
    group,
    keywords: [...keywords],
  }))
}

/**
 * Corpus key for a route's page doc. Palette entries can share a base path and
 * differ only by query (/skills, /skills?tab=catalog, /skills?tab=sources), and
 * console-knowledge-build upserts on (doc_path, section), so the query has to
 * be part of the key or the tabs overwrite each other and only one survives.
 */
function pageDocPath(path) {
  const [base, query] = path.split('?')
  const stem = base.replace(/\/$/, '') || '/index'
  const suffix = query ? `--${query.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` : ''
  return `pages${stem}${suffix}.md`
}

/** Parse YAML frontmatter from a recipe markdown file. */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: raw }
  const meta = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (!kv) continue
    const [, key, val] = kv
    if (val.startsWith('[')) {
      meta[key] = [...val.matchAll(/"([^"]+)"|'([^']+)'|(\/[^\s,\]]+)/g)].map(
        (x) => x[1] ?? x[2] ?? x[3],
      )
    } else {
      meta[key] = val.replace(/^["']|["']$/g, '')
    }
  }
  return { meta, body: match[2].trim() }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function chunkBody(body, maxChars = 1200) {
  const paragraphs = body.split(/\n\n+/).filter((p) => p.trim())
  const chunks = []
  let buf = ''
  for (const p of paragraphs) {
    if (buf.length + p.length + 2 > maxChars && buf.length > 0) {
      chunks.push(buf.trim())
      buf = p
    } else {
      buf = buf ? `${buf}\n\n${p}` : p
    }
  }
  if (buf.trim()) chunks.push(buf.trim())
  return chunks.length ? chunks : [body.slice(0, maxChars)]
}

async function buildCorpus() {
  /** @type {Array<{ doc_path: string, section: string, title: string, body: string, route_path: string | null, kind: string, content_hash: string }>} */
  const docs = []

  // Recipe docs (sorted: readdir order differs between NTFS and ext4, and
  // --check must produce the same corpus on a dev laptop and in CI)
  for (const file of readdirSync(RECIPES_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const raw = readFileSync(join(RECIPES_DIR, file), 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    const docPath = `recipes/${file}`
    const title = meta.title ?? file.replace(/\.md$/, '')
    const routes = Array.isArray(meta.routes) ? meta.routes : []
    const primaryRoute = routes[0] ?? null
    const chunks = chunkBody(body)
    chunks.forEach((chunk, i) => {
      const section = chunks.length === 1 ? 'main' : `part-${i + 1}`
      docs.push({
        doc_path: docPath,
        section,
        title,
        body: chunk,
        route_path: primaryRoute,
        kind: meta.kind ?? 'recipe',
        content_hash: sha256(`${docPath}:${section}:${chunk}`),
      })
    })
  }

  // Per-route page docs from STATIC_ROUTES
  const routes = await loadStaticRoutes()
  for (const r of routes) {
    const body = [
      `# ${r.label}`,
      '',
      r.description,
      '',
      `Route: ${r.path}`,
      `Section: ${r.group}`,
      '',
      'Keywords: ' + r.keywords.join(', '),
      '',
      'Use this page when the user asks about: ' + r.keywords.slice(0, 6).join(', '),
    ].join('\n')
    docs.push({
      doc_path: pageDocPath(r.path),
      section: 'main',
      title: r.label,
      body,
      route_path: r.path.split('?')[0],
      kind: 'page',
      content_hash: sha256(`page:${r.path}:${body}`),
    })
  }

  // console-knowledge-build upserts on (doc_path, section): a repeated key
  // silently keeps whichever row is written last.
  const seen = new Map()
  for (const d of docs) {
    const key = `${d.doc_path}::${d.section}`
    if (seen.has(key)) {
      throw new Error(`Duplicate corpus key ${key} ("${seen.get(key)}" and "${d.title}")`)
    }
    seen.set(key, d.title)
  }

  return { docs, routes }
}

function renderRoutesTs(routes) {
  const lines = routes.map(
    (r) =>
      `  { path: ${JSON.stringify(r.path.split('?')[0])}, label: ${JSON.stringify(r.label)}, description: ${JSON.stringify(r.description)}, group: ${JSON.stringify(r.group)}, keywords: ${JSON.stringify(r.keywords)} },`,
  )
  return `/**
 * FILE: console-routes.generated.ts
 * PURPOSE: Canonical admin-console route directory for NL assistant nav validation.
 * GENERATED BY: scripts/build-console-knowledge.mjs — do not edit by hand.
 */

export interface ConsoleRouteEntry {
  path: string
  label: string
  description: string
  group: string
  keywords: string[]
}

export const CONSOLE_ROUTES: ConsoleRouteEntry[] = [
${lines.join('\n')}
]

export const CONSOLE_ROUTE_PATHS = new Set(CONSOLE_ROUTES.map((r) => r.path))

export function isValidConsoleRoute(path: string): boolean {
  const base = path.split('?')[0].split('#')[0]
  if (CONSOLE_ROUTE_PATHS.has(base)) return true
  // Dynamic segments: /reports/:id matches /reports/*
  return CONSOLE_ROUTES.some((r) => {
    if (!r.path.includes(':')) return false
    const prefix = r.path.split('/:')[0]
    return base.startsWith(prefix + '/') || base === prefix
  })
}
`
}

const CORPUS_VERSION = 1

function readText(file) {
  return existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null
}

/** The committed corpus's docs, or null when it is missing or unreadable. */
function readCorpusDocs() {
  const raw = readText(CORPUS_OUT)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed?.version === CORPUS_VERSION && Array.isArray(parsed.docs) ? parsed.docs : null
  } catch {
    return null
  }
}

async function main() {
  const { docs, routes } = await buildCorpus()
  const routesTs = renderRoutesTs(routes)
  const committedDocs = readCorpusDocs()
  const corpusFresh = committedDocs !== null && JSON.stringify(committedDocs) === JSON.stringify(docs)
  const routesFresh = readText(ROUTES_OUT) === routesTs

  if (CHECK_MODE) {
    const stale = [
      !corpusFresh && relative(ROOT, CORPUS_OUT),
      !routesFresh && relative(ROOT, ROUTES_OUT),
    ].filter(Boolean)
    if (stale.length > 0) {
      for (const file of stale) console.error(`FAIL  ${file} is stale`)
      console.error('      Run `pnpm build:console-knowledge` and commit the result.')
      process.exit(1)
    }
    console.log(`console-knowledge OK (${docs.length} corpus chunks, ${routes.length} routes)`)
    return
  }

  if (!corpusFresh) {
    mkdirSync(dirname(CORPUS_OUT), { recursive: true })
    writeFileSync(
      CORPUS_OUT,
      JSON.stringify(
        { version: CORPUS_VERSION, generatedAt: new Date().toISOString(), docs },
        null,
        2,
      ),
      'utf8',
    )
  }
  if (!routesFresh) {
    mkdirSync(dirname(ROUTES_OUT), { recursive: true })
    writeFileSync(ROUTES_OUT, routesTs, 'utf8')
  }
  console.log(`${docs.length} corpus chunks, ${routes.length} routes`)
  console.log(`  ${corpusFresh ? 'unchanged' : 'wrote'} → ${relative(ROOT, CORPUS_OUT)}`)
  console.log(`  ${routesFresh ? 'unchanged' : 'wrote'} → ${relative(ROOT, ROUTES_OUT)}`)
}

await main()
