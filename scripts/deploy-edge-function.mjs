#!/usr/bin/env node
// Deploy a Supabase Edge Function via the Management API multipart endpoint.
//
// Mirrors the supabase CLI's `pkg/function/deploy.go` behaviour
// (`POST /v1/projects/{ref}/functions/deploy?slug={slug}`) so deployment
// works on machines where the npm-shipped CLI binary is blocked by Device
// Guard / EDR. Reads token from $SUPABASE_ACCESS_TOKEN, project ref from
// $SUPABASE_PROJECT_REF (falls back to dxptnwrhwsqckaftyymj), and the slug
// from argv[2].
//
// Usage:
//   node scripts/deploy-edge-function.mjs <slug> [--no-verify-jwt|--verify-jwt]
//
// verify_jwt resolution (precedence, highest first):
//   1. CLI flag: --verify-jwt or --no-verify-jwt
//   2. supabase/config.toml: [functions.<slug>] verify_jwt = …
//   3. Platform default: true
//
// This matches what `supabase functions deploy <slug>` would do, so a
// missing entry in config.toml keeps the default JWT gate on (NOT off).
// The previous behaviour of unconditionally passing --no-verify-jwt from
// CI silently disabled the gate for the six functions that intentionally
// rely on the platform default (stripe-webhooks, slack-interactions,
// soc2-evidence, usage-aggregator, intelligence-report, generate-synthetic).
//
// The script bundles `packages/server/supabase/functions/<slug>/**` plus
// `packages/server/supabase/functions/_shared/**` (the function tree-shakes
// unused imports server-side, so over-uploading is safe).

import { readFileSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// The deploy endpoint rejects a request over about 5 MB ("request entity too
// large"). Past this many bytes the upload is compacted: comments dropped by
// TypeScript's own parser and printer (never by regex, which cannot tell a
// comment from a `//` inside a string or template), JSON minified. Smaller
// functions upload byte-for-byte, so their stack traces keep source lines.
export const UPLOAD_COMPACT_BYTES = 4_800_000

function loadTypescript() {
  const roots = [process.env.MUSHI_TYPESCRIPT_DIR, SERVER_PKG_ABS, new URL('../apps/admin/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')]
  for (const root of roots) {
    if (!root) continue
    try {
      return createRequire(join(root, 'package.json'))('typescript')
    } catch {
      // try the next root
    }
  }
  return null
}

/** One file's upload bytes with comments removed (TypeScript) or whitespace removed (JSON). */
export function compactSource(ts, rel, buf) {
  if (rel.endsWith('.json')) return Buffer.from(JSON.stringify(JSON.parse(buf.toString('utf8'))), 'utf8')
  if (!/\.(ts|tsx|mts)$/.test(rel)) return buf
  const src = buf.toString('utf8')
  // Directives that live in comments (Deno pragmas, type-check suppressions):
  // keep those files exactly as written.
  if (/@deno-types|\/\/\/\s*<reference|@jsxImportSource|@ts-(ignore|expect-error|nocheck)/.test(src)) return buf
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind)
  const out = stripCommentsAndIndent(ts, sf, src)
  // Self-check: the compacted file must parse to the same tree with the same
  // literal text. If it does not, upload the file as written.
  const outSf = ts.createSourceFile(rel, out, ts.ScriptTarget.Latest, true, kind)
  if (parseFingerprint(ts, outSf) !== parseFingerprint(ts, sf)) {
    console.error(`> ${rel}: compacted form parses differently; uploading it unchanged`)
    return buf
  }
  return Buffer.from(out, 'utf8')
}

/** Node kinds in order (JSDoc excluded: it exists only because of comments) plus every literal's text. */
export function parseFingerprint(ts, sf) {
  const literal = LITERAL_KINDS(ts)
  const kinds = []
  const lits = []
  const visit = (n) => {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return
    kinds.push(n.kind)
    if (literal.has(n.kind)) lits.push(n.getText(sf))
    for (const c of n.getChildren(sf)) visit(c)
  }
  visit(sf)
  return `${kinds.join(',')}\u0000${JSON.stringify(lits)}`
}

const LITERAL_KINDS = (ts) => new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.JsxText,
])

