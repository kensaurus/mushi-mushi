/**
 * FILE: packages/server/supabase/functions/_shared/repo-digest.ts
 * PURPOSE: A Gitingest-style text digest of a connected GitHub repo at one
 *          pinned commit: the directory tree plus file contents, ranked and
 *          cut to a token budget, so a coding agent (or a chat window) gets
 *          the repo in one paste. Plan 020 §10.3.1.
 *
 * It reads GitHub's tree and contents APIs directly and never clones, so it
 * works on day one for any repo with a token — it does not depend on the
 * codebase index (which caps a sweep at 300 files).
 *
 * Order of work, so nothing large is downloaded and then thrown away:
 *   1. resolve the ref to a commit SHA (the digest is always about one SHA);
 *   2. read the recursive tree at that SHA (paths + blob sizes);
 *   3. plan: filter, rank, and pick files by estimated tokens (size / 4);
 *   4. fetch only the picked files, a few at a time, with deadlines;
 *   5. assemble: skip binaries, replace secret-bearing files with a notice,
 *      enforce the budget on the real text, and list what was left out.
 *
 * Token counts are an estimate (characters / 4). A real tokenizer costs too
 * much CPU in an edge function, and every label says "estimate".
 *
 * Pure apart from the injected `fetch`: no Deno globals and no npm imports,
 * so vitest and the Deno CI run (no permission flags) can both load it.
 */

import { scanForSecrets } from './secret-scan.ts'
import { sweepTier } from './sweep-file-priority.ts'
import { lookupGithubDefaultBranch, type FetchLike } from './github-branch.ts'

export const DEFAULT_DIGEST_BUDGET_TOKENS = 50_000
export const MIN_DIGEST_BUDGET_TOKENS = 2_000
export const MAX_DIGEST_BUDGET_TOKENS = 200_000

/** Files above this size are never fetched (GitHub's contents API also slows down past 1 MB). */
const MAX_FILE_BYTES = 512 * 1024
/** Upper bound on files fetched for one digest, whatever the budget. */
const MAX_FETCH_FILES = 400
const FETCH_CONCURRENCY = 6
const FILE_TIMEOUT_MS = 10_000
const DEFAULT_DEADLINE_MS = 60_000
/** Share of the budget the directory tree may use before deep folders collapse. */
const TREE_BUDGET_SHARE = 0.15
const MIN_TREE_TOKENS = 400
/** A high-priority file that does not fit is cut to fit when at least this much budget is left. */
const MIN_TRUNCATE_TOKENS = 800
/** Dropped paths returned per digest; the counts cover the rest. */
const MAX_DROPPED_LISTED = 300

export type DigestDropReason =
  | 'not_included'
  | 'excluded'
  | 'sensitive_file'
  | 'lockfile'
  | 'generated'
  | 'binary'
  | 'too_large'
  | 'over_budget'
  | 'file_cap'
  | 'fetch_failed'

/** Why a file earned its place, highest priority first. */
export type DigestRankReason =
  | 'linked'
  | 'readme'
  | 'agent_docs'
  | 'manifest'
  | 'entry_point'
  | 'nested_manifest'
  | 'source'
  | 'other_code'
  | 'tests_docs_config'

export interface RepoTreeEntry {
  path: string
  /** Blob size in bytes, from the git tree. */
  size: number
}

export interface RepoDigestOptions {
  budgetTokens?: number
  /** Glob patterns; when present, a file must match one (linked files are exempt). */
  include?: readonly string[]
  /** Glob patterns removed from the digest and the tree. */
  exclude?: readonly string[]
  /** Restrict the digest to one folder (repo-relative). */
  pathPrefix?: string | null
  /** Files to put first, in order (a report's stack frames, fix files, …). Paths not in the tree are ignored. */
  seedPaths?: readonly string[]
}

export interface PlannedFile {
  path: string
  size: number
  estTokens: number
  rank: DigestRankReason
  /** May be cut to fit the budget instead of dropped. */
  truncatable: boolean
}

export interface DigestPlan {
  budgetTokens: number
  /** Every path the tree section shows (scope + include/exclude applied). */
  treePaths: string[]
  selected: PlannedFile[]
  dropped: Array<{ path: string; reason: DigestDropReason; tokens: number }>
  seedsInTree: string[]
}

