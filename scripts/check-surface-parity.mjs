#!/usr/bin/env node
/**
 * FILE: scripts/check-surface-parity.mjs
 * PURPOSE: Console ↔ MCP ↔ CLI parity gate.
 *
 * Every API route the admin console calls must be reachable from an editor
 * (an MCP tool) or a terminal (a `mushi` command), or carry an explicit
 * reason why not. The mapping lives in scripts/surface-parity.json:
 *
 *   "GET /v1/admin/orgs/:orgId/portfolio": { "mcp": ["get_portfolio"], "cli": ["portfolio show"] }
 *   "POST /v1/admin/orgs/:orgId/connectors": { "allow": "jwt-only" }
 *
 * How a route counts as "used by the console": every '/v1/…' string literal
 * under apps/admin/src (tests excluded) is matched against the Hono route
 * registrations under packages/server/supabase/functions/api. Every method
 * the server registers on a matched path is in scope. HTTP methods are never
 * guessed from admin source text, so the result is deterministic.
 *
 * Fails when:
 *   - a console route has no entry (add an MCP tool, a CLI command, or a reason);
 *   - an entry names an MCP tool missing from packages/mcp/src/catalog.ts;
 *   - an entry names a CLI command missing from packages/cli/src/commands;
 *   - an entry uses an unknown reason code, or mixes a reason with a surface;
 *   - `jwt-only` is used on a route that also accepts an API key;
 *   - an entry is stale (the console no longer calls that route).
 * Admin literals that match no server route (dynamic prefixes, external
 * paths) are counted and listed with --verbose; they never fail the check.
 *
 * Run:      pnpm check:surface-parity
 * Suggest:  node scripts/check-surface-parity.mjs --suggest   (skeleton entries for unmapped routes)
 * Verbose:  node scripts/check-surface-parity.mjs --verbose
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export const PATHS = {
  api: 'packages/server/supabase/functions/api',
  admin: 'apps/admin/src',
  cliCommands: 'packages/cli/src/commands',
  mcpCatalog: 'packages/mcp/src/catalog.ts',
  mapping: 'scripts/surface-parity.json',
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete']

// ── File walking ─────────────────────────────────────────────────────────────

function walk(dir, accept) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full, accept))
    else if (accept(name)) out.push(full)
  }
  return out
}

const isSource = (name) => /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)

function readSources(root, rel) {
  const dir = path.join(root, rel)
  return walk(dir, isSource).map((full) => ({
    file: path.relative(root, full).replace(/\\/g, '/'),
    source: readFileSync(full, 'utf8'),
  }))
}

// ── Server routes ────────────────────────────────────────────────────────────

/** Read a quoted or backtick path at `start`, turning `${…}` into `:param`. */
function readPathLiteral(source, start) {
  const quote = source[start]
  let i = start + 1
  let out = ''
  while (i < source.length && source[i] !== quote) {
    if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++
        else if (source[i] === '}') depth--
        i++
      }
      out += ':param'
      continue
    }
    out += source[i]
    i++
  }
  return { text: out, end: i + 1 }
}

/** The text inside a call's parentheses, from just after `(` to its match. */
function readBalanced(source, start) {
  let depth = 1
  let i = start
  while (i < source.length && depth > 0) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') depth--
    i++
  }
  return source.slice(start, i - 1)
}

/**
 * Classify an auth middleware list for one method. `jwt` means a console
 * session only. A `c.req.method === 'GET' ? A : B` split (feature board:
 * key reads, console-only writes) is resolved per method.
 */
