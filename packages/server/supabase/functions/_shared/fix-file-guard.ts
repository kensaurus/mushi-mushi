/**
 * FILE: packages/server/supabase/functions/_shared/fix-file-guard.ts
 * PURPOSE: Pre-PR guards for the fix-worker: never write a file blind, never
 *          open a PR the model itself flagged, never let a "modify" quietly
 *          become a whole-file rewrite.
 *
 * REGRESSION HISTORY (2026-10-02): report 469f6962 produced draft PR #424, a
 * blind rewrite of apps/docs/app/layout.tsx (+28/-147) that invented imports
 * and dropped the Nextra layout. The indexer had been failing with
 * "tree fetch 404" since 2026-06-20 (project_repos.default_branch said 'main',
 * GitHub said 'master'), so the file was never in the model's context. The
 * attempt also recorded review_passed=false and still opened the PR.
 *
 * Pure: no Deno globals, no npm: specifiers, no logger, so the vitest suite in
 * packages/server/src/__tests__ can import it directly.
 */

/** What the base branch holds at a proposed path, as read from GitHub. */
export type BaseFileState =
  | { kind: 'exists'; contents: string }
  | { kind: 'absent' }
  | { kind: 'unreadable'; detail: string }

export interface ProposedFile {
  path: string
  contents: string
  reason: string
}

export interface DroppedFile {
  path: string
  reason: string
}

/** A "modify" that deletes more than this share of the existing lines is a rewrite. */
export const MAX_DELETED_LINE_RATIO = 0.6

/**
 * The single definition of "the worker's review passed". The model sets
 * `needsHumanReview` when it is not confident; anything other than an explicit
 * `false` counts as not passed. Both the PR gate and the stored
 * `fix_attempts.review_passed` read this, so they cannot disagree again.
 */
export function fixReviewPassed(fix: { needsHumanReview?: boolean | null }): boolean {
  return fix.needsHumanReview === false
}

/**
 * Interpret a GitHub contents API response (`GET /repos/:o/:r/contents/:path?ref=`).
 *
 * Only a 404 that names a missing *file* means "absent". GitHub answers a bad
 * ref with 404 "No commit found for the ref …" too; treating that as absent
 * would let every existing file pass as a new one, so it is unreadable.
 * Directories, files over 1 MB (`encoding: "none"`) and any other status are
 * unreadable as well: the worker cannot see what it would overwrite.
 */
export function parseContentsResponse(status: number, body: unknown): BaseFileState {
  if (status === 404) {
    const message = typeof (body as { message?: unknown } | null)?.message === 'string'
      ? (body as { message: string }).message
      : ''
    if (/no commit found/i.test(message)) {
      return { kind: 'unreadable', detail: `base ref not found: ${message.slice(0, 120)}` }
    }
    return { kind: 'absent' }
  }
  if (status < 200 || status >= 300) {
    return { kind: 'unreadable', detail: `GitHub contents API returned ${status}` }
  }
  if (Array.isArray(body)) return { kind: 'unreadable', detail: 'path is a directory' }
  const file = body as { type?: unknown; encoding?: unknown; content?: unknown } | null
  if (!file || file.type !== 'file') {
    return { kind: 'unreadable', detail: 'path is not a regular file' }
  }
  if (file.encoding !== 'base64' || typeof file.content !== 'string') {
    return { kind: 'unreadable', detail: 'file content not returned (over 1 MB?)' }
  }
  try {
    const binary = atob(file.content.replace(/\s/g, ''))
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return { kind: 'exists', contents: new TextDecoder().decode(bytes) }
  } catch {
    return { kind: 'unreadable', detail: 'file content could not be decoded' }
  }
}

function toLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n$/, '')
  if (normalized.length === 0) return []
  return normalized.split('\n').map((line) => line.trimEnd())
}

/**
 * Share of `before`'s lines that do not survive into `after` (0..1).
 *
 * Multiset match, not an LCS diff: a line counts as kept if an identical line
 * appears anywhere in `after`. That over-counts kept lines (moved or repeated
 * lines like `}` all match), so the result is a lower bound on what a real
 * diff would delete. The guard only fires when the deletion is certain.
 */
export function deletedLineRatio(before: string, after: string): number {
  const beforeLines = toLines(before)
  if (beforeLines.length === 0) return 0
  const remaining = new Map<string, number>()
  for (const line of toLines(after)) remaining.set(line, (remaining.get(line) ?? 0) + 1)
  let deleted = 0
  for (const line of beforeLines) {
    const n = remaining.get(line) ?? 0
    if (n > 0) remaining.set(line, n - 1)
    else deleted++
  }
  return deleted / beforeLines.length
}

