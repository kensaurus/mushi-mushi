/**
 * FILE: packages/cli/src/recipe/local.ts
 * PURPOSE: The local half of the App Recipe (Plan 019 Phase 1b):
 *   - starterManifest: a first mushi.recipe.json from what the repo shows;
 *   - checkRecipe: validate the manifest and its token files, and scan the
 *     declared files for colour literals that match no design token
 *     (`off_token_literal`), so the host's CI can push them with
 *     `mushi recipe check --push` (POST /v1/ingest/recipe).
 * Runs in the repo's own CI; Mushi never clones the repo.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { matchAny, normalizeRepoPath } from './recipe-glob.js'

export const MANIFEST = 'mushi.recipe.json'
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_FILE_BYTES = 512 * 1024
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', 'Pods', '.gradle'])

export interface RecipeIssue {
  severity: 'info' | 'warn' | 'error'
  message: string
  path?: string
}

export interface OffTokenFinding {
  ruleId: 'off_token_literal'
  filePath: string
  line: number
  value: string
}

export interface RecipeCheck {
  ok: boolean
  manifest: Record<string, unknown> | null
  issues: RecipeIssue[]
  tokenCount: number
  findings: OffTokenFinding[]
  scannedFiles: number
  /** The manifest, token and CSS files to push (repo path → text). */
  files: Record<string, string>
}

function walk(root: string, limit = 20_000): string[] {
  const out: string[] = []
  const go = (dir: string) => {
    if (out.length >= limit) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= limit) return
      if (e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) go(full)
      } else if (e.isFile()) out.push(relative(root, full).split(sep).join('/'))
    }
  }
  go(root)
  return out
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** A first mushi.recipe.json from what the repo shows. Every value is a starting point to edit. */
export function starterManifest(root: string): Record<string, unknown> {
  const files = walk(root, 5000)
  const pkg = readJson(join(root, 'package.json')) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  const native = files.some((f) => /^capacitor\.config\.(ts|js|json)$/.test(f)) || 'expo' in deps || 'react-native' in deps || files.some((f) => f.startsWith('android/') || f.startsWith('ios/'))
  const platforms = ['web', ...(files.some((f) => f.startsWith('android/')) || 'expo' in deps ? ['android'] : []), ...(files.some((f) => f.startsWith('ios/')) || 'expo' in deps ? ['ios'] : [])]
  const tokens = files.filter((f) => /\.tokens\.json$/.test(f) || /(^|\/)dtcg\/[^/]+\.json$/.test(f)).slice(0, 20)
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))
  const manifest: Record<string, unknown> = {
    version: 1,
    app: { name: pkg?.name ?? root.split(/[\\/]/).pop(), kind: native ? 'app' : 'site', platforms },
  }
  if (tokens.length) {
    manifest.design = { tokens: tokens.map((path) => ({ path, role: 'source', format: 'dtcg-2025.10' })), literalScan: { globs: ['src/**/*.{ts,tsx,css}', 'app/**/*.{ts,tsx,css}'], ignore: ['**/*.test.*'] } }
  }
  if (files.some((f) => f.startsWith('supabase/migrations/'))) manifest.data = { provider: 'supabase', migrationsDir: 'supabase/migrations' }
  if (workflows.length) manifest.ci = { provider: 'github-actions', defaultBranch: 'main', workflows: Object.fromEntries(workflows.map((w) => [w.slice('.github/workflows/'.length), { role: 'ci' }])) }
  if (existsSync(join(root, '.env.example'))) manifest.env = { environments: ['production'], required: [], example: '.env.example' }
  manifest.change = { allowPaths: [MANIFEST, ...[...new Set(tokens.map((t) => `${t.split('/').slice(0, -1).join('/') || '.'}/**`))]] }
  return manifest
}

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g

function normHex(v: string): string {
  const h = v.toLowerCase()
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h
}

/** Every hex colour a DTCG file defines ($value strings or { hex } objects). */
export function tokenHexes(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const x of node) tokenHexes(x, out)
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if ((k === '$value' || k === 'hex') && typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) out.add(normHex(v))
      else tokenHexes(v, out)
    }
  }
  return out
}