export interface DigestFileOut {
  path: string
  tokens: number
  truncated: boolean
  rank: DigestRankReason
}

export interface RepoDigest {
  owner: string
  repo: string
  sha: string
  /** The branch or ref the SHA was resolved from. */
  ref: string
  budget_tokens: number
  /** Estimated tokens of the whole text, header and tree included. */
  total_tokens: number
  tree_tokens: number
  eligible_files: number
  files: DigestFileOut[]
  dropped: Array<{ path: string; reason: DigestDropReason; tokens: number }>
  dropped_counts: Partial<Record<DigestDropReason, number>>
  redacted: Array<{ path: string; label: string }>
  /** GitHub returned a truncated tree (very large repo): some paths are missing. */
  tree_truncated: boolean
  /** Deep folders were collapsed to fit the tree into its share of the budget. */
  tree_collapsed: boolean
  seed_paths: string[]
  text: string
}

// ── Secrets ──────────────────────────────────────────────────────────────────

/**
 * Patterns the shared scanner (secret-scan.ts, kept byte-identical with
 * ux/design-plane) does not cover but the fix-worker and pii-scrubber guards
 * do. Repo text goes to an LLM provider and possibly a public page.
 */
const EXTRA_SECRET_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /AIza[0-9A-Za-z_-]{35}/, label: 'Google API key' },
  { re: /\b(?:sk|rk)_test_[A-Za-z0-9]{16,}/, label: 'Stripe test key' },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/, label: 'npm token' },
  { re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, label: 'SendGrid key' },
]

/** The label of the first secret-shaped match in repo text, or null. */
export function scanRepoTextForSecrets(text: string): string | null {
  const shared = scanForSecrets(text)
  if (shared) return shared
  for (const { re, label } of EXTRA_SECRET_PATTERNS) if (re.test(text)) return label
  return null
}

// ── Token estimate ───────────────────────────────────────────────────────────

/** Characters / 4, rounded up. An estimate, not a tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function clampDigestBudget(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return DEFAULT_DIGEST_BUDGET_TOKENS
  return Math.min(MAX_DIGEST_BUDGET_TOKENS, Math.max(MIN_DIGEST_BUDGET_TOKENS, Math.round(n)))
}

// ── Globs ────────────────────────────────────────────────────────────────────

/**
 * Compile a glob to a RegExp over repo-relative paths. `**` crosses folders,
 * `*` and `?` do not. A pattern without `/` matches the file name at any
 * depth (gitignore style); a pattern ending in `/` matches everything under
 * that folder.
 */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (g.endsWith('/')) g += '**'
  const anyDepth = !g.includes('/')
  if (g.startsWith('/')) g = g.slice(1)
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]
    if (ch === '*') {
      if (g[i + 1] === '*') {
        const slashAfter = g[i + 2] === '/'
        re += slashAfter ? '(?:.*/)?' : '.*'
        i += slashAfter ? 2 : 1
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(anyDepth ? `(?:^|/)${re}$` : `^${re}$`)
}

function compileGlobs(globs: readonly string[] | undefined): RegExp[] {
  return (globs ?? []).map((g) => g.trim()).filter(Boolean).slice(0, 50).map(globToRegExp)
}

// ── Path classification ──────────────────────────────────────────────────────

/** Folders that are never part of a digest or its tree. */
const VENDOR_DIR_RE =
  /(?:^|\/)(?:node_modules|\.git|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.turbo|\.vercel|\.output|coverage|vendor|bower_components|__pycache__|\.venv|venv|\.tox|target|Pods|\.gradle|\.idea|\.cache|storybook-static|\.expo|\.dart_tool)\//

/**
 * Files whose contents never leave the repo, whatever the include globs say.
 * Pattern scanning misses a plain `API_KEY=abc` in a .env file, so these go by
 * name. The tree still shows the name (a file name is not a secret).
 */
const SENSITIVE_FILE_RE =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|local\.properties|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials(?:\.json)?|service-account[^/]*\.json|google-services\.json|GoogleService-Info\.plist)$|\.(?:pem|key|p12|pfx|keystore|jks|mobileprovision|p8|asc|gpg)$|(?:^|\/)secrets?\//i

