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
 * How a route counts as "used by the console": every '/v1/…' path under
 * apps/admin/src (tests excluded) is matched against the Hono route
 * registrations under packages/server/supabase/functions/api. A path is a
 * '/v1/…' literal, or a template that starts with a path binding
 * (`${path}/findings` after `const path = `/v1/…``, same file or a relative
 * import). Every method the server registers on a matched path is in scope.
 * HTTP methods are never guessed from admin source text.
 *
 * Fail closed: every call to apiFetch, apiFetchMutate, apiFetchRaw or
 * usePageData (and to any function that forwards its first parameter to
 * one) must have a first argument the check can resolve this way. One it
 * cannot follow (a prop, a computed string) fails unless "dynamicCalls" in
 * the mapping gives a reason for that file and argument text.
 *
 * Fails when:
 *   - a console route has no entry (add an MCP tool, a CLI command, or a reason);
 *   - an entry names an MCP tool missing from packages/mcp/src/catalog.ts;
 *   - an entry names a CLI command missing from packages/cli/src/commands;
 *   - an entry uses an unknown reason code, or mixes a reason with a surface;
 *   - `jwt-only` is used on a route that also accepts an API key;
 *   - an entry is stale (the console no longer calls that route);
 *   - a console call's path cannot be resolved and has no "dynamicCalls"
 *     reason, or a "dynamicCalls" reason names a call that no longer exists.
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

/** The console's request helpers. Their first argument is the API path. */
export const ADMIN_CALLS = ['apiFetch', 'apiFetchMutate', 'apiFetchRaw', 'usePageData']

/** Index just past the string or template literal that opens at `start`. */
function skipString(source, start) {
  const quote = source[start]
  let i = start + 1
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') { i += 2; continue }
    if (quote !== '`' && source[i] === '\n') return i
    if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < source.length && depth > 0) {
        if (source[i] === '`') { i = skipString(source, i); continue }
        if (source[i] === '{') depth++
        else if (source[i] === '}') depth--
        i++
      }
      continue
    }
    i++
  }
  return i + 1
}

/**
 * Blank out `//` and block comments, keeping every offset and newline, so a
 * path or a call mentioned in a comment is neither resolved nor checked.
 * String and template contents are left alone.
 */
export function blankComments(source) {
  const out = source.split('')
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    // A line comment follows whitespace or punctuation, never a ':' as in 'https://'.
    if (ch === '/' && source[i + 1] === '/' && (i === 0 || /[\s;,(){}[\]]/.test(source[i - 1]))) {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      blank(i, stop)
      i = stop
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(source, i)
      continue
    }
    i++
  }
  return out.join('')
}

/**
 * Read the literal opening at `start` with each `${…}` turned into the
 * marker `${}`. Stops at the closing quote or at a newline.
 */
function readAdminLiteral(source, start) {
  const quote = source[start]
  let i = start + 1
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
      text += '${}'
      continue
    }
    text += source[i]
    i++
  }
  return { text, end: i + 1 }
}