/**
 * Removes comments from the original text (positions come from the parser's
 * trivia scan, which never looks inside a string, template or regex), then
 * drops leading indentation and blank lines on lines that start outside a
 * literal. Code, literals and line breaks between statements stay as written;
 * a removed comment that spanned a line break leaves a line break, so
 * automatic semicolon insertion reads the code the same way.
 */
export function stripCommentsAndIndent(ts, sf, src) {
  const literal = LITERAL_KINDS(ts)
  const protectedRanges = []
  const comments = new Map()
  const addComments = (ranges) => {
    for (const r of ranges ?? []) {
      const text = src.slice(r.pos, r.end)
      if (text.startsWith('///') || /@ts-|@deno-types|eslint|biome-ignore/.test(text)) continue
      comments.set(r.pos, r)
    }
  }
  const visit = (node) => {
    if (literal.has(node.kind)) protectedRanges.push([node.getStart(sf), node.end])
    addComments(ts.getLeadingCommentRanges(src, node.pos))
    addComments(ts.getTrailingCommentRanges(src, node.end))
    for (const child of node.getChildren(sf)) visit(child)
  }
  visit(sf)
  // 1. Drop comments (a multi-line one becomes a line break).
  let text = ''
  let cursor = 0
  const shifts = [] // [originalPos, outputPos] so literal ranges map onto the output
  for (const r of [...comments.values()].sort((a, b) => a.pos - b.pos)) {
    if (r.pos < cursor) continue
    text += src.slice(cursor, r.pos)
    if (src.slice(r.pos, r.end).includes('\n')) text += '\n'
    // Positions from r.end on move by (output length now − r.end).
    shifts.push([r.end, text.length])
    cursor = r.end
  }
  text += src.slice(cursor)
  const mapPos = (p) => {
    let delta = 0
    for (const [orig, out] of shifts) {
      if (orig > p) break
      delta = out - orig
    }
    return p + delta
  }
  const inLiteral = protectedRanges.map(([s, e]) => [mapPos(s), mapPos(e)]).sort((a, b) => a[0] - b[0])
  const insideLiteral = (pos) => {
    let lo = 0
    let hi = inLiteral.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const [s, e] = inLiteral[mid]
      if (pos <= s) hi = mid - 1
      else if (pos >= e) lo = mid + 1
      else return true
    }
    return false
  }
  // 2. Trim indentation and drop blank lines that start outside every literal.
  const out = []
  let lineStart = 0
  for (const line of text.split('\n')) {
    if (insideLiteral(lineStart)) out.push(line)
    else if (line.trim() !== '') {
      // Leading whitespace only: a line can start in code and end inside a
      // template literal, so its trailing whitespace may be literal text.
      out.push(line.trimStart())
    }
    lineStart += line.length + 1
  }
  return out.join('\n') + '\n'
}

const SUPABASE_API = 'https://api.supabase.com'
const FUNCTIONS_ROOT_REL = 'supabase/functions'
const SERVER_PKG_ABS = new URL('../packages/server/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function loadDotenv() {
  for (const f of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(f, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith('#')) continue
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (!m) continue
        let [, k, v] = m
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        if (!(k in process.env)) process.env[k] = v
      }
    } catch {
      // file is optional
    }
  }
}

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return out
    throw err
  }
  for (const ent of entries) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...(await walk(p)))
    } else if (ent.isFile()) {
      out.push(p)
    }
  }
  return out
}

const TEST_FILE = /(\.test\.tsx?|_test\.ts)$|[\\/]__tests__[\\/]/

// Relative specifiers a module can load: static and dynamic imports,
// re-exports, side-effect imports and `new URL('…', import.meta.url)` assets.
const RELATIVE_SPECIFIERS = [
  /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
]

/**
 * The files one function needs: its own directory (minus tests) plus the
 * _shared files it reaches through relative imports. Uploading all of _shared
 * for every function pushed `api` past the deploy endpoint's request size
 * limit ("request entity too large", 2026-10-03). A specifier that names no
 * file (an import written inside a comment) is skipped; a real missing
 * import still fails the server-side bundle, so nothing ships broken.
 */
