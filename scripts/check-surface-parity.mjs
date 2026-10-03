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
 * one), the `url` option of every openSseStream call, and every raw fetch
 * whose argument writes a '/v1/…' API path must be resolvable this way: one
 * literal spanning the whole argument, a template opening with a resolvable
 * path binding or `${API_URL}/v1/…`, a name whose initializer resolves, a
 * call to a function (or an IIFE) whose every return resolves, or a ternary
 * or `&&` whose branches do. A prop, a concatenation (`'/v1/x/' + id`) or a
 * `??`/`||` fallback fails unless "dynamicCalls" in the mapping gives a
 * reason for that file and argument text. A name resolves only when exactly
 * one binding of it is in scope at the call: a `const` initializer, a
 * `let`/`var` initializer the file never assigns to again, a `function`
 * declaration or a relative import. A second binding in scope (an inner
 * `const`, a parameter, a destructuring pattern, a `for … of` or `catch`
 * binding) or any reassignment (`=`, `+=`, `??=`, `||=`, `++`) leaves it
 * unresolved.
 *
 * A literal whose run-time `${…}` lands on a static server segment
 * (`/projects/${id}/${action}` against `/projects/:id/pause` and `/resume`)
 * reaches a set of routes the check can only over-approximate: every route
 * in the set counts as used, and the literal fails unless "computedPaths"
 * gives a reason for that file and literal (`${…}` written as `${}`).
 *
 * Out of scope: a raw fetch whose argument never writes '/v1/' (Supabase
 * auth and REST, signed upload URLs, static files) and a fetch wrapper's
 * parameter (ConnectionStatus' timedFetch probes health URLs only).
 *
 * Fails when:
 *   - a console route has no entry (add an MCP tool, a CLI command, or a reason);
 *   - an entry names an MCP tool missing from packages/mcp/src/catalog.ts;
 *   - an entry names a CLI command missing from packages/cli/src/commands;
 *   - an entry uses an unknown reason code, or mixes a reason with a surface;
 *   - `jwt-only` is used on a route that also accepts an API key;
 *   - an entry is stale (the console no longer calls that route);
 *   - a console call's path cannot be resolved and has no "dynamicCalls"
 *     reason, or a "dynamicCalls" reason names a call that no longer exists;
 *   - a literal fills a static server segment at run time and has no
 *     "computedPaths" reason, or a "computedPaths" reason is stale.
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
    if (new RegExp(`\\b${reName(m[1])}\\b`).test(expanded)) expanded += ` ${m[2]}`
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
      const useRe = new RegExp(`\\b${reName(router.name)}\\.use\\(`, 'g')
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
  const start = skipSpace(source, from)
  return source.slice(start, expressionEnd(source, start, limit))
}

/** Index of the first non-whitespace character at or after `from`. */
function skipSpace(source, from) {
  let i = from
  while (i < source.length && /\s/.test(source[i])) i++
  return i
}

/** Where the expression opening at `start` ends (see readExpression). */
function expressionEnd(source, start, limit = 4000) {
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
  return i
}

/** Index just past the bracket that closes the one opening at `start`. */
function closeBracket(source, start) {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(source, i) - 1; continue }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return source.length
}

