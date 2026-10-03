/**
 * FILE: packages/cli/src/recipe/local.ts
 * PURPOSE: The local half of the App Recipe (Plan 019 Phase 1b):
 *   - starterManifest: a first mushi.recipe.json from what the repo shows;
 *   - checkRecipe: validate the manifest and its token files, and run the
 *     design deviance scan with the server's own engine (engine/, byte-identical
 *     to packages/server/supabase/functions/_shared): the same files, the same
 *     rule ids (off_token_color, off_token_font, off_scale_spacing,
 *     off_scale_radius, contrast_below_aa, raw_interactive_element) and the same
 *     0–100 score, so the host's CI can push them with
 *     `mushi recipe check --push` (POST /v1/ingest/recipe).
 * Runs in the repo's own CI; Mushi never clones the repo.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { DesignRuleId, DevianceBreakdownEntry, DevianceFinding } from './engine/design-engine-types.ts'
import { computeDeviance, readScanTokens, selectScanFiles, tokenFilePaths, type LocalFile } from './engine/design-scan.ts'
import { judgingSet } from './engine/design-set-plan.ts'
import { normalizeRepoPath } from './engine/recipe-glob.ts'
import { readScanManifest, type LocalIssue } from './manifest-shape.js'

export const MANIFEST = 'mushi.recipe.json'
const MAX_MANIFEST_BYTES = 64 * 1024
/** The ingest's caps (POST /v1/ingest/recipe): files pushed, bytes per file, bytes in total. */
const PUSH_MAX_FILES = 60
const PUSH_MAX_FILE_BYTES = 512 * 1024
const PUSH_MAX_TOTAL_BYTES = 4 * 1024 * 1024
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', 'Pods', '.gradle'])

interface DesignCheck {
  /** 0 (on-system) … 100; null when no rule could judge anything. */
  score: number | null
  breakdown: DevianceBreakdownEntry[]
  /** True counts per rule (findings are listed in full here, capped only on push). */
  counts: Partial<Record<DesignRuleId, number>>
  scannedFiles: number
  scannedLines: number
  matchedFiles: number
  truncated: boolean
  /** The token set judged against, or null when there is none. */
  set: string | null
}

export interface RecipeCheck {
  ok: boolean
  manifest: Record<string, unknown> | null
  issues: LocalIssue[]
  tokenCount: number
  /** Every finding, sorted by severity, file and line (the server's order). */
  findings: DevianceFinding[]
  design: DesignCheck | null
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

/**
 * The repo's files as the server's scan sees them: the tracked files (git
 * ls-files, so untracked build output never counts), with their sizes. Falls
 * back to a directory walk outside a git checkout.
 */
function listRepoFiles(root: string): Array<{ path: string; size: number }> {
  let paths: string[]
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
    paths = out.split('\0').filter(Boolean)
  } catch {
    paths = walk(root)
  }
  const entries: Array<{ path: string; size: number }> = []
  for (const p of paths) {
    try {
      const st = statSync(join(root, p))
      if (st.isFile()) entries.push({ path: p, size: st.size })
    } catch {
      // Tracked but deleted in the working tree: the commit being pushed does not have it either.
    }
  }
  return entries
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

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Read a repo file the way the server's snapshot does: absent, too large, or its text. */
function localReader(root: string): (path: string, maxBytes: number) => LocalFile {
  return (path, maxBytes) => {
    const safe = normalizeRepoPath(path)
    const full = safe ? join(root, safe) : null
    if (!full || !existsSync(full) || !statSync(full).isFile()) return { kind: 'absent' }
    const size = statSync(full).size
    if (size > maxBytes) return { kind: 'too_large', size }
    return { kind: 'file', text: readFileSync(full, 'utf8') }
  }
}

export function checkRecipe(root: string): RecipeCheck {
  const issues: LocalIssue[] = []
  const files: Record<string, string> = {}
  const path = join(root, MANIFEST)
  const fail = (message: string): RecipeCheck => ({ ok: false, manifest: null, issues: [...issues, { severity: 'error', message, path: MANIFEST }], tokenCount: 0, findings: [], design: null, files })
  if (!existsSync(path)) return fail(`No ${MANIFEST} at the repo root. Run \`mushi recipe init\` to write one.`)
  if (statSync(path).size > MAX_MANIFEST_BYTES) return fail(`${MANIFEST} is over 64 KB.`)
  const text = readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return fail(`${MANIFEST} is not valid JSON: ${(err as Error).message}`)
  }
  if (!isObject(parsed) || parsed.version !== 1) return fail(`${MANIFEST} needs "version": 1.`)
  const manifest = parsed
  files[MANIFEST] = text

