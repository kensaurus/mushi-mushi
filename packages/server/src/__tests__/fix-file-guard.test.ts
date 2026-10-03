/**
 * FILE: packages/server/src/__tests__/fix-file-guard.test.ts
 * PURPOSE: Regression guard for draft PR #424 (2026-10-02).
 *
 *          Report 469f6962 produced a blind whole-file rewrite of
 *          apps/docs/app/layout.tsx (+28/-147): the file was never indexed
 *          (indexer stuck on "tree fetch 404"), so the model invented it.
 *          The attempt also stored review_passed=false and opened the PR
 *          anyway. These tests pin the three guards that now sit between the
 *          model's output and GitHub, plus the fix-worker wiring.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assessFixFiles,
  deletedLineRatio,
  diffLineCount,
  fixDiffLineCount,
  fixReviewPassed,
  parseContentsResponse,
  reportRequestsRewrite,
  type BaseFileState,
} from '../../supabase/functions/_shared/fix-file-guard.ts'

const file = (path: string, contents: string) => ({ path, contents, reason: 'fix the bug' })

/** 147 distinct lines, the size of the real layout.tsx the agent rewrote. */
const original147 = Array.from({ length: 147 }, (_, i) => `  line ${i} of the Nextra layout`).join('\n')
/** 28 invented lines that keep almost nothing of the original. */
const rewrite28 = Array.from({ length: 28 }, (_, i) => `invented ${i}`).join('\n')

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

describe('fixReviewPassed (review gate)', () => {
  it('passes only when the model explicitly said no review is needed', () => {
    expect(fixReviewPassed({ needsHumanReview: false })).toBe(true)
    expect(fixReviewPassed({ needsHumanReview: true })).toBe(false)
    expect(fixReviewPassed({})).toBe(false)
    expect(fixReviewPassed({ needsHumanReview: null })).toBe(false)
  })
})

describe('deletedLineRatio (rewrite guard)', () => {
  it('flags the PR #424 shape: 147 lines replaced by 28', () => {
    expect(deletedLineRatio(original147, rewrite28)).toBeGreaterThan(0.6)
  })

  it('keeps a small in-place edit well under the threshold', () => {
    const edited = original147.replace('line 40 of', 'line forty of')
    expect(deletedLineRatio(original147, edited)).toBeLessThan(0.02)
  })

  it('ignores CRLF and trailing whitespace differences', () => {
    expect(deletedLineRatio('a\r\nb  \r\nc\r\n', 'a\nb\nc\n')).toBe(0)
  })

  it('treats an empty existing file as nothing deleted', () => {
    expect(deletedLineRatio('', 'new content')).toBe(0)
  })
})

describe('parseContentsResponse (blind-write guard input)', () => {
  it('reads an existing file, including GitHub base64 line breaks and UTF-8', () => {
    const encoded = b64('export const ok = "✓"\n').replace(/(.{8})/g, '$1\n')
    expect(parseContentsResponse(200, { type: 'file', encoding: 'base64', content: encoded })).toEqual({
      kind: 'exists',
      contents: 'export const ok = "✓"\n',
    })
  })

  it('treats a plain 404 as an absent path (a new file)', () => {
    expect(parseContentsResponse(404, { message: 'Not Found' })).toEqual({ kind: 'absent' })
  })

  it('never treats a bad ref as absent: that would pass every existing file as new', () => {
    expect(parseContentsResponse(404, { message: 'No commit found for the ref main' }).kind).toBe('unreadable')
  })

  it('treats directories, >1 MB files and errors as unreadable', () => {
    expect(parseContentsResponse(200, [{ name: 'a.ts' }]).kind).toBe('unreadable')
    expect(parseContentsResponse(200, { type: 'file', encoding: 'none', content: '' }).kind).toBe('unreadable')
    expect(parseContentsResponse(403, { message: 'Forbidden' }).kind).toBe('unreadable')
    expect(parseContentsResponse(500, null).kind).toBe('unreadable')
  })
})