/** '/v1/…' literals written out in `text` (a quote, then '/v1/'). */
function directV1Literals(text) {
  const out = []
  const re = /(['"`])\/v1\//g
  let m
  while ((m = re.exec(text)) !== null) {
    const lit = readAdminLiteral(text, m.index)
    re.lastIndex = Math.max(re.lastIndex, lit.end)
    out.push(lit.text)
  }
  return out
}

/** Templates that open with `${NAME}`: `{ name, rest, index }`, rest with markers. */
function composedTemplates(text) {
  const out = []
  for (const m of text.matchAll(/`\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
    const lit = readAdminLiteral(text, m.index)
    out.push({ name: m[1], rest: lit.text.slice(3), index: m.index })
  }
  return out
}

/**
 * The expression that starts at `start`: up to `;` or `,` at depth 0, a
 * closing bracket it did not open, or a newline unless the statement plainly
 * continues (the line ends in an operator, or the next starts with
 * `? : . && || +`).
 */
function readExpression(source, from, limit = 4000) {
  let start = from
  while (start < source.length && /\s/.test(source[start])) start++
  let depth = 0
  let i = start
  const stop = Math.min(source.length, start + limit)
  while (i < stop) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(source, i); continue }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && (ch === ';' || ch === ',')) break
    else if (depth === 0 && ch === '\n') {
      const before = source.slice(start, i).trimEnd()
      const after = source.slice(i + 1).trimStart()
      if (!/[=?:(,&|+>]$/.test(before) && !/^(\?|:|\.|&&|\|\||\+)/.test(after)) break
    }
    i++
  }
  return source.slice(start, i)
}

/** A top-level `function NAME(` up to the next top-level declaration. */
function readTopLevelFunction(source, start) {
  const next = /\n(?:export\s|function\s|const\s|let\s|async\s|interface\s|type\s|class\s)/.exec(source.slice(start + 1))
  return source.slice(start, next ? start + 1 + next.index : source.length)
}

/** Per-file context: comment-free code and resolved relative named imports. */
function fileContexts(files) {
  const byFile = new Map()
  for (const { file, source } of files) byFile.set(file, { file, source, code: blankComments(source), imports: new Map() })
  const resolveImport = (from, spec) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (byFile.has(candidate)) return candidate
    }
    return null
  }
  for (const ctx of byFile.values()) {
    for (const m of ctx.code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const target = resolveImport(ctx.file, m[2])
      if (!target) continue
      for (const part of m[1].split(',')) {
        const [name, alias] = part.replace(/^\s*type\s+/, '').trim().split(/\s+as\s+/)
        if (name) ctx.imports.set((alias ?? name).trim(), { file: target, name: name.trim() })
      }
    }
  }
  return byFile
}

/**
 * True when a function signature between `from` and `to` declares a
 * parameter `name`, typed or not, plain or destructured (`({ path })`): a use
 * at `to` then means the parameter, not the `const` declared before `from`.
 */
function shadowedByParameter(code, name, from, to) {
  const sig = new RegExp(`(?:function\\s*\\w*\\s*(?:<[^>]*>)?\\s*\\(|=\\s*(?:async\\s*)?\\()[^)]*\\b${name}\\s*\\??\\s*[:,)=}]`)
  return sig.test(code.slice(from, to))
}

/**
 * Where `name` is bound for a use at `pos`: the nearest earlier `const`/`let`
 * initializer, a top-level `function`, or a relative named import.
 */
function findBinding(byFile, ctx, name, pos) {
  const declRe = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*(?::[^=;\\n]+)?=(?![=>])`, 'g')
  let best = null
  for (const m of ctx.code.matchAll(declRe)) if (m.index < pos) best = m
  if (best && !shadowedByParameter(ctx.code, name, best.index + best[0].length, pos)) {
    return { ctx, pos: best.index, text: readExpression(ctx.code, best.index + best[0].length) }
  }
  const fn = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`).exec(ctx.code)
  if (fn) return { ctx, pos: fn.index, text: readTopLevelFunction(ctx.code, fn.index) }
  const imported = ctx.imports.get(name)
  const target = imported && byFile.get(imported.file)
  return target ? findBinding(byFile, target, imported.name, target.code.length) : null
}

/**
 * The '/v1/…' path(s) a binding stands for, with `${}` markers. A ternary
 * with two paths yields both; `${base}/x` in the initializer expands `base`.
 */
function bindingBases(byFile, ctx, name, pos, seen = new Set()) {
  const key = `${ctx.file}#${name}@${pos}`
  if (seen.has(key)) return []
  seen.add(key)
  const binding = findBinding(byFile, ctx, name, pos)
  if (!binding) return []
  const bases = directV1Literals(binding.text)
  for (const t of composedTemplates(binding.text)) {
    for (const base of bindingBases(byFile, binding.ctx, t.name, binding.pos + t.index, seen)) bases.push(base + t.rest)
  }
  return bases
}

/**
 * Every '/v1/…' path in the admin sources, with `${…}` kept as markers.
 * Besides literals written out in full, a template that starts with a path
 * binding (same file or a relative import) is expanded: `${path}/findings`
 * after `const path = `/v1/admin/x/${id}`` yields '/v1/admin/x/${}/findings'.
 * `${API_URL}/v1/…` yields its '/v1/…' tail.
 */
export function extractAdminLiterals(files) {
  const byFile = fileContexts(files)
  const out = []
  for (const ctx of byFile.values()) {
    for (const literal of directV1Literals(ctx.source)) out.push({ file: ctx.file, literal })
    for (const t of composedTemplates(ctx.code)) {
      const bases = bindingBases(byFile, ctx, t.name, t.index)
      if (bases.length) {
        for (const base of bases) out.push({ file: ctx.file, literal: base + t.rest })
      } else if (t.rest.startsWith('/v1/')) {
        out.push({ file: ctx.file, literal: t.rest })
      }
    }
  }
  return out
}

/** Index after a generic type argument list at `i` (`<{ a: () => void }>`). */
function skipTypeArgs(code, i) {
  if (code[i] !== '<') return i
  let depth = 0
  for (let k = i; k < code.length; k++) {
    if (code[k] === '<') depth++
    else if (code[k] === '>' && code[k - 1] !== '=') {
      depth--
      if (depth === 0) return k + 1
    }
  }
  return i
}

/**
 * Split `a ? b : c` at depth 0 into its two branches, or null. A nested
 * ternary in the first branch (`x ? (y ? A : B) : null`, parenthesized or
 * not) keeps its own `:`; the outer split is at the colon that closes the
 * first `?`.
 */
function ternaryBranches(expr) {
  let depth = 0
  let q = -1
  let open = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(expr, i) - 1; continue }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (depth === 0 && ch === '?' && expr[i + 1] !== '.' && expr[i + 1] !== '?' && expr[i - 1] !== '?') {
      if (q === -1) q = i
      open++
    } else if (depth === 0 && ch === ':' && q !== -1) {
      open--
      if (open === 0) return [expr.slice(q + 1, i), expr.slice(i + 1)]
    }
  }
  return null
}

/**
 * Can the gate tell which route this call argument reaches? Yes when it is
 * (or each ternary branch is) `null`, a '/v1/…' literal, a template opening
 * with a resolvable path binding, or a name or call whose binding holds one.
 */
function argResolves(byFile, ctx, expr, pos, seen = new Set()) {
  const e = expr.trim()
  if (e === '') return false
  if (e === 'null' || e === 'undefined') return true
  const branches = ternaryBranches(e)
  if (branches) return branches.every((b) => argResolves(byFile, ctx, b, pos, seen))
  const and = /^[^'"`]+?&&([\s\S]+)$/.exec(e)
  if (and) return argResolves(byFile, ctx, and[1], pos, seen)
  if (/^(['"`])\/v1\//.test(e)) return true
  const composed = /^`\$\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(e)
  if (composed) {
    // The prefix must resolve as a whole (every ternary branch), not merely hold one path.
    return argResolves(byFile, ctx, composed[1], pos, seen) && bindingBases(byFile, ctx, composed[1], pos).length > 0
  }
  if (/^['"`]/.test(e)) return false
  const head = /^([A-Za-z_$][\w$]*)/.exec(e)
  if (!head) return false
  const key = `${ctx.file}#${head[1]}@${pos}`
  if (seen.has(key)) return false
  seen.add(key)
  const binding = findBinding(byFile, ctx, head[1], pos)
  if (!binding) return false
  const isVariable = /^(?:const|let|var)\b/.test(binding.ctx.code.slice(binding.pos))
  // `const p = cond ? '/v1/a' : props.url`: every branch must resolve, so one
  // path literal cannot vouch for a prop beside it.
  if (isVariable && ternaryBranches(binding.text.trim())) return argResolves(byFile, binding.ctx, binding.text, binding.pos, seen)
  if (directV1Literals(binding.text).length > 0) return true
  // `const url = buildUrl(tab)` or `const p = `${base}/x``: follow the initializer.
  if (isVariable) return argResolves(byFile, binding.ctx, binding.text, binding.pos, seen)
  // A function body that only composes (`return `${BASE}/x``): every prefix must resolve.
  const inner = composedTemplates(binding.text)
  return inner.length > 0 && inner.every((t) => argResolves(byFile, binding.ctx, t.name, binding.pos + t.index, seen))
}

/** The function enclosing `pos` whose FIRST parameter is `param`, or null. */
function forwardingFunction(code, param, pos) {
  const re = new RegExp(
    `(?:function\\s+(\\w+)\\s*(?:<[^>]*>)?\\s*\\(|(?:const|let)\\s+(\\w+)\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\()\\s*${param}\\b`,
    'g',
  )
  let found = null
  for (const m of code.slice(0, pos).matchAll(re)) found = m[1] ?? m[2]
  if (!found) return null
  const exported = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let)\\s+${found}\\b`).test(code)
  return { name: found, exported }
}

/**
 * Console calls whose path the gate cannot resolve, as `{ file, call, arg }`.
 * Every call to a request helper is checked. A function that hands its own
 * first parameter to a helper (`const run = async (url) => apiFetchMutate(url)`)
 * becomes a checked helper itself: file-local, or everywhere when exported.
 * Whatever is left needs a reason under "dynamicCalls" in the mapping.
 */
export function extractDynamicCalls(files) {
  const byFile = fileContexts(files)
  const shared = new Set(ADMIN_CALLS)
  const local = new Map([...byFile.keys()].map((f) => [f, new Set()]))
  let unresolved = []
  for (let pass = 0; pass < 6; pass++) {
    let grew = false
    unresolved = []
    for (const ctx of byFile.values()) {
      const re = new RegExp(`\\b(${[...shared, ...local.get(ctx.file)].join('|')})\\b\\s*`, 'g')
      let m
      while ((m = re.exec(ctx.code)) !== null) {
        if (/(?:function|\.)\s*$/.test(ctx.code.slice(Math.max(0, m.index - 40), m.index))) continue
        let i = skipTypeArgs(ctx.code, re.lastIndex)
        while (/\s/.test(ctx.code[i] ?? '')) i++
        if (ctx.code[i] !== '(') continue
        const arg = readExpression(ctx.code, i + 1).trim()
        if (argResolves(byFile, ctx, arg, m.index)) continue
        const forwarder = /^[A-Za-z_$][\w$]*$/.test(arg) ? forwardingFunction(ctx.code, arg, m.index) : null
        if (forwarder) {
          const set = forwarder.exported ? shared : local.get(ctx.file)
          if (!set.has(forwarder.name)) { set.add(forwarder.name); grew = true }
          continue
        }
        unresolved.push({ file: ctx.file, call: m[1], arg })
      }
    }
    if (!grew) break
  }
  return unresolved
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

export function checkParity({ used, mapping, mcpTools, cliCommands, dynamicCalls = [] }) {
  const errors = []
  // A console call whose path the gate cannot resolve is a route it cannot
  // see. It fails unless "dynamicCalls" names it, and a named call that no
  // longer exists fails as stale, so the allowlist cannot grow silently.
  const allowedDynamic = mapping.dynamicCalls ?? {}
  const seenDynamic = new Set()
  for (const call of dynamicCalls) {
    const reason = allowedDynamic[call.file]?.[call.arg]
    if (typeof reason === 'string' && reason.trim()) {
      seenDynamic.add(`${call.file}\u0000${call.arg}`)
      continue
    }
    errors.push(`${call.file}: ${call.call}(${call.arg}, …) builds its path in a way this check cannot follow, so the route it calls is unchecked. Use a '/v1/…' literal or a same-file path constant, or add a reason under "dynamicCalls" in ${PATHS.mapping}.`)
  }
  for (const [file, args] of Object.entries(allowedDynamic)) {
    for (const arg of Object.keys(args)) {
      if (!seenDynamic.has(`${file}\u0000${arg}`)) errors.push(`dynamicCalls ${file} "${arg}": stale entry; no console call passes that argument any more. Remove it from ${PATHS.mapping}.`)
    }
  }
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
  const adminFiles = readSources(root, PATHS.admin)
  const adminLiterals = extractAdminLiterals(adminFiles)
  const dynamicCalls = extractDynamicCalls(adminFiles)
  const { used, unresolved } = consoleRoutes(adminLiterals, routes)
  const mcpTools = extractMcpTools(readFileSync(path.join(root, PATHS.mcpCatalog), 'utf8'))
  const cliCommands = extractCliCommands(readSources(root, PATHS.cliCommands))
  const mapping = JSON.parse(readFileSync(path.join(root, PATHS.mapping), 'utf8'))
  return { routes, used, unresolved, dynamicCalls, mcpTools, cliCommands, mapping }
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
    `Surface parity OK: ${stats.routes} console routes; ${stats.mcp} with an MCP tool, ${stats.cli} with a CLI command, ${stats.allowed} allowlisted (${reasons || 'none'}); ${inputs.dynamicCalls.length} dynamic call(s) with a stated reason; ${inputs.unresolved.length} admin literals matched no route.`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