export function functionUploadFiles(fnFiles) {
  const seen = new Set()
  const visit = (abs) => {
    if (seen.has(abs) || TEST_FILE.test(abs)) return
    seen.add(abs)
    if (!/\.(ts|tsx|js|mjs)$/.test(abs)) return
    const src = readFileSync(abs, 'utf8')
    for (const re of RELATIVE_SPECIFIERS) {
      for (const m of src.matchAll(re)) {
        const target = resolve(dirname(abs), m[1])
        if (statSync(target, { throwIfNoEntry: false })?.isFile()) visit(target)
      }
    }
  }
  for (const f of fnFiles) visit(f)
  return [...seen]
}

function toForwardSlash(p) {
  return p.split(sep).join('/')
}

// Prefer $GITHUB_SHA (set by every GitHub Actions run — no git call needed
// and correct even on a shallow checkout). Falls back to `git rev-parse
// HEAD` for local `npm run deploy`. Never throws — an unresolvable SHA just
// means the hosted MCP version stays at the base semver for this deploy.
function resolveDeploySha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function flag(name) {
  return process.argv.includes(name)
}

// Tiny config.toml reader scoped to `[functions.<slug>] verify_jwt = …`.
// We deliberately don't pull in a full TOML parser — the only key we ever
// need is verify_jwt, and the supabase config schema for it is a trivial
// boolean inside a `[functions.<slug>]` table. Keeping this lightweight
// avoids adding a runtime dependency for one regex.
function readVerifyJwtFromConfig(slug) {
  let raw
  try {
    raw = readFileSync(join(SERVER_PKG_ABS, 'supabase/config.toml'), 'utf8')
  } catch {
    return null
  }
  const lines = raw.split(/\r?\n/)
  const header = `[functions.${slug}]`
  let inBlock = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inBlock = trimmed === header
      continue
    }
    if (!inBlock) continue
    const m = trimmed.match(/^verify_jwt\s*=\s*(true|false)\b/i)
    if (m) return m[1].toLowerCase() === 'true'
  }
  return null
}