describe('assessFixFiles', () => {
  it('aborts a file whose current contents could not be read, and blocks when none remain', () => {
    const states = new Map<string, BaseFileState>([
      ['apps/docs/app/layout.tsx', { kind: 'unreadable', detail: 'GitHub contents API returned 403' }],
    ])
    const result = assessFixFiles([file('apps/docs/app/layout.tsx', rewrite28)], states)
    expect(result.kept).toEqual([])
    expect(result.dropped[0]?.path).toBe('apps/docs/app/layout.tsx')
    expect(result.blockReason).toMatch(/no file can be written safely/)
  })

  it('drops a file that was never read at all', () => {
    const result = assessFixFiles([file('src/a.ts', 'x')], new Map())
    expect(result.kept).toEqual([])
    expect(result.blockReason).not.toBeNull()
  })

  it('blocks a modify that deletes more than 60% of the file (PR #424)', () => {
    const states = new Map<string, BaseFileState>([
      ['apps/docs/app/layout.tsx', { kind: 'exists', contents: original147 }],
    ])
    const result = assessFixFiles([file('apps/docs/app/layout.tsx', rewrite28)], states)
    expect(result.kept).toEqual([])
    expect(result.dropped[0]?.reason).toMatch(/deletes \d+% of the existing lines/)
    expect(result.blockReason).not.toBeNull()
  })

  it('allows that rewrite only when the report explicitly asked for one', () => {
    const states = new Map<string, BaseFileState>([
      ['apps/docs/app/layout.tsx', { kind: 'exists', contents: original147 }],
    ])
    const result = assessFixFiles([file('apps/docs/app/layout.tsx', rewrite28)], states, { allowRewrite: true })
    expect(result.kept).toHaveLength(1)
    expect(result.blockReason).toBeNull()
  })

  it('keeps a real edit and a new test file', () => {
    const states = new Map<string, BaseFileState>([
      ['src/a.ts', { kind: 'exists', contents: original147 }],
      ['src/a.test.ts', { kind: 'absent' }],
    ])
    const edited = original147.replace('line 3 of', 'line three of')
    const result = assessFixFiles([file('src/a.ts', edited), file('src/a.test.ts', 'test()')], states)
    expect(result.kept.map((f) => f.path)).toEqual(['src/a.ts', 'src/a.test.ts'])
    expect(result.dropped).toEqual([])
    expect(result.blockReason).toBeNull()
  })

  it('allows a proposal made only of new files', () => {
    const states = new Map<string, BaseFileState>([['src/new.ts', { kind: 'absent' }]])
    const result = assessFixFiles([file('src/new.ts', 'export {}')], states)
    expect(result.kept).toHaveLength(1)
    expect(result.blockReason).toBeNull()
  })

  it('blocks when every modification was dropped and only new files are left', () => {
    const states = new Map<string, BaseFileState>([
      ['src/a.ts', { kind: 'unreadable', detail: 'path is a directory' }],
      ['NEEDS_INVESTIGATION.md', { kind: 'absent' }],
    ])
    const result = assessFixFiles([file('src/a.ts', 'x'), file('NEEDS_INVESTIGATION.md', 'notes')], states)
    expect(result.kept.map((f) => f.path)).toEqual(['NEEDS_INVESTIGATION.md'])
    expect(result.blockReason).toMatch(/only new files remain/)
  })
})

describe('reportRequestsRewrite', () => {
  it('matches an explicit rewrite request only', () => {
    expect(reportRequestsRewrite(['Please rewrite the header component'])).toBe(true)
    expect(reportRequestsRewrite([null, 'start this page from scratch'])).toBe(true)
    expect(reportRequestsRewrite(['The button is misaligned', undefined])).toBe(false)
    expect(reportRequestsRewrite(['the writer field is empty'])).toBe(false)
  })
})