const LOCKFILE_RE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|deno\.lock|Podfile\.lock|packages\.lock\.json|flake\.lock|uv\.lock|pubspec\.lock|mix\.lock)$/

const GENERATED_RE =
  /\.(?:min\.(?:js|css)|map|snap|generated\.[a-z0-9]+)$|(?:^|\/)(?:__generated__|generated)\//i

const BINARY_EXT_RE =
  /\.(?:png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|psd|ai|sketch|fig|svg|heic|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|dll|exe|so|dylib|bin|o|a|wasm|woff2?|ttf|otf|eot|mp3|mp4|m4a|mov|avi|mkv|webm|wav|flac|ogg|sqlite3?|db|pyc|pyo|parquet|onnx|pt|ckpt|npy|apk|aab|ipa|dmg|iso|car|riv|lottie|glb|gltf|fbx|blend)$/i

const README_RE = /^readme(?:\.[a-z]+)?$/i
const AGENT_DOC_RE = /^(?:agents|claude|architecture|contributing|vision)\.md$/i
const MANIFEST_RE =
  /^(?:package\.json|pnpm-workspace\.yaml|turbo\.json|nx\.json|deno\.jsonc?|tsconfig\.json|Cargo\.toml|pyproject\.toml|setup\.py|setup\.cfg|requirements\.txt|Pipfile|go\.mod|Gemfile|composer\.json|pubspec\.yaml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|Podfile|Package\.swift|app\.json|app\.config\.[jt]s|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|Makefile|mix\.exs)$/
const ENTRY_BASENAME_RE =
  /^(?:index|main|app|server|cli|mod|lib|__main__|manage|App|_app|layout|page|router|routes)\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|dart|swift|kt|java|php|ex)$/

function depthOf(path: string): number {
  return path.split('/').length - 1
}

function basenameOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

/** Normalize a repo path: forward slashes, no leading `./` or `/`, no trailing `/`. */
export function normalizeRepoPathForDigest(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '')
}

function rankOf(path: string): DigestRankReason {
  const depth = depthOf(path)
  const base = basenameOf(path)
  if (depth === 0 && README_RE.test(base)) return 'readme'
  if (depth === 0 && AGENT_DOC_RE.test(base)) return 'agent_docs'
  if (depth === 0 ? MANIFEST_RE.test(base) : path === 'supabase/config.toml') return 'manifest'
  if (depth <= 3 && ENTRY_BASENAME_RE.test(base) && sweepTier(path) !== 3) return 'entry_point'
  if (MANIFEST_RE.test(base) && depth <= 3) return 'nested_manifest'
  const tier = sweepTier(path)
  return tier === 1 ? 'source' : tier === 2 ? 'other_code' : 'tests_docs_config'
}

const RANK_ORDER: Record<DigestRankReason, number> = {
  linked: 0,
  readme: 1,
  agent_docs: 2,
  manifest: 3,
  entry_point: 4,
  nested_manifest: 5,
  source: 6,
  other_code: 7,
  tests_docs_config: 8,
}

/** Interleave paths across top-level folders so one big folder cannot take the whole budget. */
function roundRobinByTopDir(paths: string[]): string[] {
  const buckets = new Map<string, string[]>()
  for (const p of paths) {
    const top = p.includes('/') ? p.slice(0, p.indexOf('/')) : ''
    const list = buckets.get(top)
    if (list) list.push(p)
    else buckets.set(top, [p])
  }
  const queues = [...buckets.values()]
  const out: string[] = []
  for (let i = 0; out.length < paths.length; i++) {
    for (const q of queues) if (i < q.length) out.push(q[i])
  }
  return out
}

// ── Plan ─────────────────────────────────────────────────────────────────────

/**
 * Decide which files the digest carries, in order, from the tree alone.
 * Pure. The tree section's share of the budget is reserved up front.
 */
