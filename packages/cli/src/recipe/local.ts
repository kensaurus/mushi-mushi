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
import { matchGlob, normalizeRepoPath } from './engine/recipe-glob.ts'
import { readTextFileCapped } from '../file-io.js'
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

const FIXTURE_DIR = /(^|\/)(__tests__|__fixtures__|__mocks__|fixtures|tests?|e2e|examples?)\//

/** The remote's default branch (origin/HEAD), else the conventional `main`. */
function gitDefaultBranch(root: string): string {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const branch = ref.replace(/^origin\//, '')
    if (branch) return branch
  } catch {
    // no remote HEAD recorded (fresh clone without it, or not a git checkout)
  }
  return 'main'
}

interface RootPackage {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, unknown>
  workspaces?: unknown
}

/** Env templates checked in at the repo root, in the order `mushi recipe init` prefers them. */
const ENV_EXAMPLES = ['.env.example', '.env.local.example', '.env.sample', '.env.template']
/** Top-level folders a root-level app (Next.js, Vite, Expo) keeps its UI in. */
const ROOT_APP_DIRS = ['app', 'src', 'components', 'features', 'lib', 'hooks', 'pages']
const MAX_LITERAL_GLOBS = 30
const MAX_READ_BYTES = 512 * 1024
const MAX_SCRIPT_FILES = 400
/** Workflow steps that ship something: store uploads, hosting deploys, OTA bundles, package publishes. */
const DEPLOY_STEPS = [
  /upload-google-play/i,
  /upload-testflight/i,
  /\baltool\b/i,
  /app-store-connect/i,
  /\baws\s+s3\s+sync\b/i,
  /\bwrangler\s+(pages\s+)?deploy\b/i,
  /cloudflare\/wrangler-action/i,
  /\bvercel\s+(deploy|--prod)\b/i,
  /\bsupabase\s+functions\s+deploy\b/i,
  /\bcapgo\b/i,
  /\beas\s+update\b/i,
  /\b(npm|pnpm|yarn)\s+publish\b/i,
  /\bchangeset\s+publish\b/i,
]
const WRITES_FILE = /\b(writeFileSync|writeFile|createWriteStream|outputFileSync|outputFile|outputJsonSync|outputJson|writeJsonSync|writeJson|writeTextFile|write_text)\b/

function readCapped(root: string, path: string): string | null {
  const f = readTextFileCapped(join(root, path), MAX_READ_BYTES)
  return f.kind === 'file' ? f.text : null
}

