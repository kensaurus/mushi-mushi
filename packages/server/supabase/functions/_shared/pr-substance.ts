/**
 * FILE: packages/server/supabase/functions/_shared/pr-substance.ts
 * PURPOSE: Decide whether a cloud agent's pull request actually changes code,
 *          or only adds notes (a NEEDS_INVESTIGATION.md, a markdown write-up,
 *          a TODO comment). Until 2026-10 the cloud prompt told agents to open
 *          such a PR when they could not find the cause, and Mushi moved the
 *          report to `fixing` on it. A PR like that is not a fix.
 *
 * Conservative on purpose: a false "speculative" verdict stalls a real fix,
 * so anything this file cannot prove is notes-only counts as substantive
 * (a code file without a patch, a truncated file list, any deletion, any
 * added line that is not a TODO-style comment).
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

/** One entry of GET /repos/:o/:r/pulls/:n/files, as much as we read. */
export interface PrChangedFile {
  filename: string
  status: string
  additions: number
  deletions: number
  /** Unified diff; GitHub omits it for binary and very large files. */
  patch?: string | null
}

export type PrSubstanceVerdict =
  | { speculative: false }
  | { speculative: true; reason: string; files: string[] }

const DOC_EXTENSIONS = new Set(['md', 'mdx', 'markdown', 'txt', 'rst', 'adoc'])

/** A file whose only job is prose: by extension, or a NEEDS_INVESTIGATION note. */
export function isDocFile(path: string): boolean {
  const base = path.split('/').pop() ?? path
  if (/^needs[_-]?investigation/i.test(base)) return true
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  return DOC_EXTENSIONS.has(base.slice(dot + 1).toLowerCase())
}

const TODO_MARKER_RE = /\b(TODO|FIXME|XXX|NEEDS[ _-]?INVESTIGATION)\b/i
// Comment openers for the languages agents patch. `#` and `--` must be
// followed by whitespace, so a shell or Dockerfile flag (`--mount=…`) or a
// `#!` line is never read as a comment; the marker must also be present.
const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*\s|\*$|#(\s|$)|--(\s|$)|<!--|\{\/\*)/

/** The `+` lines of a unified diff, without the `+++` file header. */
function addedLines(patch: string): string[] {
  return patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
}

/**
 * True when a code file's change is nothing but TODO-style comments: no
 * deletions, a patch we can read, and every added line either blank or a
 * comment line carrying a TODO / FIXME / XXX / NEEDS INVESTIGATION marker.
 */
export function isTodoOnlyChange(file: PrChangedFile): boolean {
  if (file.deletions > 0) return false
  if (typeof file.patch !== 'string' || file.patch.length === 0) return false
  const lines = addedLines(file.patch)
  let markers = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    if (!COMMENT_LINE_RE.test(line) || !TODO_MARKER_RE.test(line)) return false
    markers++
  }
  return markers > 0
}

function isNotesOnly(file: PrChangedFile): boolean {
  // A removed or renamed-away file is a code change whatever its type.
  if (file.status === 'removed') return false
  if (isDocFile(file.filename)) return true
  return isTodoOnlyChange(file)
}

/**
 * Speculative when every changed file is notes. `complete: false` (the
 * listing hit its page cap) is always substantive: an unseen file may be the
 * real fix. So is an empty PR: the GitHub Copilot agent opens its draft PR
 * before it pushes, so "no files yet" proves nothing (callers record the PR
 * as unchecked instead).
 */
export function classifyPrSubstance(files: PrChangedFile[], opts: { complete: boolean }): PrSubstanceVerdict {
  if (!opts.complete || files.length === 0) return { speculative: false }
  if (!files.every(isNotesOnly)) return { speculative: false }
  const names = files.map((f) => f.filename)
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : '')
  return {
    speculative: true,
    reason: `the pull request only adds notes, not a code change (${shown})`,
    files: names,
  }
}

/** `https://github.com/o/r/pull/12` → { owner, repo, number }. */
export function parsePullRequestUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(url.trim())
  if (!m) return null
  const number = Number(m[3])
  if (!Number.isSafeInteger(number) || number <= 0) return null
  return { owner: m[1], repo: m[2], number }
}