  const change = isObject(manifest.change) ? manifest.change : {}
  for (const p of asStringList(change.allowPaths)) {
    if (p.startsWith('.github') || /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|[^/]*\.lock)$/.test(p)) {
      issues.push({ severity: 'error', message: `change.allowPaths entry "${p}" points at files Mushi never writes (workflows, lockfiles).`, path: MANIFEST })
    }
    if (/(^|\/)\.env(?!\.example)/.test(p)) issues.push({ severity: 'error', message: `change.allowPaths entry "${p}" would let a PR touch env files.`, path: MANIFEST })
  }

  const shaped = readScanManifest(manifest)
  issues.push(...shaped.issues)
  const scanManifest = shaped.manifest
  for (const t of scanManifest.design?.tokens ?? []) {
    if (!normalizeRepoPath(t.path)) issues.push({ severity: 'error', message: `A design.tokens path is not a safe repo path: ${t.path}`, path: MANIFEST })
  }

  const tree = listRepoFiles(root)
  const read = localReader(root)
  const { tokens, issues: tokenIssues } = readScanTokens(scanManifest, tree.map((e) => e.path), read)
  for (const i of tokenIssues) issues.push({ severity: i.severity, message: i.message, ...(i.file ? { path: i.file } : {}) })
  const judged = judgingSet(tokens)
  const tokenCount = judged?.tokens.length ?? 0

  // Files to push: the manifest, then every token file the sets name (active set first), then design.css.
  let pushedBytes = text.length
  const addPush = (p: string) => {
    if (files[p] !== undefined || Object.keys(files).length >= PUSH_MAX_FILES) return
    const f = read(p, PUSH_MAX_FILE_BYTES)
    if (f.kind !== 'file' || pushedBytes + f.text.length > PUSH_MAX_TOTAL_BYTES) return
    files[p] = f.text
    pushedBytes += f.text.length
  }
  for (const p of tokenFilePaths(tokens)) addPush(p)
  const design = isObject(manifest.design) ? manifest.design : {}
  for (const c of Array.isArray(design.css) ? design.css : []) {
    const rel = isObject(c) && typeof c.path === 'string' ? normalizeRepoPath(c.path) : null
    if (rel) addPush(rel)
  }

  let findings: DevianceFinding[] = []
  let designCheck: DesignCheck | null = null
  if (judged) {
    const pick = selectScanFiles(tree, scanManifest, [...tokenFilePaths(tokens), MANIFEST])
    const texts = new Map<string, string | null>()
    for (const p of pick.files) {
      const f = read(p, Number.POSITIVE_INFINITY)
      texts.set(p, f.kind === 'file' ? f.text : null)
    }
    const result = computeDeviance({ manifest: scanManifest, tokens }, texts)
    findings = result.findings
    designCheck = {
      score: result.score,
      breakdown: result.breakdown,
      counts: result.counts,
      scannedFiles: result.scannedFiles,
      scannedLines: result.scannedLines,
      matchedFiles: pick.matched,
      truncated: pick.truncated,
      set: judged.name,
    }
  } else if (scanManifest.design?.tokens?.length) {
    issues.push({ severity: 'info', message: 'The token files define no tokens, so there is nothing to judge the code against.' })
  }
  return { ok: !issues.some((i) => i.severity === 'error'), manifest, issues, tokenCount, findings, design: designCheck, files }
}

/** The literal-rule findings and counts the push sends; contrast is judged again on the server from the tokens. */
export function pushPayload(check: RecipeCheck, maxFindings = 500) {
  if (!check.design) return null
  // Literal findings always carry a file and a line; contrast findings (no line) are the server's to judge.
  const literal = check.findings.filter((f): f is DevianceFinding & { file_path: string; line: number } => f.rule_id !== 'contrast_below_aa' && f.file_path !== null && f.line !== null)
  const counts: Partial<Record<DesignRuleId, number>> = { ...check.design.counts }
  delete counts.contrast_below_aa
  return {
    engine: 1 as const,
    scannedFiles: check.design.scannedFiles,
    scannedLines: check.design.scannedLines,
    matchedFiles: check.design.matchedFiles,
    truncated: check.design.truncated,
    counts,
    score: check.design.score,
    findings: literal.slice(0, maxFindings).map((f) => ({
      ruleId: f.rule_id,
      filePath: f.file_path,
      line: f.line,
      col: f.col,
      value: f.value.slice(0, 200),
      message: f.message.slice(0, 500),
      suggestion: f.suggestion,
    })),
  }
}