/** The workspace globs the root declares: package.json `workspaces` (array or `{ packages }`) and pnpm-workspace.yaml `packages:`. */
function workspacePatterns(root: string, pkg: RootPackage | null): string[] {
  const out: string[] = []
  const ws = pkg?.workspaces
  const list = Array.isArray(ws) ? ws : isObject(ws) && Array.isArray(ws.packages) ? ws.packages : []
  for (const p of list) if (typeof p === 'string') out.push(p)
  const yaml = readCapped(root, 'pnpm-workspace.yaml')
  if (yaml) {
    let inPackages = false
    for (const line of yaml.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) {
        inPackages = true
        continue
      }
      if (/^\S/.test(line)) inPackages = false
      const item = inPackages ? /^\s+-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/.exec(line) : null
      if (item) out.push(item[1]!)
    }
  }
  return out.map((p) => p.trim().replace(/^\.\//, '').replace(/\/+$/, '')).filter(Boolean)
}

/** The package manager the lockfile shows, as the prefix that runs a package.json script. */
function scriptRunner(files: ReadonlySet<string>): string {
  if (files.has('pnpm-lock.yaml')) return 'pnpm'
  if (files.has('yarn.lock')) return 'yarn'
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun run'
  return 'npm run'
}

/**
 * How a token file is produced. A script under scripts/ that names the path
 * and writes a file, or a package.json script whose command names it, is a
 * generator; a `--check` script that references it also marks it generated.
 * The generator is recorded as the root package.json script that runs it.
 */
function tokenOrigin(
  tokenPath: string,
  scripts: ReadonlyArray<[string, string]>,
  scriptFiles: ReadonlyArray<{ path: string; text: string }>,
  runner: string,
): { role: 'source' } | { role: 'export'; generator?: string } {
  const isCheck = (name: string, cmd: string) => /(^|\s)--check(\s|=|$)/.test(cmd) || /(^|:)check$/.test(name)
  const namesToken = (file: { path: string; text: string }) => {
    if (file.text.includes(tokenPath)) return true
    // A script inside a package may name the token relative to that package.
    const pkgDir = file.path.includes('/scripts/') ? file.path.slice(0, file.path.indexOf('/scripts/')) : ''
    return pkgDir !== '' && tokenPath.startsWith(`${pkgDir}/`) && file.text.includes(tokenPath.slice(pkgDir.length + 1))
  }
  const mentioning = scriptFiles.filter(namesToken)
  const writers = mentioning.filter((f) => WRITES_FILE.test(f.text))
  const runs = (cmd: string, file: string) => cmd.includes(file)

  let generator: string | undefined
  let generated = false
  for (const [name, cmd] of scripts) {
    if (isCheck(name, cmd)) continue
    if (cmd.includes(tokenPath) || writers.some((w) => runs(cmd, w.path))) {
      generated = true
      generator ??= `${runner} ${name}`
    }
  }
  if (writers.length) {
    generated = true
    if (!generator) {
      const w = writers[0]!.path
      generator = /\.(m?js|cjs)$/.test(w) ? `node ${w}` : w
    }
  }
  const checked = scripts.some(([name, cmd]) => isCheck(name, cmd) && (cmd.includes(tokenPath) || mentioning.some((f) => runs(cmd, f.path))))
  if (!generated && !checked) return { role: 'source' }
  return generator && generator.length <= 200 ? { role: 'export', generator } : { role: 'export' }
}

/** A first mushi.recipe.json from what the repo shows. Every value is a starting point to edit. */
export function starterManifest(root: string): Record<string, unknown> {
  // The tracked files, as checkRecipe and the server read them; a walk only outside git (or before the first add).
  const tracked = listRepoFiles(root).map((e) => e.path)
  const files = tracked.length ? tracked : walk(root)
  const fileSet = new Set(files)
  const pkg = readJson(join(root, 'package.json')) as RootPackage | null
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  const rootScripts: Array<[string, string]> = Object.entries(pkg?.scripts ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string')
  const native = files.some((f) => /^capacitor\.config\.(ts|js|json)$/.test(f)) || 'expo' in deps || 'react-native' in deps || files.some((f) => f.startsWith('android/') || f.startsWith('ios/'))
  const platforms = ['web', ...(files.some((f) => f.startsWith('android/')) || 'expo' in deps ? ['android'] : []), ...(files.some((f) => f.startsWith('ios/')) || 'expo' in deps ? ['ios'] : [])]
  // A folder holding ARCHIVED.md is retired code: not this app's design, sources or migrations.
  const archived = files.filter((f) => f.endsWith('/ARCHIVED.md')).map((f) => f.slice(0, -'/ARCHIVED.md'.length))
  const isArchived = (f: string) => archived.some((d) => f.startsWith(`${d}/`))
  const live = (f: string) => !FIXTURE_DIR.test(f) && !isArchived(f)
  // Token files inside tests, fixtures and examples are someone else's design, not this app's.
  const tokenPaths = files
    .filter((f) => live(f) && (/\.tokens\.json$/.test(f) || /(^|\/)dtcg\/[^/]+\.json$/.test(f)))
    .slice(0, 20)
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))

  // Literal scan: a root-level app's folders, then each workspace (or, with none declared, apps|packages/<name>/src).
  const hasSource = (dir: string, ext: RegExp) => files.some((f) => f.startsWith(`${dir}/`) && live(f) && ext.test(f))
  const rootIsApp = files.some((f) => /^(next|vite)\.config\.(js|mjs|cjs|ts|mts)$/.test(f)) || 'expo' in deps || rootScripts.some(([name]) => name === 'dev' || name === 'build')
  const rootDirs = rootIsApp ? ROOT_APP_DIRS.filter((d) => hasSource(d, /\.(ts|tsx|css)$/)) : []
  const patterns = workspacePatterns(root, pkg)
  let packageRoots: string[]
  if (patterns.length) {
    const include = patterns.filter((p) => !p.startsWith('!'))
    const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1))
    const pkgDirs = [...new Set(files.filter((f) => f.endsWith('/package.json') && !f.includes('node_modules/')).map((f) => f.slice(0, -'/package.json'.length)))]
    packageRoots = pkgDirs
      .filter((d) => !isArchived(`${d}/`) && include.some((p) => matchGlob(d, p)) && !exclude.some((p) => matchGlob(d, p)))
      .sort()
      .flatMap((d) => (hasSource(`${d}/src`, /\.(tsx|css)$/) ? [`${d}/src`] : hasSource(d, /\.(tsx|css)$/) ? [d] : []))
  } else {
    packageRoots = [...new Set(files
      .filter((f) => live(f) && /^(apps|packages)\/[^/]+\/src\/.+\.(tsx|css)$/.test(f))
      .map((f) => f.split('/').slice(0, 3).join('/')))]
  }
  const scanRoots = [...new Set([...rootDirs, ...packageRoots])].slice(0, MAX_LITERAL_GLOBS)
  const literalGlobs = scanRoots.length
    ? scanRoots.map((r) => `${r}/**/*.{ts,tsx,css}`)
    : ['src/**/*.{ts,tsx,css}', 'app/**/*.{ts,tsx,css}']
  const migrationsDir = files.find((f) => live(f) && /(^|\/)supabase\/migrations\/[^/]+\.sql$/.test(f))?.replace(/\/[^/]+$/, '')

  const tokens = tokenPaths.length
    ? (() => {
        const scriptFiles = files
          .filter((f) => live(f) && !f.includes('node_modules/') && /(^|\/)scripts\/.+\.(m?[jt]s|c[jt]s|py|sh)$/.test(f))
          .slice(0, MAX_SCRIPT_FILES)
          .flatMap((path) => {
            const text = readCapped(root, path)
            return text === null ? [] : [{ path, text }]
          })
        const runner = scriptRunner(fileSet)
        return tokenPaths.map((path) => ({ path, ...tokenOrigin(path, rootScripts, scriptFiles, runner), format: 'dtcg-2025.10' }))
      })()
    : []

  const manifest: Record<string, unknown> = {
    version: 1,
    app: { name: pkg?.name ?? root.split(/[\\/]/).pop(), kind: native ? 'app' : 'site', platforms },
  }
  if (tokens.length) {
    manifest.design = { tokens, literalScan: { globs: literalGlobs, ignore: ['**/*.test.*'] } }
  }
  if (migrationsDir) manifest.data = { provider: 'supabase', migrationsDir }
  if (workflows.length) {
    manifest.ci = {
      provider: 'github-actions',
      defaultBranch: gitDefaultBranch(root),
      workflows: Object.fromEntries(workflows.map((w) => {
        const name = w.slice('.github/workflows/'.length)
        const steps = (readCapped(root, w) ?? '').split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n')
        const deploys = /^(deploy|publish|release)/.test(name) || DEPLOY_STEPS.some((re) => re.test(steps))
        return [name, { role: deploys ? 'deploy' : 'ci' }]
      })),
    }
  }
  const envExample = ENV_EXAMPLES.find((p) => existsSync(join(root, p)))
  if (envExample) manifest.env = { environments: ['production'], required: [], example: envExample }
  // A generated export is never writable (isWritablePath refuses it), so only source folders are allowed.
  const sourceDirs = tokens.filter((t) => t.role === 'source').map((t) => `${t.path.split('/').slice(0, -1).join('/') || '.'}/**`)
  manifest.change = { allowPaths: [MANIFEST, ...new Set(sourceDirs)] }
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
    if (!safe) return { kind: 'absent' }
    return readTextFileCapped(join(root, safe), maxBytes)
  }
}

export function checkRecipe(root: string): RecipeCheck {
  const issues: LocalIssue[] = []
  const files: Record<string, string> = {}
  const path = join(root, MANIFEST)
  const fail = (message: string): RecipeCheck => ({ ok: false, manifest: null, issues: [...issues, { severity: 'error', message, path: MANIFEST }], tokenCount: 0, findings: [], design: null, files })
  const manifestRead = readTextFileCapped(path, MAX_MANIFEST_BYTES)
  if (manifestRead.kind === 'absent') return fail(`No ${MANIFEST} at the repo root. Run \`mushi recipe init\` to write one.`)
  if (manifestRead.kind === 'too_large') return fail(`${MANIFEST} is over 64 KB.`)
  const text = manifestRead.text
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