async function main() {
  loadDotenv()
  const slug = process.argv[2]
  if (!slug || slug.startsWith('-')) {
    console.error('Usage: node scripts/deploy-edge-function.mjs <slug> [--no-verify-jwt|--verify-jwt]')
    process.exit(2)
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) {
    console.error('error: SUPABASE_ACCESS_TOKEN is not set (export it or add to .env). Generate at https://supabase.com/dashboard/account/tokens')
    process.exit(2)
  }
  const projectRef = process.env.SUPABASE_PROJECT_REF || 'dxptnwrhwsqckaftyymj'

  // Resolve verify_jwt with the same precedence as `supabase functions
  // deploy`: explicit flag > config.toml entry > platform default (true).
  // Importantly, an absent config.toml entry must NOT fall through to
  // false — that would silently weaken JWT enforcement for any new
  // function added to the repo without an explicit verify_jwt setting.
  let verifyJwt
  let verifyJwtSource
  if (flag('--verify-jwt')) {
    verifyJwt = true
    verifyJwtSource = 'flag'
  } else if (flag('--no-verify-jwt')) {
    verifyJwt = false
    verifyJwtSource = 'flag'
  } else {
    const fromConfig = readVerifyJwtFromConfig(slug)
    if (fromConfig === null) {
      verifyJwt = true
      verifyJwtSource = 'platform-default'
    } else {
      verifyJwt = fromConfig
      verifyJwtSource = 'config.toml'
    }
  }

  const fnRootAbs = join(SERVER_PKG_ABS, FUNCTIONS_ROOT_REL)
  const fnDirAbs = join(fnRootAbs, slug)
  if (!statSync(fnDirAbs, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`error: function directory not found: ${fnDirAbs}`)
    process.exit(2)
  }

  const sharedDirAbs = join(fnRootAbs, '_shared')

  const fnFiles = await walk(fnDirAbs)
  const sharedFiles = await walk(sharedDirAbs)
  const allFiles = flag('--all-shared') ? [...fnFiles, ...sharedFiles] : functionUploadFiles(fnFiles)
  if (allFiles.length === 0) {
    console.error('error: no source files discovered')
    process.exit(1)
  }

  const entrypointRel = `${FUNCTIONS_ROOT_REL}/${slug}/index.ts`
  const staticPatterns = []
  // Treat anything inside .well-known as a static asset so it's served as-is.
  if (statSync(join(fnDirAbs, '.well-known'), { throwIfNoEntry: false })?.isDirectory()) {
    staticPatterns.push(`${FUNCTIONS_ROOT_REL}/${slug}/.well-known/*`)
  }

  const metadata = {
    name: slug,
    entrypoint_path: entrypointRel,
    verify_jwt: verifyJwt,
    static_patterns: staticPatterns,
  }

  const form = new FormData()
  form.append('metadata', JSON.stringify(metadata))

  // Stamp _shared/deploy-info.ts with the real deploy commit so hosted MCP's
  // serverInfo.version reflects what's actually running (production-
  // readiness audit item #12) instead of the checked-in `sha: 'dev'`
  // placeholder. Generated in-memory and swapped into the upload only —
  // never written to disk — so a local `npm run deploy` never leaves a
  // dirty working tree.
  const deployInfoRel = toForwardSlash(join(FUNCTIONS_ROOT_REL, '_shared', 'deploy-info.ts'))
  const deploySha = resolveDeploySha()
  const deployedAt = new Date().toISOString()
  const stampedDeployInfo =
    `// AUTO-STAMPED at deploy time by scripts/deploy-edge-function.mjs — do not edit by hand.\n` +
    `export const DEPLOY_INFO: { sha: string; deployedAt: string | null } = {\n` +
    `  sha: ${JSON.stringify(deploySha)},\n` +
    `  deployedAt: ${JSON.stringify(deployedAt)},\n` +
    `}\n`

  const entries = allFiles.map((abs) => {
    const rel = toForwardSlash(`${FUNCTIONS_ROOT_REL}/${relative(fnRootAbs, abs)}`)
    return { rel, buf: rel === deployInfoRel ? Buffer.from(stampedDeployInfo, 'utf8') : readFileSync(abs) }
  })
  const rawBytes = entries.reduce((n, e) => n + e.buf.byteLength, 0)
  if (rawBytes > UPLOAD_COMPACT_BYTES) {
    const ts = loadTypescript()
    if (!ts) {
      console.error(`error: ${slug} is ${(rawBytes / 1024).toFixed(1)} KiB, over the ${(UPLOAD_COMPACT_BYTES / 1024).toFixed(0)} KiB upload budget, and compacting it needs the typescript package (run pnpm install, or set MUSHI_TYPESCRIPT_DIR).`)
      process.exit(1)
    }
    for (const e of entries) e.buf = compactSource(ts, e.rel, e.buf)
    console.error(`> compacted ${(rawBytes / 1024).toFixed(1)} KiB -> ${(entries.reduce((n, e) => n + e.buf.byteLength, 0) / 1024).toFixed(1)} KiB (comments dropped, JSON minified)`)
  }
  // --dump <dir>: write the exact upload to disk (for `deno check` on it) and stop.
  const dumpAt = process.argv.indexOf('--dump')
  if (dumpAt !== -1) {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const dir = process.argv[dumpAt + 1]
    for (const e of entries) {
      const out = join(dir, e.rel)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, e.buf)
    }
    console.error(`> wrote ${entries.length} files to ${dir}; nothing deployed`)
    process.exit(0)
  }
  let totalBytes = 0
  for (const { rel, buf } of entries) {
    totalBytes += buf.byteLength
    form.append('file', new Blob([buf]), rel)
  }

  const url = `${SUPABASE_API}/v1/projects/${projectRef}/functions/deploy?slug=${encodeURIComponent(slug)}`
  console.error(`> POST ${url}`)
  console.error(`> ${allFiles.length} files, ${(totalBytes / 1024).toFixed(1)} KiB total, verify_jwt=${verifyJwt} (source: ${verifyJwtSource})`)
  console.error(`> entrypoint=${entrypointRel}`)

  const started = Date.now()
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
  } catch (err) {
    console.error(`network error after ${Date.now() - started}ms:`, err.message)
    process.exit(1)
  }

  const text = await resp.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }

  if (resp.status === 200 || resp.status === 201) {
    console.error(`deploy ok in ${Date.now() - started}ms — version=${body?.version} sha256=${body?.ezbr_sha256?.slice(0, 12)}`)
    console.log(JSON.stringify(body, null, 2))
    process.exit(0)
  }
  console.error(`deploy failed (HTTP ${resp.status}) after ${Date.now() - started}ms`)
  console.error(typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => {
  console.error('unexpected:', err)
  process.exit(1)
})