/** Where an arrow body that starts at `from` ends: its block, or its expression. */
function arrowBodyEnd(source, from) {
  const start = skipSpace(source, from)
  return source[start] === '{' ? closeBracket(source, start) : expressionEnd(source, start)
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

/** `name` as a RegExp source: every metacharacter escaped (`$` is legal in identifiers). */
function reName(name) {
  return name.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')
}

/** Words before `(` that open a condition or an operand, never a parameter list. */
const NOT_PARAMETER_HEADS = new Set([
  'if', 'for', 'while', 'switch', 'with', 'return', 'typeof', 'await', 'yield', 'new',
  'in', 'of', 'void', 'delete', 'case', 'do', 'else', 'instanceof', 'throw', 'super', 'import',
])

/**
 * The scope structure of a file, computed once: matching brackets (strings
 * skipped), the parameter lists of every function form (with the range they
 * are in scope for) and every `const`/`let`/`var` declarator. When the
 * brackets do not pair up (a brace inside a regex literal or in JSX text
 * after an apostrophe), every block is taken to be the whole file, so a
 * name bound twice anywhere in it never resolves.
 */
function fileScopes(ctx) {
  if (ctx.scopes) return ctx.scopes
  const code = ctx.code
  const end = code.length + 1
  const close = new Map()
  const stack = []
  let balanced = true
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(code, i) - 1; continue }
    if (ch === '(' || ch === '[' || ch === '{') stack.push(i)
    else if (ch === ')' || ch === ']' || ch === '}') {
      const open = stack.pop()
      if (open === undefined || '([{'.indexOf(code[open]) !== ')]}'.indexOf(ch)) { balanced = false; break }
      close.set(open, i + 1)
    }
  }
  if (stack.length > 0) balanced = false
  const blocks = balanced ? [...close].filter(([open]) => code[open] === '{') : []
  /** The innermost block around `at`, or the whole file. */
  const blockAt = (at) => {
    let best = [0, end]
    for (const [open, shut] of blocks) if (open < at && at < shut && open > best[0]) best = [open, shut]
    return best
  }
  const bracketEnd = (open) => close.get(open) ?? closeBracket(code, open)

  // Parameter lists: `(…) =>`, `function name(…) {`, a method `name(…) {`, `catch (…) {`.
  const params = []
  for (const [open, shut] of close) {
    if (code[open] !== '(') continue
    const after = code.slice(shut, shut + 300)
    const arrow = /^\s*(?::[^;()?=]*?)?=>/.exec(after)
    let scopeEnd = -1
    if (arrow) {
      scopeEnd = arrowBodyEnd(code, shut + arrow[0].length)
    } else {
      const head = /([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*$/.exec(code.slice(Math.max(0, open - 120), open))
      const body = /^\s*(?::[^;(){}=]*?)?\{/.exec(after)
      if (head && body && !NOT_PARAMETER_HEADS.has(head[1])) scopeEnd = bracketEnd(shut + body[0].length - 1)
    }
    if (scopeEnd !== -1) params.push({ open, text: code.slice(open + 1, shut - 1), scope: balanced ? [open, scopeEnd] : [0, end] })
  }

  // Declarators: `const a = 1, b = 2`, `let { x: y } = o`, `for (const p of list)`.
  const declarators = []
  for (const m of code.matchAll(/(?<![\w$.])(const|let|var)\s+/g)) {
    const keyword = m[1]
    let scope
    const forHead = /\bfor\s*(?:await\s*)?\(\s*$/.exec(code.slice(Math.max(0, m.index - 30), m.index))
    if (!balanced || keyword === 'var') {
      scope = [0, end]
    } else if (forHead) {
      const open = code.lastIndexOf('(', m.index)
      const bodyAt = skipSpace(code, bracketEnd(open))
      scope = [open, code[bodyAt] === '{' ? bracketEnd(bodyAt) : expressionEnd(code, bodyAt)]
    } else {
      scope = blockAt(m.index)
    }
    let i = m.index + m[0].length
    for (let n = 0; n < 50; n++) {
      i = skipSpace(code, i)
      const at = i
      let name = null
      let pattern = null
      if (code[i] === '{' || code[i] === '[') {
        const shut = bracketEnd(i)
        pattern = code.slice(i, shut)
        i = shut
      } else {
        const id = /^[A-Za-z_$][\w$]*/.exec(code.slice(i, i + 100))
        if (!id) break
        name = id[0]
        i += name.length
      }
      const init = /^\s*!?\s*(?::[^=;\n]+)?=(?![=>])/.exec(code.slice(i, i + 300))
      if (init) {
        const textPos = skipSpace(code, i + init[0].length)
        i = expressionEnd(code, textPos)
        declarators.push({ keyword, name, pattern, at, textPos, text: code.slice(textPos, i), scope })
      } else {
        declarators.push({ keyword, name, pattern, at, textPos: -1, text: null, scope })
      }
      i = skipSpace(code, i)
      if (code[i] !== ',') break
      i++
    }
  }

  ctx.scopes = { balanced, end, blockAt, params, declarators, sites: new Map() }
  return ctx.scopes
}

/**
 * Does the binding pattern or parameter list `text` bind `name`? A member
 * read (`a.name`) does not; in a declaration pattern a key (`{ name: x }`)
 * does not either. In a parameter list every other mention counts (a type
 * annotation, a key, a default value), so the check errs toward failing.
 */
function bindsName(text, name, keyBinds) {
  for (const m of text.matchAll(new RegExp(`(?<![\\w$])${reName(name)}(?![\\w$])`, 'g'))) {
    const before = text.slice(Math.max(0, m.index - 3), m.index)
    if (before.endsWith('.') && !before.endsWith('...')) continue
    if (!keyBinds && /^\s*:/.test(text.slice(m.index + name.length))) continue
    return true
  }
  return false
}

/**
 * Every place `name` is bound in a file, each with the range it is in scope
 * for: declarators (`init` with a usable initializer, `pattern` without),
 * parameters, `function`/`class` declarations and relative named imports.
 */
function bindingSites(ctx, name) {
  const scopes = fileScopes(ctx)
  const cached = scopes.sites.get(name)
  if (cached) return cached
  const code = ctx.code
  const sites = []
  for (const d of scopes.declarators) {
    if (d.pattern !== null) {
      if (bindsName(d.pattern, name, false)) sites.push({ kind: 'pattern', at: d.at, scope: d.scope })
    } else if (d.name === name) {
      sites.push(d.text === null
        ? { kind: 'pattern', at: d.at, scope: d.scope }
        : { kind: 'init', keyword: d.keyword, at: d.at, textPos: d.textPos, text: d.text, scope: d.scope })
    }
  }
  for (const p of scopes.params) if (bindsName(p.text, name, true)) sites.push({ kind: 'param', at: p.open, scope: p.scope, list: p })
  for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${reName(name)}\\s*=>`, 'g'))) {
    sites.push({ kind: 'pattern', at: m.index, scope: scopes.balanced ? [m.index, arrowBodyEnd(code, m.index + m[0].length)] : [0, scopes.end] })
  }
  for (const m of code.matchAll(new RegExp(`(?<![\\w$.])(function\\s*\\*?|class)\\s+${reName(name)}(?![\\w$])`, 'g'))) {
    const kind = m[1].startsWith('function') ? 'function' : 'pattern'
    sites.push({ kind, at: m.index, scope: scopes.blockAt(m.index) })
  }
  const imported = ctx.imports.get(name)
  if (imported) sites.push({ kind: 'import', at: 0, scope: [0, scopes.end], imported })
  scopes.sites.set(name, sites)
  return sites
}

/** Assignments to `name` anywhere in the file (`=`, `+=`, `??=`, `++`, …), as `{ at, rhsAt }`. */
function writesOf(ctx, name) {
  const code = ctx.code
  const declared = new Set(bindingSites(ctx, name).map((s) => s.at))
  const n = reName(name)
  const out = []
  const assign = new RegExp(`(?<![\\w$.])${n}\\s*(?:\\*\\*|<<|>>>|>>|\\?\\?|\\|\\||&&|[-+*/%&|^])?=(?![=>])`, 'g')
  for (const m of code.matchAll(assign)) if (!declared.has(m.index)) out.push({ at: m.index, rhsAt: m.index + m[0].length })
  const step = new RegExp(`(?:\\+\\+|--)\\s*${n}(?![\\w$])|(?<![\\w$.])${n}\\s*(?:\\+\\+|--)`, 'g')
  for (const m of code.matchAll(step)) out.push({ at: m.index, rhsAt: -1 })
  return out
}

/**
 * Where `name` is bound for a use at `pos`. Scope-aware and fail-closed: it
 * resolves only when exactly one binding of `name` is in scope at `pos`, and
 * that binding is
 *  - a `const` declarator with an initializer, written before `pos`;
 *  - a `let`/`var` declarator with an initializer, before `pos`, when nothing
 *    in the file assigns to `name` (`=`, `+=`, `??=`, `||=`, `++`, …);
 *  - a `function` declaration; or
 *  - a relative named import whose module binds it the same way.
 * A second binding in scope (an inner `const`, a parameter, a destructuring
 * pattern, a `for … of` or `catch` binding) shadows or doubles it, and a
 * binding without a usable initializer (a pattern, a parameter, `let x;`)
 * says nothing: the name is unresolved, and the call needs a "dynamicCalls"
 * reason. `textPos` is the absolute offset of `text` in the file.
 */
function findBinding(byFile, ctx, name, pos) {
  const live = bindingSites(ctx, name).filter((s) => s.scope[0] <= pos && pos < s.scope[1])
  if (live.length !== 1) return null
  const [site] = live
  if (site.kind === 'init') {
    if (site.at >= pos) return null
    if (site.keyword !== 'const' && writesOf(ctx, name).length > 0) return null
    return { ctx, pos: site.at, textPos: site.textPos, isVariable: true, text: site.text }
  }
  if (site.kind === 'function') {
    const textPos = site.at
    return { ctx, pos: site.at, textPos, isVariable: false, text: readTopLevelFunction(ctx.code, textPos) }
  }
  if (site.kind === 'import') {
    const target = byFile.get(site.imported.file)
    return target ? findBinding(byFile, target, site.imported.name, target.code.length) : null
  }
  return null
}

/** Does any declarator of, or assignment to, `name` in the file write an API path? */
function nameWritesApiPath(ctx, name) {
  if (bindingSites(ctx, name).some((s) => s.kind === 'init' && API_PATH.test(s.text))) return true
  return writesOf(ctx, name).some((w) => w.rhsAt !== -1 && API_PATH.test(readExpression(ctx.code, w.rhsAt)))
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
    for (const base of bindingBases(byFile, binding.ctx, t.name, binding.textPos + t.index, seen)) bases.push(base + t.rest)
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
 * `NAME`, `NAME!`, `NAME(…)` or `NAME<T>(…)` spanning all of `e`, as
 * `{ name, call }`, or null. `base + tail` and `props.url` are not references.
 */
function wholeReference(e) {
  const head = /^[A-Za-z_$][\w$]*/.exec(e)
  if (!head) return null
  let i = skipSpace(e, skipTypeArgs(e, skipSpace(e, head[0].length)))
  let call = false
  if (e[i] === '(') {
    call = true
    i = skipSpace(e, closeBracket(e, i))
  } else {
    i = skipSpace(e, head[0].length)
  }
  if (e[i] === '!') i = skipSpace(e, i + 1)
  return i === e.length ? { name: head[0], call } : null
}

/**
 * What a function binding can return, as `{ text, pos }` with absolute
 * offsets: an arrow's expression body, or every `return` in a block body
 * (nested callbacks' returns included, so the check errs toward failing).
 */
function functionReturns(code, textPos, text) {
  const body = functionBody(text)
  if (!body) return []
  if (!body.block) return [{ text: readExpression(code, textPos + body.at), pos: textPos + body.at }]
  return blockReturns(code, textPos, text, body.at)
}

/**
 * Where the body of the function `text` opens, as `{ at, block }`, or null
 * when `text` is not a function (`function (…) {`, `(…) =>`, `x =>`).
 */
function functionBody(text) {
  if (/^(?:async\s+)?function\b/.test(text)) {
    const at = text.indexOf('{', closeBracket(text, text.indexOf('(')))
    return at === -1 ? null : { at, block: true }
  }
  let i = skipSpace(text, /^async\b/.test(text) ? 5 : 0)
  i = skipSpace(text, skipTypeArgs(text, i))
  if (text[i] === '(') i = closeBracket(text, i)
  else if (/[A-Za-z_$]/.test(text[i] ?? '')) i += /^[A-Za-z_$][\w$]*/.exec(text.slice(i))[0].length
  else return null
  const arrow = /^\s*(?::[^=;{}]*?)?=>/.exec(text.slice(i))
  if (!arrow) return null
  i = skipSpace(text, i + arrow[0].length)
  return { at: i, block: text[i] === '{' }
}

function blockReturns(code, textPos, text, bodyAt) {
  const body = text.slice(bodyAt, closeBracket(text, bodyAt))
  const out = []
  for (const m of body.matchAll(/\breturn\b/g)) {
    const at = textPos + bodyAt + m.index + m[0].length
    out.push({ text: readExpression(code, at), pos: at })
  }
  return out
}

/** True when `expr` has `||` outside brackets and strings. */
function hasTopLevelOr(expr) {
  let depth = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(expr, i) - 1; continue }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (depth === 0 && ch === '|' && expr[i + 1] === '|') return true
  }
  return false
}

/**
 * Can the gate tell which route this call argument reaches? Yes when it is
 * (or each ternary branch is) `null`, one '/v1/…' literal spanning the whole
 * expression, a template opening with a resolvable path binding or with
 * `${API_URL}/v1/…`, a name whose initializer resolves, or a call to a
 * function whose every return resolves. A literal joined to anything else
 * (`'/v1/x/' + id`), a `??`/`||` fallback and a member read (`props.url`)
 * do not resolve.
 */
function argResolves(byFile, ctx, expr, pos, seen = new Set()) {
  let e = expr.trim()
  while (e.startsWith('(') && closeBracket(e, 0) === e.length) e = e.slice(1, -1).trim()
  if (e === '') return false
  // `(() => { …; return `/v1/x?${qs}` })()`: every return must resolve.
  const iife = e.startsWith('(') ? /^\s*\(\s*\)$/.exec(e.slice(closeBracket(e, 0))) : null
  if (iife) {
    const at = ctx.code.indexOf(e, pos)
    if (at === -1) return false
    const returns = functionReturns(ctx.code, skipSpace(ctx.code, at + 1), e.slice(1, closeBracket(e, 0) - 1).trim())
    return returns.length > 0 && returns.every((r) => argResolves(byFile, ctx, r.text, r.pos, seen))
  }
  if (e === 'null' || e === 'undefined') return true
  const branches = ternaryBranches(e)
  if (branches) return branches.every((b) => argResolves(byFile, ctx, b, pos, seen))
  // `props.url || cond && '/v1/x'` is `props.url || (…)`: the prop can be the path.
  if (hasTopLevelOr(e)) return false
  const and = /^[^'"`]+?&&([\s\S]+)$/.exec(e)
  if (and) return argResolves(byFile, ctx, and[1], pos, seen)
  if (/^['"`]/.test(e)) {
    if (skipString(e, 0) !== e.length) return false
    if (/^(['"`])\/v1\//.test(e)) return true
    const composed = /^`\$\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(e)
    if (!composed) return false
    const bases = bindingBases(byFile, ctx, composed[1], pos)
    // `${RESOLVED_API_URL}/v1/…`: a base URL, then the path written out.
    if (bases.length === 0) return readAdminLiteral(e, 0).text.slice(3).startsWith('/v1/')
    // The prefix must resolve as a whole (every ternary branch), not merely hold one path.
    return argResolves(byFile, ctx, composed[1], pos, seen)
  }
  const ref = wholeReference(e)
  if (!ref) return false
  const key = `${ctx.file}#${ref.name}@${pos}`
  if (seen.has(key)) return false
  seen.add(key)
  const binding = findBinding(byFile, ctx, ref.name, pos)
  if (!binding) return false
  const init = binding.text.trim()
  const isFunction = !binding.isVariable || functionBody(init) !== null
  if (ref.call !== isFunction) return false
  // `const url = buildUrl(tab)`, `const p = `${base}/x``, `const p = c ? '/v1/a' : null`.
  if (!isFunction) return argResolves(byFile, binding.ctx, init, binding.textPos, seen)
  const returns = functionReturns(binding.ctx.code, binding.textPos, binding.text)
  return returns.length > 0 && returns.every((r) => argResolves(byFile, binding.ctx, r.text, r.pos, seen))
}

/** Helpers that take the API path as the `url` option of their first argument. */
export const ADMIN_URL_OPTION_CALLS = ['openSseStream']

/** A '/v1/…' API path written after a quote or a `${API_URL}`. '/auth/v1/' is not one. */
const API_PATH = /(?:['"`]|\})\/v1\//

/** Does a fetch argument (or the initializer of the name passed) write an API path? */
function writesApiPath(byFile, ctx, arg, pos) {
  if (API_PATH.test(arg)) return true
  const ref = wholeReference(arg)
  if (!ref || ref.call) return false
  const binding = findBinding(byFile, ctx, ref.name, pos)
  if (binding) return binding.isVariable && API_PATH.test(binding.text)
  // A name that does not resolve (bound twice, reassigned) is checked when
  // any of its declarators or assignments writes an API path.
  return nameWritesApiPath(ctx, ref.name)
}

/**
 * The value text of property `key` in the object literal `text`
 * (`{ url: x, … }` gives 'x'; shorthand `{ url }` gives 'url'), or null.
 */
function objectProperty(text, key) {
  if (!text.startsWith('{')) return null
  let i = 1
  while (i < text.length) {
    i = skipSpace(text, i)
    const k = /^(?:([A-Za-z_$][\w$]*)|(['"])([^'"]*)\2)/.exec(text.slice(i))
    if (k && (k[1] ?? k[3]) === key) {
      const j = skipSpace(text, i + k[0].length)
      if (text[j] === ':') return readExpression(text, j + 1).trim()
      if (text[j] === ',' || text[j] === '}') return key
    }
    const end = expressionEnd(text, i)
    if (text[end] !== ',') return null
    i = end + 1
  }
  return null
}

/**
 * The named function whose FIRST parameter is the `param` in scope at `pos`,
 * or null. The parameter must be the only binding of `param` there (see
 * findBinding), and the function a `function NAME(` or a
 * `const|let NAME = (async) (function) (` whose own parameter list it is.
 */
function forwardingFunction(ctx, param, pos) {
  const live = bindingSites(ctx, param).filter((s) => s.scope[0] <= pos && pos < s.scope[1])
  if (live.length !== 1 || live[0].kind !== 'param') return null
  const { list } = live[0]
  const first = /^\s*([A-Za-z_$][\w$]*)\s*(?:[:?,=]|$)/.exec(list.text)
  if (!first || first[1] !== param) return null
  const before = ctx.code.slice(Math.max(0, list.open - 200), list.open)
  const named = /(?:function\s+([\w$]+)\s*(?:<[^>]*>)?|(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\s*)?)\s*$/.exec(before)
  if (!named) return null
  const found = named[1] ?? named[2]
  const exported = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let)\\s+${reName(found)}\\b`).test(ctx.code)
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
      const names = [...shared, ...local.get(ctx.file), ...ADMIN_URL_OPTION_CALLS, 'fetch']
      const re = new RegExp(`\\b(${names.map(reName).join('|')})\\b\\s*`, 'g')
      let m
      while ((m = re.exec(ctx.code)) !== null) {
        if (/(?:function|\.)\s*$/.test(ctx.code.slice(Math.max(0, m.index - 40), m.index))) continue
        let i = skipTypeArgs(ctx.code, re.lastIndex)
        while (/\s/.test(ctx.code[i] ?? '')) i++
        if (ctx.code[i] !== '(') continue
        let arg = readExpression(ctx.code, i + 1).trim()
        if (m[1] === 'fetch') {
          // Raw fetch also reaches Supabase, signed URLs and static files: it
          // is checked once its argument writes an API path.
          if (!writesApiPath(byFile, ctx, arg, m.index)) continue
          if (!argResolves(byFile, ctx, arg, m.index)) unresolved.push({ file: ctx.file, call: m[1], arg })
          continue
        }
        if (ADMIN_URL_OPTION_CALLS.includes(m[1])) {
          // The path is the `url` option; without one the call is unchecked.
          arg = objectProperty(arg, 'url') ?? arg
          if (!argResolves(byFile, ctx, arg, m.index)) unresolved.push({ file: ctx.file, call: m[1], arg })
          continue
        }
        if (argResolves(byFile, ctx, arg, m.index)) continue
        const forwarder = /^[A-Za-z_$][\w$]*$/.test(arg) ? forwardingFunction(ctx, arg, m.index) : null
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
  return bestMatch(segs, routes).paths
}

/**
 * The most specific server paths for `segs`, and `computed`: how many of the
 * literal's `${…}` segments land on a static server segment in that match.
 * Above 0, the literal picks the route at run time (`/projects/${id}/${action}`
 * reaches every `/projects/:id/<static>`), so the gate cannot tell which one.
 */
function bestMatch(segs, routes) {
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
  return { paths: best, computed: bestScore ? bestScore[0] : 0 }
}

/**
 * `{ used: Map<key, route>, unresolved: literal[], computed: call[] }` for the
 * console. `computed` lists each literal that fills a static server segment
 * with a run-time value, as `{ file, arg: literal, routes }`.
 * Those routes still count as used; the literal itself fails the check unless
 * "computedPaths" gives a reason for that file and literal text.
 */
export function consoleRoutes(adminLiterals, routes) {
  const used = new Map()
  const unresolved = []
  const computed = new Map()
  for (const lit of adminLiterals) {
    const segs = normalizeAdminLiteral(lit.literal)
    const { paths, computed: dynamicSegments } = segs ? bestMatch(segs, routes) : { paths: [], computed: 0 }
    if (paths.length === 0) {
      unresolved.push(lit)
      continue
    }
    if (dynamicSegments > 0) computed.set(`${lit.file}\u0000${lit.literal}`, { file: lit.file, arg: lit.literal, routes: paths })
    for (const r of routes) {
      if (!paths.includes(r.path)) continue
      const key = `${r.method} ${r.path}`
      if (!used.has(key)) used.set(key, { ...r, from: new Set() })
      used.get(key).from.add(lit.file)
    }
  }
  return { used, unresolved, computed: [...computed.values()] }
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

/**
 * Check `found` ({ file, arg }) against `allowed` ({ file: { arg: reason } }):
 * an unlisted one gets `unlisted(item)`, and a listed one that `found` no
 * longer holds is stale, so neither allowlist can grow silently.
 */
function checkAllowlist(found, allowed, key, unlisted, errors) {
  const seen = new Set()
  for (const item of found) {
    const reason = allowed[item.file]?.[item.arg]
    if (typeof reason === 'string' && reason.trim()) seen.add(`${item.file}\u0000${item.arg}`)
    else errors.push(unlisted(item))
  }
  for (const [file, args] of Object.entries(allowed)) {
    for (const arg of Object.keys(args)) {
      if (!seen.has(`${file}\u0000${arg}`)) errors.push(`${key} ${file} "${arg}": stale entry; no console call uses it any more. Remove it from ${PATHS.mapping}.`)
    }
  }
}

export function checkParity({ used, mapping, mcpTools, cliCommands, dynamicCalls = [], computedPaths = [] }) {
  const errors = []
  // A console call whose path the gate cannot resolve is a route it cannot
  // see. It fails unless "dynamicCalls" names it (by file and argument text).
  checkAllowlist(dynamicCalls, mapping.dynamicCalls ?? {}, 'dynamicCalls', (call) =>
    `${call.file}: ${call.call}(${call.arg}, …) builds its path in a way this check cannot follow, so the route it calls is unchecked. Use a '/v1/…' literal or a same-file path constant, or add a reason under "dynamicCalls" in ${PATHS.mapping}.`, errors)
  // A path that picks a static segment at run time reaches a set of routes the
  // gate can only over-approximate. It fails unless "computedPaths" names it
  // (by file and the path with each `${…}` written as `${}`).
  checkAllowlist(computedPaths, mapping.computedPaths ?? {}, 'computedPaths', (p) =>
    `${p.file}: path ${p.arg} fills a static server segment with a run-time value, so it may reach any of ${p.routes.length} route(s) (${p.routes.slice(0, 3).join(', ')}${p.routes.length > 3 ? ', …' : ''}). Write each static segment out, or add a reason under "computedPaths" in ${PATHS.mapping}.`, errors)
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
  const { used, unresolved, computed: computedPaths } = consoleRoutes(adminLiterals, routes)
  const dynamicCalls = extractDynamicCalls(adminFiles)
  const mcpTools = extractMcpTools(readFileSync(path.join(root, PATHS.mcpCatalog), 'utf8'))
  const cliCommands = extractCliCommands(readSources(root, PATHS.cliCommands))
  const mapping = JSON.parse(readFileSync(path.join(root, PATHS.mapping), 'utf8'))
  return { routes, used, unresolved, dynamicCalls, computedPaths, mcpTools, cliCommands, mapping }
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
    `Surface parity OK: ${stats.routes} console routes; ${stats.mcp} with an MCP tool, ${stats.cli} with a CLI command, ${stats.allowed} allowlisted (${reasons || 'none'}); ${inputs.dynamicCalls.length} dynamic call(s) and ${inputs.computedPaths.length} computed path(s) with a stated reason; ${inputs.unresolved.length} admin literals matched no route.`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
