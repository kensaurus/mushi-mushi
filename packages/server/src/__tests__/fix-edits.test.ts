/**
 * FILE: packages/server/src/__tests__/fix-edits.test.ts
 * PURPOSE: The fix-worker applies the model's find/replace edits to the file
 *          it read from the base branch (2026-10-03). A `find` must match
 *          exactly once; anything else is an error fed back to the model,
 *          never a guess written to a PR.
 */
import { describe, expect, it } from 'vitest'
import {
  applyEdits,
  editRetryPrompt,
  introducedText,
  materializeFixFiles,
  isCommentOnlyFix,
} from '../../supabase/functions/_shared/fix-edits.ts'
import type { BaseFileState } from '../../supabase/functions/_shared/fix-file-guard.ts'

const SRC = [
  "import { log } from './log'",
  '',
  'export async function fetchPatterns(id: string) {',
  "  const res = await fetch(`/api/patterns/${id}`)",
  "  if (!res.ok) log.error('fetch_patterns_failed')",
  '  return res.json()',
  '}',
  '',
].join('\n')

describe('applyEdits', () => {
  it('applies a find that matches exactly once and leaves the rest byte-identical', () => {
    const r = applyEdits(SRC, [
      {
        find: "  if (!res.ok) log.error('fetch_patterns_failed')\n  return res.json()",
        replace:
          "  if (!res.ok) {\n    log.error('fetch_patterns_failed', { status: res.status })\n    return null\n  }\n  return res.json()",
      },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.contents).toContain('return null')
    expect(r.contents.startsWith("import { log } from './log'\n\nexport async function fetchPatterns")).toBe(true)
    expect(r.contents.endsWith('}\n')).toBe(true)
  })

  it('applies edits in order, each against the text the previous one produced', () => {
    const r = applyEdits('a = 1\nb = 2\n', [
      { find: 'a = 1', replace: 'a = 10' },
      { find: 'a = 10\nb = 2', replace: 'a = 10\nb = 20' },
    ])
    expect(r).toEqual({ ok: true, contents: 'a = 10\nb = 20\n' })
  })

  it('reports a zero match precisely, without writing anything', () => {
    const r = applyEdits(SRC, [{ find: "log.error('fetch_pattern_failed')", replace: 'x()' }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/edit 1: find matches 0 times/)
    expect(r.error).toMatch(/fetch_pattern_failed/)
  })

  it('points at the gutter when the find was copied with line numbers', () => {
    const r = applyEdits(SRC, [{ find: "5 | if (!res.ok) log.error('fetch_patterns_failed')", replace: 'x' }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/line-number gutter/)
  })

  it('refuses a find that matches more than once and names the lines', () => {
    const text = 'return null\nconst x = 1\nreturn null\n'
    const r = applyEdits(text, [{ find: 'return null', replace: 'return undefined' }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/matches 2 times \(lines 1, 3\)/)
    expect(r.error).toMatch(/more surrounding lines/)
  })

  it('refuses an empty find, a no-op edit, and an empty edit list', () => {
    expect(applyEdits(SRC, [{ find: '', replace: 'x' }]).ok).toBe(false)
    expect(applyEdits(SRC, [{ find: 'return res.json()', replace: 'return res.json()' }]).ok).toBe(false)
    expect(applyEdits(SRC, []).ok).toBe(false)
  })

  it('matches a CRLF file with LF edits and writes it back as CRLF', () => {
    const crlf = 'line one\r\nconst flag = false\r\nline three\r\n'
    const r = applyEdits(crlf, [{ find: 'line one\nconst flag = false', replace: 'line one\nconst flag = true' }])
    expect(r).toEqual({ ok: true, contents: 'line one\r\nconst flag = true\r\nline three\r\n' })
  })

  it('accepts a CRLF find against a CRLF file too', () => {
    const crlf = 'a\r\nb\r\n'
    const r = applyEdits(crlf, [{ find: 'a\r\nb', replace: 'a\r\nB' }])
    expect(r).toEqual({ ok: true, contents: 'a\r\nB\r\n' })
  })

  it('matches a mixed-ending file byte for byte (no normalization)', () => {
    const mixed = 'a\r\nb\nc\n'
    expect(applyEdits(mixed, [{ find: 'b\nc', replace: 'B\nC' }])).toEqual({ ok: true, contents: 'a\r\nB\nC\n' })
    expect(applyEdits(mixed, [{ find: 'a\nb', replace: 'x' }]).ok).toBe(false)
  })

  it('does not interpret $ patterns in the replacement', () => {
    const r = applyEdits('price = 1\n', [{ find: 'price = 1', replace: "price = '$&$1'" }])
    expect(r).toEqual({ ok: true, contents: "price = '$&$1'\n" })
  })
})

describe('materializeFixFiles', () => {
  const states = new Map<string, BaseFileState>([
    ['src/patterns.ts', { kind: 'exists', contents: SRC }],
    ['src/patterns.test.ts', { kind: 'absent' }],
    ['src/locked.ts', { kind: 'unreadable', detail: 'GitHub contents API returned 403' }],
  ])

  it('patches edits into full contents and passes new files through', () => {
    const m = materializeFixFiles(
      [
        { path: 'src/patterns.ts', edits: [{ find: '  return res.json()', replace: '  return await res.json()' }], reason: 'await' },
        { path: 'src/patterns.test.ts', contents: "it('works', () => {})\n", reason: 'add a test' },
      ],
      states,
    )
    expect(m.errors).toEqual([])
    expect(m.files.map((f) => f.path)).toEqual(['src/patterns.ts', 'src/patterns.test.ts'])
    expect(m.files[0].contents).toBe(SRC.replace('  return res.json()', '  return await res.json()'))
  })

  it('refuses full contents for an existing file and edits for a missing one', () => {
    const m = materializeFixFiles(
      [
        { path: 'src/patterns.ts', contents: 'export {}\n', reason: 'rewrite' },
        { path: 'src/patterns.test.ts', edits: [{ find: 'a', replace: 'b' }], reason: 'edit a new file' },
      ],
      states,
    )
    expect(m.files).toEqual([])
    expect(m.errors[0]).toMatch(/src\/patterns\.ts: already exists, so it must be changed with edits/)
    expect(m.errors[1]).toMatch(/src\/patterns\.test\.ts: does not exist on the base branch/)
  })

  it('never writes a file it could not read, or one it never read', () => {
    const m = materializeFixFiles(
      [
        { path: 'src/locked.ts', edits: [{ find: 'a', replace: 'b' }], reason: 'x' },
        { path: 'src/unknown.ts', contents: 'x\n', reason: 'y' },
      ],
      states,
    )
    expect(m.files).toEqual([])
    expect(m.errors[0]).toMatch(/could not be read \(GitHub contents API returned 403\)/)
    expect(m.errors[1]).toMatch(/were not read/)
  })

  it('prefixes edit errors with the path and rejects a path listed twice', () => {
    const m = materializeFixFiles(
      [
        { path: 'src/patterns.ts', edits: [{ find: 'nope', replace: 'x' }], reason: 'a' },
        { path: 'src/patterns.ts', edits: [{ find: 'return res.json()', replace: 'x' }], reason: 'b' },
      ],
      states,
    )
    expect(m.errors[0]).toMatch(/^src\/patterns\.ts: edit 1: find matches 0 times/)
    expect(m.errors[1]).toMatch(/listed more than once/)
  })
})

describe('introducedText / editRetryPrompt', () => {
  it('returns only what the model wrote', () => {
    expect(introducedText({ path: 'a', edits: [{ find: 'OLD', replace: 'new1' }, { find: 'X', replace: 'new2' }], reason: 'r' })).toBe('new1\nnew2')
    expect(introducedText({ path: 'b', contents: 'whole', reason: 'r' })).toBe('whole')
  })

  it('feeds every error back with the rules for a valid retry', () => {
    const p = editRetryPrompt(['src/a.ts: edit 1: find matches 0 times'])
    expect(p).toContain('- src/a.ts: edit 1: find matches 0 times')
    expect(p).toMatch(/without the line-number gutter/)
    expect(p).toMatch(/needsHumanReview=true/)
  })
})

describe('isCommentOnlyFix', () => {
  it('flags the placeholder notes seen on 2026-10-03 (comment-only edits)', () => {
    expect(isCommentOnlyFix([{ path: 'a.ts', reason: 'r', edits: [{ find: 'const FN = "x";', replace: 'const FN = "x"; // NOTE: flagged for human review' }] }])).toBe(true)
    expect(isCommentOnlyFix([{ path: 'a.ts', reason: 'r', edits: [{ find: 'export const a = 1', replace: '// NOTE: placeholder touch only\nexport const a = 1' }] }])).toBe(true)
    expect(isCommentOnlyFix([{ path: 'a.tsx', reason: 'r', edits: [{ find: 'export function Hero() {', replace: '/* NOTE: the real LCP element is unconfirmed.\n * Capture a trace first. */\nexport function Hero() {' }] }])).toBe(true)
  })
  it('passes a real code change, and treats an empty proposal as comment-only', () => {
    expect(isCommentOnlyFix([{ path: 'a.ts', reason: 'r', edits: [{ find: 'if (error) throw new Error(error);', replace: 'if (error) throw new Error(describeError(error));' }] }])).toBe(false)
    expect(isCommentOnlyFix([{ path: 'n.ts', reason: 'r', contents: '// only a comment\n' }])).toBe(true)
    expect(isCommentOnlyFix([])).toBe(true)
  })
})