export function planRepoDigest(entries: readonly RepoTreeEntry[], opts: RepoDigestOptions = {}): DigestPlan {
  const budgetTokens = clampDigestBudget(opts.budgetTokens ?? DEFAULT_DIGEST_BUDGET_TOKENS)
  const include = compileGlobs(opts.include)
  const exclude = compileGlobs(opts.exclude)
  const prefix = opts.pathPrefix ? normalizeRepoPathForDigest(opts.pathPrefix) : ''

  const sizeOf = new Map<string, number>()
  for (const e of entries) {
    const p = normalizeRepoPathForDigest(e.path)
    if (p) sizeOf.set(p, e.size)
  }

  const seedsInTree: string[] = []
  for (const raw of opts.seedPaths ?? []) {
    const p = normalizeRepoPathForDigest(raw)
    if (sizeOf.has(p) && !seedsInTree.includes(p)) seedsInTree.push(p)
  }
  const seedSet = new Set(seedsInTree)

  const dropped: DigestPlan['dropped'] = []
  const treePaths: string[] = []
  const candidates: Array<{ path: string; size: number; rank: DigestRankReason }> = []

  for (const [path, size] of sizeOf) {
    const isSeed = seedSet.has(path)
    if (VENDOR_DIR_RE.test(path)) continue
    if (!isSeed && prefix && path !== prefix && !path.startsWith(`${prefix}/`)) continue
    if (exclude.some((re) => re.test(path))) continue
    treePaths.push(path)
    const est = Math.ceil(size / 4)
    if (SENSITIVE_FILE_RE.test(path)) { dropped.push({ path, reason: 'sensitive_file', tokens: est }); continue }
    if (BINARY_EXT_RE.test(path)) { dropped.push({ path, reason: 'binary', tokens: est }); continue }
    if (size > MAX_FILE_BYTES) { dropped.push({ path, reason: 'too_large', tokens: est }); continue }
    const explicitlyIncluded = include.some((re) => re.test(path))
    if (!isSeed && include.length > 0 && !explicitlyIncluded) { dropped.push({ path, reason: 'not_included', tokens: est }); continue }
    if (!isSeed && !explicitlyIncluded && LOCKFILE_RE.test(path)) { dropped.push({ path, reason: 'lockfile', tokens: est }); continue }
    if (!isSeed && !explicitlyIncluded && GENERATED_RE.test(path)) { dropped.push({ path, reason: 'generated', tokens: est }); continue }
    candidates.push({ path, size, rank: isSeed ? 'linked' : rankOf(path) })
  }

  // Seeds keep the caller's order; every other group is shallow-first, then
  // round-robin across top-level folders.
  const groups = new Map<DigestRankReason, string[]>()
  for (const c of candidates) {
    if (c.rank === 'linked') continue
    const list = groups.get(c.rank)
    if (list) list.push(c.path)
    else groups.set(c.rank, [c.path])
  }
  const rankByPath = new Map(candidates.map((c) => [c.path, c.rank]))
  const ordered: string[] = [...seedsInTree.filter((p) => rankByPath.get(p) === 'linked')]
  for (const rank of (Object.keys(RANK_ORDER) as DigestRankReason[]).sort((a, b) => RANK_ORDER[a] - RANK_ORDER[b])) {
    const list = groups.get(rank)
    if (!list) continue
    list.sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b))
    ordered.push(...roundRobinByTopDir(list))
  }

  const treeReserve = Math.max(MIN_TREE_TOKENS, Math.floor(budgetTokens * TREE_BUDGET_SHARE))
  let remaining = Math.max(0, budgetTokens - treeReserve - 200)
  const selected: PlannedFile[] = []
  for (const path of ordered) {
    const size = sizeOf.get(path) ?? 0
    const rank = rankByPath.get(path) ?? 'other_code'
    // A file's path header costs tokens too.
    const est = Math.ceil(size / 4) + estimateTokens(path) + 12
    const truncatable = RANK_ORDER[rank] <= RANK_ORDER.nested_manifest
    if (selected.length >= MAX_FETCH_FILES) { dropped.push({ path, reason: 'file_cap', tokens: est }); continue }
    if (est <= remaining) {
      selected.push({ path, size, estTokens: est, rank, truncatable })
      remaining -= est
    } else if (truncatable && remaining >= MIN_TRUNCATE_TOKENS) {
      selected.push({ path, size, estTokens: remaining, rank, truncatable })
      remaining = 0
    } else {
      dropped.push({ path, reason: 'over_budget', tokens: est })
    }
  }

  return { budgetTokens, treePaths: treePaths.sort(), selected, dropped, seedsInTree }
}

