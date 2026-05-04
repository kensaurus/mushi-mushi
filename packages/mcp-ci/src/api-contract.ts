/**
 * API Contract adapter (whitepaper §5 Gate 3).
 *
 * Walks a customer repo for the THREE most common API surface
 * declarations and returns a normalised `${METHOD}:${path}` set:
 *
 *   1. Next.js App Router  — `app/**\/route.ts` exports (GET / POST / …).
 *   2. OpenAPI document     — `openapi.yaml` / `openapi.json` paths.
 *   3. Supabase introspection — server URL hand-supplied; we GET
 *      `/rest/v1/?apikey=` and pull the OpenAPI Postgrest exposes.
 *
 * The function is intentionally pure-Node + zero-dep so the GitHub
 * Action that wraps it stays tiny. It POSTs the discovered set into
 * the same `inventory-gates` endpoint via a `discovered_apis` payload
 * which Gate 3 already knows how to consume (it currently reads from
 * the crawl summary; this adapter widens the source).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

type DiscoveredRoute = string // "METHOD:path"

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/**
 * Walk Next.js App Router route handlers — `app/**\/route.{ts,js,tsx,jsx}`
 * exports.
 *
 * Heuristic: scan each `route.*` file for `export async function GET|POST|…`.
 * We don't full-AST parse: a string match keeps the script dependency-free
 * and false positives are low (the file name is the safety net). The path
 * is derived from the directory structure relative to `app/`.
 */
export async function walkNextAppRouter(rootDir: string): Promise<DiscoveredRoute[]> {
  const out = new Set<DiscoveredRoute>()
  const appDir = path.join(rootDir, 'app')
  try {
    await walk(appDir, async (filePath) => {
      const base = path.basename(filePath)
      if (!/^route\.(ts|tsx|js|jsx)$/.test(base)) return
      const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
      const relative = path.relative(appDir, path.dirname(filePath)).split(path.sep).join('/')
      // Convert `[id]` → `{id}` and prefix with `/`.
      const routePath = '/' + relative.replace(/\[(\.{3})?([^\]]+)\]/g, '{$2}')
      for (const method of HTTP_METHODS) {
        const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`)
        if (re.test(content)) out.add(`${method}:${routePath || '/'}`)
      }
    })
  } catch {
    // app/ doesn't exist or is unreadable — caller falls back to OpenAPI
  }
  return Array.from(out)
}

/**
 * Parse an OpenAPI document (`openapi.yaml` / `.json`) and emit one
 * route per (method, path) entry. We use a lightweight Yaml fallback —
 * if `yaml` isn't installed in the consumer repo we just JSON.parse.
 */
export async function parseOpenApiFile(filePath: string): Promise<DiscoveredRoute[]> {
  const out: DiscoveredRoute[] = []
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    let doc: unknown
    if (filePath.endsWith('.json')) {
      doc = JSON.parse(content)
    } else {
      try {
        // `yaml` is an optional peer-dep here — the consumer repo may or may
        // not have it installed. Cast to `any` so TS doesn't require us to
        // declare it as a hard dep just for the dynamic-import fallback path.
        const yaml = (await import('yaml' as string)) as { parse: (s: string) => unknown }
        doc = yaml.parse(content)
      } catch {
        return []
      }
    }
    const paths = (doc as { paths?: Record<string, Record<string, unknown>> }).paths ?? {}
    for (const [p, ops] of Object.entries(paths)) {
      for (const m of Object.keys(ops)) {
        const upper = m.toUpperCase()
        if ((HTTP_METHODS as readonly string[]).includes(upper)) {
          out.push(`${upper}:${p}`)
        }
      }
    }
  } catch {
    return []
  }
  return out
}

/**
 * Fetch the Supabase Postgrest OpenAPI doc — every Supabase project
 * exposes one at `/rest/v1/?apikey=…`.
 */
export async function fetchSupabaseOpenApi(
  supabaseUrl: string,
  apiKey: string,
): Promise<DiscoveredRoute[]> {
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/?apikey=${apiKey}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const doc = await res.json()
    const paths = (doc as { paths?: Record<string, Record<string, unknown>> }).paths ?? {}
    const out: DiscoveredRoute[] = []
    for (const [p, ops] of Object.entries(paths)) {
      for (const m of Object.keys(ops)) {
        const upper = m.toUpperCase()
        if ((HTTP_METHODS as readonly string[]).includes(upper)) {
          out.push(`${upper}:/rest/v1${p}`)
        }
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Aggregate every adapter for a single repo + optional Supabase target
 * and return a deduplicated, sorted list.
 */
export async function discoverRoutes(opts: {
  repoRoot: string
  openapiFile?: string
  supabaseUrl?: string
  supabaseAnonKey?: string
}): Promise<DiscoveredRoute[]> {
  const all = new Set<DiscoveredRoute>()

  const next = await walkNextAppRouter(opts.repoRoot)
  for (const r of next) all.add(r)

  if (opts.openapiFile) {
    const oas = await parseOpenApiFile(opts.openapiFile)
    for (const r of oas) all.add(r)
  } else {
    // Convention: `openapi.yaml` at repo root.
    for (const candidate of ['openapi.yaml', 'openapi.json', 'openapi.yml']) {
      const full = path.join(opts.repoRoot, candidate)
      try {
        await fs.access(full)
        const oas = await parseOpenApiFile(full)
        for (const r of oas) all.add(r)
        break
      } catch {
        // not present
      }
    }
  }

  if (opts.supabaseUrl && opts.supabaseAnonKey) {
    const supa = await fetchSupabaseOpenApi(opts.supabaseUrl, opts.supabaseAnonKey)
    for (const r of supa) all.add(r)
  }

  return Array.from(all).sort()
}

async function walk(dir: string, onFile: (p: string) => Promise<void>): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, onFile)
    } else if (entry.isFile()) {
      await onFile(full)
    }
  }
}