function countTokens(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + countTokens(x), 0)
  if (!node || typeof node !== 'object') return 0
  const o = node as Record<string, unknown>
  return '$value' in o ? 1 : Object.entries(o).reduce((n, [k, v]) => n + (k.startsWith('$') ? 0 : countTokens(v)), 0)
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function checkRecipe(root: string): RecipeCheck {
  const issues: RecipeIssue[] = []
  const files: Record<string, string> = {}
  const path = join(root, MANIFEST)
  const fail = (message: string): RecipeCheck => ({ ok: false, manifest: null, issues: [...issues, { severity: 'error', message, path: MANIFEST }], tokenCount: 0, findings: [], scannedFiles: 0, files })
  if (!existsSync(path)) return fail(`No ${MANIFEST} at the repo root. Run \`mushi recipe init\` to write one.`)
  if (statSync(path).size > MAX_MANIFEST_BYTES) return fail(`${MANIFEST} is over 64 KB.`)
  const text = readFileSync(path, 'utf8')
  let manifest: Record<string, any>
  try {
    manifest = JSON.parse(text)
  } catch (err) {
    return fail(`${MANIFEST} is not valid JSON: ${(err as Error).message}`)
  }
  if (!manifest || typeof manifest !== 'object' || manifest.version !== 1) return fail(`${MANIFEST} needs "version": 1.`)
  files[MANIFEST] = text

  for (const p of asStringList(manifest.change?.allowPaths)) {
    if (p.startsWith('.github') || /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|[^/]*\.lock)$/.test(p)) {
      issues.push({ severity: 'error', message: `change.allowPaths entry "${p}" points at files Mushi never writes (workflows, lockfiles).`, path: MANIFEST })
    }
    if (/(^|\/)\.env(?!\.example)/.test(p)) issues.push({ severity: 'error', message: `change.allowPaths entry "${p}" would let a PR touch env files.`, path: MANIFEST })
  }

  const hexes = new Set<string>()
  let tokenCount = 0
  for (const t of Array.isArray(manifest.design?.tokens) ? manifest.design.tokens : []) {
    const rel = typeof t?.path === 'string' ? normalizeRepoPath(t.path) : null
    if (!rel) {
      issues.push({ severity: 'error', message: `A design.tokens path is not a safe repo path: ${String(t?.path)}`, path: MANIFEST })
      continue
    }
    const full = join(root, rel)
    if (!existsSync(full)) {
      issues.push({ severity: 'error', message: `${rel} is listed in design.tokens but does not exist.`, path: rel })
      continue
    }
    if (statSync(full).size > MAX_FILE_BYTES) {
      issues.push({ severity: 'error', message: `${rel} is over 512 KB.`, path: rel })
      continue
    }
    const body = readFileSync(full, 'utf8')
    const parsed = (() => { try { return JSON.parse(body) } catch { return undefined } })()
    if (parsed === undefined) {
      issues.push({ severity: 'error', message: `${rel} is not valid JSON.`, path: rel })
      continue
    }
    files[rel] = body
    tokenHexes(parsed, hexes)
    tokenCount += countTokens(parsed)
  }
  for (const c of Array.isArray(manifest.design?.css) ? manifest.design.css : []) {
    const rel = typeof c?.path === 'string' ? normalizeRepoPath(c.path) : null
    if (rel && existsSync(join(root, rel)) && statSync(join(root, rel)).size <= MAX_FILE_BYTES) files[rel] = readFileSync(join(root, rel), 'utf8')
  }

  // Off-token literal scan over design.literalScan.globs (only when there are colour tokens to compare against).
  const findings: OffTokenFinding[] = []
  let scannedFiles = 0
  const globs = asStringList(manifest.design?.literalScan?.globs)
  const ignore = [...asStringList(manifest.design?.literalScan?.ignore), ...Object.keys(files)]
  if (globs.length && hexes.size) {
    for (const f of walk(root)) {
      if (!matchAny(f, globs) || matchAny(f, ignore)) continue
      const full = join(root, f)
      if (statSync(full).size > MAX_FILE_BYTES) continue
      scannedFiles++
      const lines = readFileSync(full, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        for (const m of line.matchAll(HEX)) {
          if (!hexes.has(normHex(m[0])) && findings.length < 500) findings.push({ ruleId: 'off_token_literal', filePath: f, line: i + 1, value: m[0] })
        }
      })
    }
  } else if (globs.length) {
    issues.push({ severity: 'info', message: 'design.literalScan is set, but the token files define no colours to compare against.' })
  }
  return { ok: !issues.some((i) => i.severity === 'error'), manifest, issues, tokenCount, findings, scannedFiles, files }
}