/**
 * True when the report explicitly asks for a rewrite, which lifts the
 * deletion guard. Report text comes from a public widget, so this only
 * relaxes the 60% rule; the review gate and every other check still apply.
 */
export function reportRequestsRewrite(texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => typeof t === 'string' && /\b(re-?write|rewritten|from scratch)\b/i.test(t))
}

/**
 * Decide which proposed files may be written.
 *
 * - `exists`  → a modification; kept unless it deletes more than
 *               MAX_DELETED_LINE_RATIO of the file (and no rewrite was asked for).
 * - `absent`  → a new file; kept.
 * - `unreadable` or no state at all → dropped: never write what we cannot see.
 *
 * `blockReason` is set when nothing worth opening a PR for survives: either no
 * file remains, or files were dropped and only new files are left (a lone test
 * or NEEDS_INVESTIGATION.md is not the fix the report asked for).
 */
export function assessFixFiles<F extends ProposedFile>(
  files: F[],
  states: Map<string, BaseFileState>,
  opts: { allowRewrite?: boolean; maxDeletedRatio?: number } = {},
): { kept: F[]; dropped: DroppedFile[]; blockReason: string | null } {
  const maxRatio = opts.maxDeletedRatio ?? MAX_DELETED_LINE_RATIO
  const kept: F[] = []
  const dropped: DroppedFile[] = []
  let keptModification = false

  for (const file of files) {
    const state = states.get(file.path)
    if (!state) {
      dropped.push({ path: file.path, reason: 'current contents were not read' })
      continue
    }
    if (state.kind === 'unreadable') {
      dropped.push({ path: file.path, reason: `current contents unreadable (${state.detail})` })
      continue
    }
    if (state.kind === 'absent') {
      kept.push(file)
      continue
    }
    const ratio = deletedLineRatio(state.contents, file.contents)
    if (ratio > maxRatio && !opts.allowRewrite) {
      dropped.push({
        path: file.path,
        reason: `deletes ${Math.round(ratio * 100)}% of the existing lines; treated as a rewrite`,
      })
      continue
    }
    kept.push(file)
    keptModification = true
  }

  let blockReason: string | null = null
  if (kept.length === 0) {
    blockReason = `no file can be written safely: ${dropped.map((d) => `${d.path} (${d.reason})`).join('; ')}`
  } else if (dropped.length > 0 && !keptModification) {
    blockReason =
      `every change to an existing file was rejected, only new files remain: ` +
      dropped.map((d) => `${d.path} (${d.reason})`).join('; ')
  }
  return { kept, dropped, blockReason: blockReason?.slice(0, 450) ?? null }
}

function toRawLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n$/, '')
  if (normalized.length === 0) return []
  return normalized.split('\n')
}

/** Above this many cell comparisons the exact LCS is skipped for a multiset bound. */
const MAX_LCS_CELLS = 16_000_000

/**
 * Lines a unified diff would show as added + deleted for one file — what
 * GitHub reports as "+a −d". `lines_changed` used to be the line count of the
 * NEW contents, so PR #424 (+28/−147 = 175) was stored as 41.
 *
 * Exact via longest-common-subsequence (rolling row, O(n·m) time, O(m)
 * memory); a pathological pair falls back to the multiset match, which can
 * only under-count.
 */
export function diffLineCount(before: string | null, after: string): number {
  const a = before == null ? [] : toRawLines(before)
  const b = toRawLines(after)
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let common: number
  if (a.length * b.length > MAX_LCS_CELLS) {
    const remaining = new Map<string, number>()
    for (const line of b) remaining.set(line, (remaining.get(line) ?? 0) + 1)
    common = 0
    for (const line of a) {
      const n = remaining.get(line) ?? 0
      if (n > 0) {
        remaining.set(line, n - 1)
        common++
      }
    }
  } else {
    const row = new Uint32Array(b.length + 1)
    for (let i = 1; i <= a.length; i++) {
      let diag = 0
      for (let j = 1; j <= b.length; j++) {
        const up = row[j]
        row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(up, row[j - 1])
        diag = up
      }
    }
    common = row[b.length]
  }
  return a.length - common + (b.length - common)
}

/** Sum of {@link diffLineCount} over the files a PR writes, against the base branch. */
export function fixDiffLineCount(
  files: ReadonlyArray<{ path: string; contents: string }>,
  baseStates: ReadonlyMap<string, BaseFileState>,
): number {
  let total = 0
  for (const f of files) {
    const base = baseStates.get(f.path)
    total += diffLineCount(base?.kind === 'exists' ? base.contents : null, f.contents)
  }
  return total
}