// ── Tree rendering ───────────────────────────────────────────────────────────

interface DirNode {
  dirs: Map<string, DirNode>
  files: string[]
  count: number
}

function buildDirTree(paths: readonly string[]): DirNode {
  const root: DirNode = { dirs: new Map(), files: [], count: 0 }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    node.count++
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node.dirs.get(parts[i])
      if (!next) {
        next = { dirs: new Map(), files: [], count: 0 }
        node.dirs.set(parts[i], next)
      }
      next.count++
      node = next
    }
    node.files.push(parts[parts.length - 1])
  }
  return root
}

function renderDir(node: DirNode, depth: number, maxDepth: number, out: string[]): void {
  const indent = '  '.repeat(depth)
  for (const name of [...node.dirs.keys()].sort()) {
    const child = node.dirs.get(name)!
    if (depth + 1 > maxDepth) {
      out.push(`${indent}${name}/ (${child.count} file${child.count === 1 ? '' : 's'})`)
    } else {
      out.push(`${indent}${name}/`)
      renderDir(child, depth + 1, maxDepth, out)
    }
  }
  for (const f of [...node.files].sort()) out.push(`${indent}${f}`)
}

/**
 * Render the directory tree, collapsing deep folders to `name/ (N files)`
 * until it fits `maxTokens`. A 4,700-file repo would otherwise spend the whole
 * budget on file names.
 */
export function renderDigestTree(paths: readonly string[], maxTokens: number): { text: string; collapsed: boolean } {
  const root = buildDirTree(paths)
  const maxDepthInTree = paths.reduce((m, p) => Math.max(m, depthOf(p)), 0)
  for (let maxDepth = maxDepthInTree; maxDepth >= 0; maxDepth--) {
    const out: string[] = []
    renderDir(root, 0, maxDepth, out)
    const text = out.join('\n')
    if (estimateTokens(text) <= maxTokens || maxDepth === 0) {
      if (estimateTokens(text) <= maxTokens) return { text, collapsed: maxDepth < maxDepthInTree }
      // Even the top level is too long: keep the first lines that fit.
      const kept: string[] = []
      let used = 0
      for (const line of out) {
        const t = estimateTokens(line) + 1
        if (used + t > maxTokens - 10) break
        kept.push(line)
        used += t
      }
      kept.push(`… ${out.length - kept.length} more entries`)
      return { text: kept.join('\n'), collapsed: true }
    }
  }
  return { text: '', collapsed: false }
}

// ── Assemble ─────────────────────────────────────────────────────────────────

/** `null` content = the fetch failed or timed out. */
export type FetchedContent = string | null | { binary: true }

const FILE_RULE = '='.repeat(48)

function cutToTokens(text: string, maxTokens: number): { text: string; totalLines: number; keptLines: number } {
  const lines = text.split('\n')
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const t = estimateTokens(line) + 1
    if (used + t > maxTokens) break
    kept.push(line)
    used += t
  }
  return { text: kept.join('\n'), totalLines: lines.length, keptLines: kept.length }
}

const REASON_LABEL: Record<DigestDropReason, string> = {
  not_included: 'not matched by the include filter',
  excluded: 'excluded',
  sensitive_file: 'sensitive files (.env, keys) never included',
  lockfile: 'lockfiles',
  generated: 'generated or minified files',
  binary: 'binary files and assets',
  too_large: 'files over 512 KB',
  over_budget: 'over the token budget',
  file_cap: `past the ${MAX_FETCH_FILES}-file cap`,
  fetch_failed: 'could not be read from GitHub',
}

/**
 * Build the final digest from a plan and the fetched contents. Pure.
 * Secret-bearing files are replaced with a notice; the budget is enforced on
 * the real text (estimates from blob sizes can be off).
 */