export function classifyAuth(text, method = 'GET') {
  const split = /c\.req\.method\s*===\s*['"]GET['"]\s*\?([\s\S]*?\))\s*:\s([\s\S]*)/.exec(text)
  if (split) return classifyAuth(method === 'GET' ? split[1] : split[2], method)
  if (/\b(adminOrApiKey\w*|requireAuthOrApiKey|jwtOrApiKey)\b/.test(text)) return 'key'
  if (/\bapiKeyAuth\b/.test(text)) return 'sdk'
  if (/\brequireServiceRoleAuth\b/.test(text)) return 'service'
  if (/\b(jwtAuth|requireAuth)\b/.test(text)) return 'jwt'
  return 'other'
}

/**
 * Expand auth aliases inside one file: `const readAuth = adminOrApiKey(...)`
 * and injectable defaults such as `auth: MiddlewareHandler = jwtAuth`.
 */
function expandAuthAliases(source, text) {
  let expanded = text
  const aliasRe = /\b(\w+)\s*(?::\s*\w+\s*)?=\s*(adminOrApiKey\w*|jwtAuth|apiKeyAuth|requireAuth\w*|jwtOrApiKey|requireServiceRoleAuth)\b/g
  let m
  while ((m = aliasRe.exec(source)) !== null) {
    if (new RegExp(`\\b${m[1]}\\b`).test(expanded)) expanded += ` ${m[2]}`
  }
  return expanded
}

/** Name of the function enclosing `pos` (nearest preceding `function x(`). */
function enclosingFunction(source, pos) {
  const before = source.slice(0, pos)
  const all = [...before.matchAll(/function\s+(\w+)\s*\(/g)]
  return all.length ? all[all.length - 1][1] : null
}

/**
 * Collect `{ method, path, auth, file }` for every Hono registration. Sub-routers
 * (`const r = new Hono()` … `parent.route('/v1/x', r)`) get their mount prefix
 * and their `r.use('*', …)` auth.
 */
export function extractServerRoutes(files) {
  const routes = []
  for (const { file, source } of files) {
    // Sub-router declarations: var name, position, prefix, router-level auth.
    const routers = []
    for (const m of source.matchAll(/const\s+(\w+)\s*=\s*new\s+Hono\b/g)) {
      routers.push({ name: m[1], pos: m.index, fn: enclosingFunction(source, m.index), prefix: null, auth: '' })
    }
    for (const m of source.matchAll(/\.route\(\s*(['"`])([^'"`]*)\1\s*,\s*(\w+)(\s*\(\s*\))?/g)) {
      const [, , prefix, target, call] = m
      const candidates = call
        ? routers.filter((r) => r.fn === target)
        : routers.filter((r) => r.name === target && r.pos < m.index)
      const router = candidates[candidates.length - 1]
      if (router && router.prefix === null) router.prefix = prefix
    }
    for (const router of routers) {
      const useRe = new RegExp(`\\b${router.name}\\.use\\(`, 'g')
      useRe.lastIndex = router.pos
      if (useRe.exec(source)) router.auth = readBalanced(source, useRe.lastIndex)
    }

    // Same-file path constants: `const NAV_META_PATH = '/v1/admin/…'`.
    const pathConsts = new Map(
      [...source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"])(\/[^'"]*)\2/g)].map((c) => [c[1], c[3]]),
    )
    const regRe = new RegExp(`\\b(\\w+)\\.(${METHODS.join('|')})\\(\\s*(?=['"\`]|[A-Z][A-Z0-9_]*\\s*,)`, 'g')
    let m
    while ((m = regRe.exec(source)) !== null) {
      const receiver = m[1]
      const method = m[2].toUpperCase()
      let lit
      if (/['"`]/.test(source[regRe.lastIndex])) {
        lit = readPathLiteral(source, regRe.lastIndex)
      } else {
        const name = /^[A-Z][A-Z0-9_]*/.exec(source.slice(regRe.lastIndex))[0]
        if (!pathConsts.has(name)) continue
        lit = { text: pathConsts.get(name), end: regRe.lastIndex + name.length }
      }
      let routePath = lit.text
      if (!routePath.startsWith('/') && routePath !== '') continue
      const snippet = source.slice(lit.end, lit.end + 240).split(/async\s*\(|\(c\)\s*=>|\bc\s*=>/)[0]
      let authText = snippet
      const router = [...routers].reverse().find((r) => r.name === receiver && r.pos < m.index)
      if (router) {
        if (router.prefix === null) continue // an unmounted helper router (tests, factories)
        routePath = (router.prefix + (routePath === '/' ? '' : routePath)) || '/'
        authText = `${router.auth} ${snippet}`
      } else if (!routePath.startsWith('/v1/') && !routePath.startsWith('/health') && !routePath.startsWith('/.well-known')) {
        continue
      }
      routes.push({ method, path: routePath, auth: classifyAuth(expandAuthAliases(source, authText), method), file })
    }
  }
  const seen = new Set()
  return routes.filter((r) => {
    const key = `${r.method} ${r.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Admin literals ───────────────────────────────────────────────────────────

/** Every '/v1/…' literal in the admin sources, with `${…}` kept as markers. */
export function extractAdminLiterals(files) {
  const out = []
  for (const { file, source } of files) {
    const re = /(['"`])\/v1\//g
    let m
    while ((m = re.exec(source)) !== null) {
      const quote = m[1]
      let i = m.index + 1
      let text = ''
      while (i < source.length && source[i] !== quote && source[i] !== '\n') {
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          let depth = 1
          i += 2
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth++
            else if (source[i] === '}') depth--
            i++
          }
          text += '\u0000'
          continue
        }
        text += source[i]
        i++
      }
      re.lastIndex = i + 1
      out.push({ file, literal: text.replace(/\u0000/g, '${}') })
    }
  }
  return out
}

/**
 * Turn an admin literal into path segments. A `${}` that fills a whole
 * segment is a parameter (`:`); one glued to the end of the last segment is
 * a query suffix and dropped; one glued inside a segment makes it a parameter.
 * Returns null for a bare prefix ('/v1/admin/x/') that is completed elsewhere.
 */
export function normalizeAdminLiteral(literal) {
  let text = literal
  const q = text.indexOf('?')
  if (q !== -1) text = text.slice(0, q)
  const rawSegs = text.split('/').slice(1)
  if (rawSegs.length === 0) return null
  const last = rawSegs.length - 1
  if (rawSegs[last] === '') return null
  const segs = []
  for (let i = 0; i < rawSegs.length; i++) {
    const seg = rawSegs[i]
    if (seg === '') return null
    if (!seg.includes('${}')) {
      segs.push(seg)
      continue
    }
    if (seg === '${}') {
      segs.push(':')
      continue
    }
    const stripped = seg.replace(/(\$\{\})+$/, '')
    if (i === last && stripped && !stripped.includes('${}')) {
      segs.push(stripped)
      continue
    }
    segs.push(':')
  }
  return segs
}

function routeSegments(routePath) {
  return routePath.split('/').slice(1).map((s) => (s.startsWith(':') ? ':' : s))
}

/** Server paths an admin literal reaches; the most specific match wins. */
export function matchAdminLiteral(segs, routes) {
  let best = []
  let bestScore = null
  const byPath = new Map()
  for (const r of routes) {
    if (!byPath.has(r.path)) byPath.set(r.path, routeSegments(r.path))
  }
  for (const [routePath, rs] of byPath) {
    if (rs.length !== segs.length) continue
    let paramToStatic = 0
    let exact = 0
    let ok = true
    for (let i = 0; i < rs.length; i++) {
      const a = segs[i]
      const s = rs[i]
      if (a === ':' && s === ':') continue
      if (a === ':') { paramToStatic++; continue }
      if (s === ':') continue
      if (a === s) { exact++; continue }
      ok = false
      break
    }
    if (!ok) continue
    const score = [paramToStatic, -exact]
    if (bestScore === null || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
      best = [routePath]
      bestScore = score
    } else if (score[0] === bestScore[0] && score[1] === bestScore[1]) {
      best.push(routePath)
    }
  }
  return best
}

/** `{ used: Map<key, route>, unresolved: literal[] }` for the console. */
export function consoleRoutes(adminLiterals, routes) {
  const used = new Map()
  const unresolved = []
  for (const lit of adminLiterals) {
    const segs = normalizeAdminLiteral(lit.literal)
    const paths = segs ? matchAdminLiteral(segs, routes) : []
    if (paths.length === 0) {
      unresolved.push(lit)
      continue
    }
    for (const r of routes) {
      if (!paths.includes(r.path)) continue
      const key = `${r.method} ${r.path}`
      if (!used.has(key)) used.set(key, { ...r, from: new Set() })
      used.get(key).from.add(lit.file)
    }
  }
  return { used, unresolved }
}

// ── MCP tools and CLI commands ───────────────────────────────────────────────

export function extractMcpTools(catalogSource) {
  return new Set([...catalogSource.matchAll(/^\s*name:\s*'([a-z0-9_]+)'/gm)].map((m) => m[1]))
}

/** The command words of `.command('name <arg> [opt]')`. */
function commandName(spec) {
  return spec.trim().split(/\s+/)[0]
}

/**
 * Command paths ("radar", "radar scan") declared in the CLI command modules.
 * Commander chains are `program.command('x')` and `<var>.command('y')`, where
 * `<var>` was assigned from an earlier `.command('x')` in the same file.
 */
export function extractCliCommands(files) {
  const out = new Set()
  for (const { source: raw } of files) {
    // Comment-only lines may sit between `releases` and `.command('draft')`.
    const source = raw.replace(/^[ \t]*\/\/.*$/gm, '')
    const vars = new Map([['program', '']])
    const re = /(?:(?:const|let)\s+(\w+)\s*=\s*)?\b(\w+)\s*\.\s*command\(\s*(['"`])([^'"`]+)\3/g
    let m
    while ((m = re.exec(source)) !== null) {
      const [, assigned, receiver, , spec] = m
      if (!vars.has(receiver)) continue
      const parent = vars.get(receiver)
      const full = parent ? `${parent} ${commandName(spec)}` : commandName(spec)
      out.add(full)
      if (assigned) vars.set(assigned, full)
    }
  }
  return out
}

// ── The check ────────────────────────────────────────────────────────────────

export function checkParity({ used, mapping, mcpTools, cliCommands }) {
  const errors = []
  const reasons = mapping.reasons ?? {}
  const entries = mapping.routes ?? {}
  const stats = { routes: used.size, mcp: 0, cli: 0, allowed: 0, byReason: {} }

  for (const [key, route] of [...used].sort((a, b) => a[0].localeCompare(b[0]))) {
    const entry = entries[key]
    if (!entry) {
      errors.push(`${key} (${route.file}) is called by the console (${[...route.from].sort()[0]}) but has no MCP tool, CLI command or allowlist reason in ${PATHS.mapping}.`)
      continue
    }
    const mcp = entry.mcp ?? []
    const cli = entry.cli ?? []
    if (entry.allow !== undefined) {
      if (mcp.length || cli.length) errors.push(`${key}: has both a surface and "allow"; drop the reason.`)
      if (!Object.hasOwn(reasons, entry.allow)) errors.push(`${key}: unknown reason "${entry.allow}" (known: ${Object.keys(reasons).join(', ')}).`)
      if (entry.allow === 'jwt-only' && route.auth !== 'jwt') {
        errors.push(`${key}: "jwt-only" but the route accepts ${route.auth === 'key' ? 'an API key' : `auth "${route.auth}"`}; map its MCP tool or CLI command, or pick another reason.`)
      }
      stats.allowed++
      stats.byReason[entry.allow] = (stats.byReason[entry.allow] ?? 0) + 1
    } else if (!mcp.length && !cli.length) {
      errors.push(`${key}: entry needs "mcp", "cli" or "allow".`)
    }
    for (const tool of mcp) if (!mcpTools.has(tool)) errors.push(`${key}: MCP tool "${tool}" is not in ${PATHS.mcpCatalog}.`)
    for (const cmd of cli) {
      const words = cmd.replace(/^mushi\s+/, '').split(/\s+/).filter((w) => !/^[<[-]/.test(w))
      if (!cliCommands.has(words.join(' '))) errors.push(`${key}: CLI command "mushi ${words.join(' ')}" is not declared in ${PATHS.cliCommands}.`)
    }
    if (mcp.length) stats.mcp++
    if (cli.length) stats.cli++
  }
  for (const key of Object.keys(entries)) {
    if (!used.has(key)) errors.push(`${key}: stale entry; the console no longer calls this route. Remove it from ${PATHS.mapping}.`)
  }
  return { errors, stats }
}

export function loadInputs(root = ROOT) {
  const routes = extractServerRoutes(readSources(root, PATHS.api))
  const adminLiterals = extractAdminLiterals(readSources(root, PATHS.admin))
  const { used, unresolved } = consoleRoutes(adminLiterals, routes)
  const mcpTools = extractMcpTools(readFileSync(path.join(root, PATHS.mcpCatalog), 'utf8'))
  const cliCommands = extractCliCommands(readSources(root, PATHS.cliCommands))
  const mapping = JSON.parse(readFileSync(path.join(root, PATHS.mapping), 'utf8'))
  return { routes, used, unresolved, mcpTools, cliCommands, mapping }
}

function main() {
  const args = new Set(process.argv.slice(2))
  const inputs = loadInputs()
  const { errors, stats } = checkParity(inputs)

  if (args.has('--suggest')) {
    const missing = [...inputs.used.keys()].filter((k) => !inputs.mapping.routes?.[k]).sort()
    for (const key of missing) {
      const r = inputs.used.get(key)
      const hint = r.auth === 'jwt' ? '{ "allow": "jwt-only" }' : '{ "mcp": [], "cli": [] }'
      console.log(`    ${JSON.stringify(key)}: ${hint},`)
    }
    return
  }
  if (args.has('--verbose')) {
    console.log(`Admin literals matching no server route (${inputs.unresolved.length}):`)
    for (const u of inputs.unresolved) console.log(`  ${u.literal}  (${u.file})`)
  }

  if (errors.length) {
    console.error(`Surface parity: ${errors.length} problem(s)\n`)
    for (const e of errors) console.error(`  - ${e}`)
    console.error('\nAdd an MCP tool or `mushi` command for the route, or an explicit reason in scripts/surface-parity.json.')
    console.error('`node scripts/check-surface-parity.mjs --suggest` prints skeleton entries for unmapped routes.')
    process.exit(1)
  }
  const reasons = Object.entries(stats.byReason).map(([k, n]) => `${k} ${n}`).join(', ')
  console.log(
    `Surface parity OK: ${stats.routes} console routes; ${stats.mcp} with an MCP tool, ${stats.cli} with a CLI command, ${stats.allowed} allowlisted (${reasons || 'none'}); ${inputs.unresolved.length} admin literals matched no route.`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
