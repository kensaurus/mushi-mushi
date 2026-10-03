/**
 * FILE: packages/server/supabase/functions/_shared/fix-edits.ts
 * PURPOSE: Turn the fix model's file entries (find/replace edits for an
 *          existing file, full contents for a new one) into the full patched
 *          text the PR commits, against the file read from the base branch.
 *
 * Why (2026-10-03): eight real Sentry dispatches all ended in review_failed
 * because the model had to emit a whole replacement file from truncated
 * index previews and, correctly, refused to invent the rest. The model now
 * sees whole files and emits edits; this module applies them exactly, and a
 * `find` that matches zero or several times is an error fed back to the
 * model, never a guess.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

import type { BaseFileState, ProposedFile } from './fix-file-guard.ts'

export interface FixEdit {
  find: string
  replace: string
}

export type ApplyEditsResult =
  | { ok: true; contents: string }
  | { ok: false; error: string }

/** A file is CRLF only when every newline in it is preceded by `\r`. */
function isPureCrlf(text: string): boolean {
  const lf = (text.match(/\n/g) ?? []).length
  const crlf = (text.match(/\r\n/g) ?? []).length
  return crlf > 0 && crlf === lf
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

function matchIndexes(text: string, needle: string): number[] {
  const out: number[] = []
  let from = 0
  while (out.length < 50) {
    const at = text.indexOf(needle, from)
    if (at === -1) break
    out.push(at)
    from = at + 1
  }
  return out
}

function firstLine(s: string): string {
  const line = s.split('\n').find((l) => l.trim().length > 0) ?? s
  const t = line.trim()
  return t.length > 80 ? `${t.slice(0, 77)}...` : t
}

const GUTTER_RE = /^\s*\d+\s?\| /

/**
 * Apply find/replace edits in order. Each `find` must occur exactly once in
 * the text as it stands when that edit runs. A CRLF file is matched and
 * patched with LF line endings (the model sees and writes `\n`) and written
 * back as CRLF; any other file is matched byte for byte.
 */
export function applyEdits(original: string, edits: readonly FixEdit[]): ApplyEditsResult {
  if (edits.length === 0) return { ok: false, error: 'no edits given' }
  const crlf = isPureCrlf(original)
  const toLf = (s: string) => (crlf ? s.replace(/\r\n/g, '\n') : s)
  let text = toLf(original)

  for (const [i, edit] of edits.entries()) {
    const n = i + 1
    const find = toLf(edit.find)
    const replace = toLf(edit.replace)
    if (find.length === 0) return { ok: false, error: `edit ${n}: find is empty` }
    if (find === replace) return { ok: false, error: `edit ${n}: find and replace are identical, so it changes nothing` }
    const hits = matchIndexes(text, find)
    if (hits.length === 0) {
      const gutter = find.split('\n').some((l) => GUTTER_RE.test(l))
      return {
        ok: false,
        error:
          `edit ${n}: find matches 0 times (starts "${firstLine(find)}")` +
          (gutter
            ? '; it includes the line-number gutter ("12 | "), which is not part of the file'
            : '; copy the exact current text, including whitespace, from the full file shown'),
      }
    }
    if (hits.length > 1) {
      const lines = hits.slice(0, 5).map((h) => lineOf(text, h)).join(', ')
      return {
        ok: false,
        error:
          `edit ${n}: find matches ${hits.length >= 50 ? '50+' : hits.length} times (lines ${lines}${hits.length > 5 ? ', …' : ''}); ` +
          'include more surrounding lines so it matches exactly once',
      }
    }
    text = text.slice(0, hits[0]) + replace + text.slice(hits[0] + find.length)
  }

  if (text === toLf(original)) return { ok: false, error: 'the edits leave the file unchanged' }
  return { ok: true, contents: crlf ? text.replace(/\n/g, '\r\n') : text }
}

/** One fix entry as the schema allows it: edits for an existing file, or a new file. */
export type FixFileInput =
  | { path: string; edits: FixEdit[]; reason: string }
  | { path: string; contents: string; reason: string }

export interface MaterializedFix {
  /** Full new contents per file, ready for the guards and the commit. */
  files: ProposedFile[]
  /** One line per entry that could not be applied; empty means all applied. */
  errors: string[]
}

/**
 * Patch every entry against what the base branch holds at its path.
 *
 * - edits    → the path must exist; the edits are applied to its contents.
 * - contents → the path must be absent; a full replacement of an existing
 *              file is refused (that is what edits are for).
 * An unreadable or unknown base state is an error: never write what we
 * cannot see.
 */
export function materializeFixFiles(
  entries: readonly FixFileInput[],
  states: ReadonlyMap<string, BaseFileState>,
): MaterializedFix {
  const files: ProposedFile[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.path)) {
      errors.push(`${entry.path}: listed more than once; put all of its edits in one entry`)
      continue
    }
    seen.add(entry.path)
    const state = states.get(entry.path)
    if (!state) {
      errors.push(`${entry.path}: its current contents were not read`)
      continue
    }
    if (state.kind === 'unreadable') {
      errors.push(`${entry.path}: its current contents could not be read (${state.detail})`)
      continue
    }
    if ('edits' in entry) {
      if (state.kind === 'absent') {
        errors.push(`${entry.path}: does not exist on the base branch, so it cannot take edits (use contents for a new file)`)
        continue
      }
      const applied = applyEdits(state.contents, entry.edits)
      if (!applied.ok) {
        errors.push(`${entry.path}: ${applied.error}`)
        continue
      }
      files.push({ path: entry.path, contents: applied.contents, reason: entry.reason })
    } else {
      if (state.kind === 'exists') {
        errors.push(`${entry.path}: already exists, so it must be changed with edits, not rewritten with contents`)
        continue
      }
      files.push({ path: entry.path, contents: entry.contents, reason: entry.reason })
    }
  }
  return { files, errors }
}

/**
 * The text the model itself wrote: every `replace` and every new file's
 * contents. The secret scan runs on this, not on whole patched files, so a
 * token-shaped string already in the repo never blocks an unrelated fix.
 */
export function introducedText(entry: FixFileInput): string {
  return 'edits' in entry ? entry.edits.map((e) => e.replace).join('\n') : entry.contents
}

/**
 * Feedback for the one retry after edits failed to apply: the exact errors,
 * and what a valid entry looks like.
 */
export function editRetryPrompt(errors: readonly string[]): string {
  return [
    'Your fix could not be applied to the repository:',
    ...errors.map((e) => `- ${e}`),
    '',
    'Return the complete fix again (every file, not only the failed ones). For each existing file, copy each `find` verbatim from the full file shown in "Relevant code", without the line-number gutter, with enough surrounding lines that it occurs exactly once. Use `contents` only for files that do not exist yet. If you cannot make the edits match, set needsHumanReview=true and explain why.',
  ].join('\n')
}