export function assembleRepoDigest(
  plan: DigestPlan,
  contents: ReadonlyMap<string, FetchedContent>,
  meta: { owner: string; repo: string; sha: string; ref: string; treeTruncated: boolean; scopeLabel: string },
): RepoDigest {
  const dropped = [...plan.dropped]
  const redacted: RepoDigest['redacted'] = []
  const files: DigestFileOut[] = []
  const sections: string[] = []

  const treeBudget = Math.max(MIN_TREE_TOKENS, Math.floor(plan.budgetTokens * TREE_BUDGET_SHARE))
  const tree = renderDigestTree(plan.treePaths, treeBudget)
  const treeTokens = estimateTokens(tree.text)
  // Header (~120 tokens) plus the tree come first; files share what is left.
  let remaining = plan.budgetTokens - treeTokens - 200

  for (const f of plan.selected) {
    const got = contents.get(f.path)
    if (got === undefined || got === null) {
      dropped.push({ path: f.path, reason: 'fetch_failed', tokens: f.estTokens })
      continue
    }
    if (typeof got !== 'string') {
      dropped.push({ path: f.path, reason: 'binary', tokens: f.estTokens })
      continue
    }
    let body = got
    let truncatedNote = ''
    const secretLabel = scanRepoTextForSecrets(body)
    if (secretLabel) {
      redacted.push({ path: f.path, label: secretLabel })
      body = `[Mushi left this file's contents out: it looks like it holds a secret (${secretLabel}).]`
    }
    const header = `${FILE_RULE}\nFILE: ${f.path}`
    const overhead = estimateTokens(header) + estimateTokens(FILE_RULE) + 4
    let tokens = estimateTokens(body) + overhead
    if (tokens > remaining) {
      if (f.truncatable && remaining - overhead >= MIN_TRUNCATE_TOKENS) {
        const cut = cutToTokens(body, remaining - overhead - 12)
        body = cut.text
        truncatedNote = ` (cut to fit: first ${cut.keptLines} of ${cut.totalLines} lines)`
        tokens = estimateTokens(body) + overhead + 12
      } else {
        dropped.push({ path: f.path, reason: 'over_budget', tokens })
        continue
      }
    }
    remaining -= tokens
    files.push({ path: f.path, tokens, truncated: truncatedNote !== '', rank: f.rank })
    sections.push(`${header}${truncatedNote}\n${FILE_RULE}\n${body}`)
  }

  const droppedCounts: Partial<Record<DigestDropReason, number>> = {}
  for (const d of dropped) droppedCounts[d.reason] = (droppedCounts[d.reason] ?? 0) + 1
  const leftOut = (Object.keys(droppedCounts) as DigestDropReason[])
    .map((r) => `${droppedCounts[r]} ${REASON_LABEL[r]}`)
    .join('; ')

  const headerLines = [
    `Repository: ${meta.owner}/${meta.repo}`,
    `Commit: ${meta.sha} (${meta.ref})`,
    `Scope: ${meta.scopeLabel}`,
    `Files in this digest: ${files.length} of ${plan.treePaths.length}`,
  ]
  if (redacted.length > 0) headerLines.push(`Contents removed (looked like secrets): ${redacted.map((r) => r.path).join(', ')}`)
  if (leftOut) headerLines.push(`Left out: ${leftOut}`)
  if (meta.treeTruncated) headerLines.push('Note: GitHub returned a partial tree for this very large repo; some files are missing.')
  headerLines.push('Token counts are estimates (characters / 4).')

  const body = [
    headerLines.join('\n'),
    `Directory structure${tree.collapsed ? ' (deep folders collapsed)' : ''}:\n${tree.text}`,
    ...sections,
  ].join('\n\n')
  const totalTokens = estimateTokens(body)
  const text = body.replace(
    'Token counts are estimates (characters / 4).',
    `About ${totalTokens.toLocaleString('en-US')} tokens of a ${plan.budgetTokens.toLocaleString('en-US')} budget (estimate: characters / 4).`,
  )

  // Highest-priority drops first so the capped list shows what mattered most.
  const dropOrder: Record<DigestDropReason, number> = {
    over_budget: 0, file_cap: 1, fetch_failed: 2, too_large: 3, sensitive_file: 4,
    not_included: 5, excluded: 6, generated: 7, lockfile: 8, binary: 9,
  }
  const listedDrops = dropped
    .map((d, i) => ({ d, i }))
    .sort((a, b) => dropOrder[a.d.reason] - dropOrder[b.d.reason] || a.i - b.i)
    .slice(0, MAX_DROPPED_LISTED)
    .map(({ d }) => d)

  return {
    owner: meta.owner,
    repo: meta.repo,
    sha: meta.sha,
    ref: meta.ref,
    budget_tokens: plan.budgetTokens,
    total_tokens: estimateTokens(text),
    tree_tokens: treeTokens,
    eligible_files: plan.treePaths.length,
    files,
    dropped: listedDrops,
    dropped_counts: droppedCounts,
    redacted,
    tree_truncated: meta.treeTruncated,
    tree_collapsed: tree.collapsed,
    seed_paths: plan.seedsInTree,
    text,
  }
}

