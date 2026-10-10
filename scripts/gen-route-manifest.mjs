#!/usr/bin/env node
/**
 * Generate docs/API_ROUTE_MANIFEST.generated.md from Hono route registrations.
 *
 *   pnpm gen:route-manifest
 *   pnpm check:route-manifest   # fails if manifest is stale
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ROUTES_DIR = path.join(ROOT, 'packages/server/supabase/functions/api/routes')
const OUT = path.join(ROOT, 'docs/API_ROUTE_MANIFEST.generated.md')

// Matches up to the comma after the path. The middleware is read separately,
// up to the inline handler: stopping at the first `)` cut the snippet inside
// `async (c` or a middleware call such as `rateLimit({...})`.
const ROUTE_RE = /app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,/g
const NEXT_ROUTE_RE = /\bapp\.(?:get|post|put|patch|delete|use|all|on)\(/
const HANDLER_RE = /(?:async\s*)?\(\s*c\b[^)]*\)\s*=>/

const AUTH_PATTERNS = [
  ['apiKeyAuth', 'apiKeyAuth'],
  ['jwtAuth', 'jwtAuth'],
  ['adminOrApiKey', 'adminOrApiKey'],
  ['requireServiceRoleAuth', 'requireServiceRoleAuth'],
  ['requireAuthOrApiKey', 'requireAuthOrApiKey'],
  ['jwtOrApiKey', 'jwtOrApiKey'],
]

/**
 * `rest` is the registration source after the path's comma. The text before
 * the inline `(c) =>` handler is the middleware list: a known auth name there
 * labels the route, an empty list means `public`, anything else (custom
 * middleware, a named handler) stays `unknown`.
 */
export function inferAuth(rest) {
  const next = rest.search(NEXT_ROUTE_RE)
  const registration = next === -1 ? rest : rest.slice(0, next)
  const handlerAt = registration.search(HANDLER_RE)
  const middleware = handlerAt === -1 ? registration : registration.slice(0, handlerAt)
  for (const [needle, label] of AUTH_PATTERNS) {
    if (middleware.includes(needle)) return label
  }
  if (handlerAt !== -1 && middleware.trim() === '') return 'public'
  return 'unknown'
}

function collectRoutes() {
  const routes = []
  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(path.join(ROUTES_DIR, file), 'utf8')
    const rel = path.relative(ROOT, path.join(ROUTES_DIR, file)).replace(/\\/g, '/')
    ROUTE_RE.lastIndex = 0
    let match
    while ((match = ROUTE_RE.exec(source)) !== null) {
      const method = match[1].toUpperCase()
      const routePath = match[2]
      const auth = inferAuth(source.slice(ROUTE_RE.lastIndex, ROUTE_RE.lastIndex + 800))
      routes.push({ method, path: routePath, auth, file: rel })
    }
  }
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  return routes
}

function renderMarkdown(routes) {
  const generatedAt = new Date().toISOString().slice(0, 10)
  const byAuth = new Map()
  for (const r of routes) {
    if (!byAuth.has(r.auth)) byAuth.set(r.auth, [])
    byAuth.get(r.auth).push(r)
  }

  let body = `# API route manifest (generated)

> Auto-generated from \`packages/server/supabase/functions/api/routes/*.ts\`.
> Do not edit by hand — run \`pnpm gen:route-manifest\`.
> Generated: ${generatedAt} · **${routes.length}** routes.

External base: \`{SUPABASE_URL}/functions/v1/api\`

| Auth | Count |
| --- | ---: |
`
  for (const [auth, list] of [...byAuth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    body += `| \`${auth}\` | ${list.length} |\n`
  }

  body += `\n## Routes by path\n\n| Method | Path | Auth | Source |\n| --- | --- | --- | --- |\n`
  for (const r of routes) {
    body += `| ${r.method} | \`${r.path}\` | \`${r.auth}\` | \`${r.file}\` |\n`
  }
  return body
}

// Excludes the "Generated: <date>" line, which is cosmetic and would
// otherwise make --check fail every day regardless of actual route drift.
function stripGeneratedDate(markdown) {
  return markdown.replace(/^> Generated: \d{4}-\d{2}-\d{2} /m, '> Generated: ')
}

function main() {
  const routes = collectRoutes()
  const markdown = renderMarkdown(routes)
  const comparable = stripGeneratedDate(markdown)
  const hash = createHash('sha256').update(comparable).digest('hex').slice(0, 12)

  if (process.argv.includes('--check')) {
    if (!existsSync(OUT)) {
      console.error('Route manifest missing. Run: pnpm gen:route-manifest')
      process.exit(1)
    }
    const existing = readFileSync(OUT, 'utf8')
    const existingHash = createHash('sha256')
      .update(stripGeneratedDate(existing))
      .digest('hex')
      .slice(0, 12)
    if (existingHash !== hash) {
      console.error('Route manifest drift. Run: pnpm gen:route-manifest')
      process.exit(1)
    }
    console.log(`Route manifest check passed (${routes.length} routes).`)
    return
  }

  writeFileSync(OUT, markdown, 'utf8')
  console.log(`[gen] wrote ${path.relative(ROOT, OUT)} (${routes.length} routes)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
