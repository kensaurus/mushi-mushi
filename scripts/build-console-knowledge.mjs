#!/usr/bin/env node
/**
 * FILE: scripts/build-console-knowledge.mjs
 * PURPOSE: Compile console help corpus (recipes + route page docs) for the NL assistant index.
 *
 * OVERVIEW:
 * - Reads recipe markdown from packages/server/console-knowledge/recipes/
 * - Parses STATIC_ROUTES from apps/admin/src/lib/searchIndex.ts
 * - Emits console-knowledge-corpus.json for the edge-function builder
 * - Emits console-routes.generated.ts (canonical route directory for LLM nav validation)
 *
 * USAGE: node scripts/build-console-knowledge.mjs
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

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

/** Parse STATIC_ROUTES array from searchIndex.ts (lightweight regex extraction). */
function parseStaticRoutes() {
  const src = readFileSync(SEARCH_INDEX, 'utf8')
  const start = src.indexOf('export const STATIC_ROUTES')
  if (start === -1) throw new Error('STATIC_ROUTES not found in searchIndex.ts')
  const slice = src.slice(start)
  const routes = []
  const blockRe =
    /\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*path:\s*'([^']+)',\s*description:\s*'([^']*)',\s*group:\s*'([^']+)',\s*keywords:\s*\[([^\]]*)\]/gs
  let m
  while ((m = blockRe.exec(slice)) !== null) {
    const kwRaw = m[6]
    const keywords = [...kwRaw.matchAll(/'([^']+)'/g)].map((x) => x[1])
    routes.push({
      id: m[1],
      label: m[2],
      path: m[3],
      description: m[4],
      group: m[5],
      keywords,
    })
  }
  if (routes.length === 0) throw new Error('No routes parsed from searchIndex.ts')
  return routes
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

function buildCorpus() {
  /** @type {Array<{ doc_path: string, section: string, title: string, body: string, route_path: string | null, kind: string, content_hash: string }>} */
  const docs = []

  // Recipe docs
  for (const file of readdirSync(RECIPES_DIR).filter((f) => f.endsWith('.md'))) {
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
  const routes = parseStaticRoutes()
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
      doc_path: `pages${r.path.replace(/\?.*$/, '').replace(/\/$/, '') || '/index'}.md`,
      section: 'main',
      title: r.label,
      body,
      route_path: r.path.split('?')[0],
      kind: 'page',
      content_hash: sha256(`page:${r.path}:${body}`),
    })
  }

  return { docs, routes }
}

function emitRoutesTs(routes) {
  const lines = routes.map(
    (r) =>
      `  { path: ${JSON.stringify(r.path.split('?')[0])}, label: ${JSON.stringify(r.label)}, description: ${JSON.stringify(r.description)}, group: ${JSON.stringify(r.group)}, keywords: ${JSON.stringify(r.keywords)} },`,
  )
  const content = `/**
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
  mkdirSync(dirname(ROUTES_OUT), { recursive: true })
  writeFileSync(ROUTES_OUT, content, 'utf8')
}

function main() {
  const { docs, routes } = buildCorpus()
  mkdirSync(dirname(CORPUS_OUT), { recursive: true })
  writeFileSync(
    CORPUS_OUT,
    JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), docs }, null, 2),
    'utf8',
  )
  emitRoutesTs(routes)
  console.log(`Wrote ${docs.length} corpus chunks and ${routes.length} routes`)
  console.log(`  → ${relative(ROOT, CORPUS_OUT)}`)
  console.log(`  → ${relative(ROOT, ROUTES_OUT)}`)
}

main()