// ── GitHub I/O ───────────────────────────────────────────────────────────────

function ghHeaders(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mushi-mushi/1.0',
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export class RepoDigestError extends Error {
  constructor(readonly code: 'REF_NOT_FOUND' | 'TREE_FETCH_FAILED' | 'REPO_NOT_ACCESSIBLE', message: string) {
    super(message)
    this.name = 'RepoDigestError'
  }
}

/** Resolve a branch, tag or SHA to a full commit SHA. No ref = the repo's GitHub default branch. */
export async function resolveCommitSha(opts: {
  token: string
  owner: string
  repo: string
  ref?: string | null
  fetchImpl?: FetchLike
}): Promise<{ sha: string; ref: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  let ref = opts.ref?.trim() || ''
  if (!ref) {
    const lookup = await lookupGithubDefaultBranch(opts.token, opts.owner, opts.repo, fetchImpl)
    if (!lookup.ok) {
      throw new RepoDigestError(
        'REPO_NOT_ACCESSIBLE',
        `Could not read ${opts.owner}/${opts.repo} on GitHub (status ${lookup.status}). Check the GitHub connection.`,
      )
    }
    ref = lookup.branch
  }
  const res = await fetchImpl(
    `https://api.github.com/repos/${opts.owner}/${opts.repo}/commits/${encodeURIComponent(ref)}`,
    { headers: ghHeaders(opts.token, 'application/vnd.github.sha'), signal: AbortSignal.timeout(8_000) },
  )
  if (!res.ok) throw new RepoDigestError('REF_NOT_FOUND', `GitHub has no commit for '${ref}' (status ${res.status}).`)
  const sha = (await res.text()).trim()
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new RepoDigestError('REF_NOT_FOUND', `GitHub returned no commit SHA for '${ref}'.`)
  return { sha: sha.toLowerCase(), ref }
}

/** The recursive tree at a commit: blob paths and sizes. */
export async function fetchTreeAtSha(opts: {
  token: string
  owner: string
  repo: string
  sha: string
  fetchImpl?: FetchLike
}): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const res = await fetchImpl(
    `https://api.github.com/repos/${opts.owner}/${opts.repo}/git/trees/${opts.sha}?recursive=1`,
    { headers: ghHeaders(opts.token), signal: AbortSignal.timeout(30_000) },
  )
  if (!res.ok) throw new RepoDigestError('TREE_FETCH_FAILED', `tree fetch ${res.status} at ${opts.sha.slice(0, 7)}`)
  const body = (await res.json()) as { tree?: Array<{ path?: string; type?: string; size?: number }>; truncated?: boolean }
  const entries: RepoTreeEntry[] = []
  for (const t of body.tree ?? []) {
    if (t.type === 'blob' && typeof t.path === 'string') entries.push({ path: t.path, size: typeof t.size === 'number' ? t.size : 0 })
  }
  return { entries, truncated: body.truncated === true }
}