describe('fix-worker wiring', () => {
  const src = readFileSync(
    resolve(__dirname, '../../supabase/functions/fix-worker/index.ts'),
    'utf8',
  )
  // Since 2026-10-03 the token is resolved BEFORE the model runs, to read
  // whole files at the base commit (read-only). The invariant that matters is
  // that the review gate runs before anything is applied or written.
  const tokenResolve = src.indexOf('const ghToken = await resolveGithubToken(')
  const firstModelCall = src.indexOf('await generateFix(null)')
  const reviewGate = src.indexOf('if (!fixReviewPassed(fix))')
  const materialize = src.indexOf('materializeFixFiles(fix.files, baseStates)')
  const fileGuard = src.indexOf('assessFixFiles(materialized, baseStates')
  const prCreate = src.indexOf('await createPrFromFiles(')

  it('runs the review gate before any edit is applied or GitHub write, so no review_passed=false fix opens a PR', () => {
    expect(tokenResolve).toBeGreaterThan(0)
    expect(tokenResolve).toBeLessThan(firstModelCall)
    expect(reviewGate).toBeGreaterThan(firstModelCall)
    expect(reviewGate).toBeLessThan(materialize)
    expect(reviewGate).toBeLessThan(prCreate)
  })

  it('runs the blind-write guard on the patched files before the PR and commits only the files it kept', () => {
    expect(fileGuard).toBeGreaterThan(materialize)
    expect(fileGuard).toBeLessThan(prCreate)
    expect(src).toMatch(/baseSha: base\.sha,/)
    expect(src).toMatch(/files: prFiles,/)
    expect(src).toMatch(/files_changed: prFiles\.map/)
  })

  it('keeps every candidate and every edit inside the target repo', () => {
    // Index paths are attributed against the resolved repo's globs; the scope
    // check honours every glob of that repo, not only the first.
    expect(src).toMatch(/const scope = await loadLinkedRepoScope\(db, projectId, repo\)/)
    expect(src).toMatch(/attribute,\n/)
    expect(src).toMatch(/searchRepoCode\(ghToken, repo\.owner, repo\.repo, term\)/)
    expect(src).toMatch(/fetchBaseFileState\(ghToken, repo\.owner, repo\.repo, baseSha, path\)/)
    expect(src.match(/validateFixProposal\(fix, repo\.pathGlobs\)/g)).toHaveLength(2)
  })

  it('stores review_passed from the same helper the gate uses', () => {
    expect(src).not.toMatch(/review_passed: !fix\.needsHumanReview/)
    expect(src).toMatch(/review_passed: fixReviewPassed\(fix\)/)
  })

  it('blocks with a failure_category the live CHECK constraint accepts', () => {
    expect(src).toMatch(/failure_category: 'validation_rejected'/)
    expect(src).toMatch(/review_failed: /)
  })
})

describe('diffLineCount (fix_attempts.lines_changed)', () => {
  it('counts PR #424 as GitHub did: +28 / -147 = 175, not the 28-line new file', () => {
    expect(diffLineCount(original147, rewrite28)).toBe(175)
  })

  it('counts a one-line edit as one added plus one deleted line', () => {
    const before = 'a\nb\nc\nd'
    const after = 'a\nb\nC\nd'
    expect(diffLineCount(before, after)).toBe(2)
  })

  it('counts a new file (no base) as all added lines, and ignores a trailing newline', () => {
    expect(diffLineCount(null, 'x\ny\nz\n')).toBe(3)
    expect(diffLineCount('same\n', 'same')).toBe(0)
  })

  it('sums kept files against what the base branch held', () => {
    const base = new Map<string, BaseFileState>([
      ['app/layout.tsx', { kind: 'exists', contents: original147 }],
      ['app/new.ts', { kind: 'absent' }],
    ])
    expect(
      fixDiffLineCount([file('app/layout.tsx', rewrite28), file('app/new.ts', 'one\ntwo')], base),
    ).toBe(177)
  })
})

describe('fix-worker diff size and PR body', () => {
  const src = readFileSync(
    resolve(__dirname, '../../supabase/functions/fix-worker/index.ts'),
    'utf8',
  )

  it('fix-worker stores the real diff size, not the new file length', () => {
    expect(src).toMatch(/const prLines = fixDiffLineCount\(prFiles, baseStates\)/)
    expect(src).not.toMatch(/prFiles\.reduce\(\(n, f\) => n \+ f\.contents\.split/)
  })

  it('links the PR body to the https console, not a mushi:// URL GitHub cannot open', () => {
    expect(src).not.toMatch(/mushi:\/\/reports/)
    expect(src).toMatch(/\$\{adminBase\}\/reports\//)
  })
})