/** All tree paths plus every folder that contains them — what a diagram node may point at. */
export function treePathSet(entries: readonly RepoTreeEntry[]): Set<string> {
  const out = new Set<string>()
  for (const e of entries) {
    const p = normalizeRepoPathForDigest(e.path)
    out.add(p)
    let i = p.lastIndexOf('/')
    while (i > 0) {
      out.add(p.slice(0, i))
      i = p.lastIndexOf('/', i - 1)
    }
  }
  return out
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

/** Fetch the planned files' raw text, a few at a time, inside a wall-clock deadline. */
export async function fetchDigestContents(opts: {
  token: string
  owner: string
  repo: string
  sha: string
  paths: readonly string[]
  fetchImpl?: FetchLike
  deadlineMs?: number
}): Promise<Map<string, FetchedContent>> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const deadline = Date.now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS)
  const out = new Map<string, FetchedContent>()
  let next = 0
  const worker = async () => {
    while (next < opts.paths.length) {
      const path = opts.paths[next++]
      if (Date.now() >= deadline) { out.set(path, null); continue }
      try {
        const res = await fetchImpl(
          `https://api.github.com/repos/${opts.owner}/${opts.repo}/contents/${encodePath(path)}?ref=${opts.sha}`,
          { headers: ghHeaders(opts.token, 'application/vnd.github.raw'), signal: AbortSignal.timeout(FILE_TIMEOUT_MS) },
        )
        if (!res.ok) { out.set(path, null); continue }
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (looksBinary(bytes)) { out.set(path, { binary: true }); continue }
        try {
          out.set(path, new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        } catch {
          out.set(path, { binary: true })
        }
      } catch {
        out.set(path, null)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, opts.paths.length) }, worker))
  return out
}

/**
 * The whole pipeline for one repo: pin the SHA, read the tree, plan, fetch,
 * assemble. `ref` may be a branch, tag or SHA; omitted = GitHub default branch.
 */
export async function buildRepoDigest(opts: {
  token: string
  owner: string
  repo: string
  ref?: string | null
  options?: RepoDigestOptions
  scopeLabel?: string
  fetchImpl?: FetchLike
  deadlineMs?: number
  /** Already resolved by the caller (cache lookup); skips the commit lookup. */
  pinned?: { sha: string; ref: string }
}): Promise<RepoDigest> {
  const pinned = opts.pinned ?? (await resolveCommitSha(opts))
  const tree = await fetchTreeAtSha({ ...opts, sha: pinned.sha })
  return buildRepoDigestFromTree({ ...opts, pinned, tree })
}

/** Plan, fetch and assemble from a tree the caller already read (it needed the tree to resolve seeds). */
export async function buildRepoDigestFromTree(opts: {
  token: string
  owner: string
  repo: string
  pinned: { sha: string; ref: string }
  tree: { entries: readonly RepoTreeEntry[]; truncated: boolean }
  options?: RepoDigestOptions
  scopeLabel?: string
  fetchImpl?: FetchLike
  deadlineMs?: number
}): Promise<RepoDigest> {
  const plan = planRepoDigest(opts.tree.entries, opts.options)
  const contents = await fetchDigestContents({
    ...opts,
    sha: opts.pinned.sha,
    paths: plan.selected.map((f) => f.path),
  })
  return assembleRepoDigest(plan, contents, {
    owner: opts.owner,
    repo: opts.repo,
    sha: opts.pinned.sha,
    ref: opts.pinned.ref,
    treeTruncated: opts.tree.truncated,
    scopeLabel: opts.scopeLabel ?? 'whole repo',
  })
}

/**
 * Stable cache key input for one digest: the options that change the output
 * plus the scope (`repo`, `path`, or `report:<id>`). It is computed before the
 * report's linked files are resolved, so a repeat click skips that work; the
 * route bounds how long a report digest stays fresh instead.
 */
export function digestCacheKeyInput(opts: RepoDigestOptions, scopeKey: string): string {
  return JSON.stringify({
    k: scopeKey,
    b: clampDigestBudget(opts.budgetTokens ?? DEFAULT_DIGEST_BUDGET_TOKENS),
    i: [...(opts.include ?? [])].map((s) => s.trim()).filter(Boolean).sort(),
    e: [...(opts.exclude ?? [])].map((s) => s.trim()).filter(Boolean).sort(),
    p: opts.pathPrefix ? normalizeRepoPathForDigest(opts.pathPrefix) : '',
    v: 2,
  })
}

export async function sha256HexOf(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
