/**
 * FILE: fix-verify.test.ts
 * PURPOSE: Verified fixes (ADR 0035, Plan 024): the pure gates. An agent's
 *          PR merges on its own only on proof, so every rule here must fail
 *          closed: a deleted or weakened test, a skip marker, a lockfile or
 *          CI edit, an oversized diff, an unreadable or mismatched proof, or
 *          a second review that has not run all keep the merge off.
 */

import { describe, expect, it } from 'vitest'
import {
  analyzeDiff,
  autoMergeDecision,
  budgetGate,
  ciFailedOnMerge,
  ciGate,
  evaluateVerification,
  failToPassGate,
  findVerifyCheck,
  globToRegExp,
  isDependencyReport,
  isTestPath,
  isVerificationFinal,
  parseVerifyResult,
  pickVerificationRow,
  pickVerifyBatch,
  protectedGate,
  readGates,
  readSecondJudge,
  readVerifyCheck,
  reportReopenedSince,
  reportsInChangedFiles,
  reviewGate,
  revertBranchName,
  revertSafety,
  secondJudgeDue,
  secondReviewGate,
  SNAPSHOT_LINE_LIMIT,
  toPublicVerification,
  utcDayStart,
  VERIFY_GATE_ORDER,
  verifySettingsFromRow,
  verifySettingsPatchSchema,
  verifySettingsPatchToRow,
  verifySettingsToRow,
  VERIFY_SETTINGS_DEFAULTS,
  type PrFile,
  type SecondJudgeRecord,
  type VerificationInput,
  type VerifyCheckRunLike,
} from '../../supabase/functions/_shared/fix-verify.ts'

const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const NOW = new Date('2026-10-21T12:00:00Z')

function file(filename: string, patch: string | null, extra: Partial<PrFile> = {}): PrFile {
  const lines = (patch ?? '').split('\n')
  return {
    filename,
    status: 'modified',
    additions: lines.filter((l) => l.startsWith('+')).length,
    deletions: lines.filter((l) => l.startsWith('-')).length,
    patch,
    ...extra,
  }
}

function verifyText(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    head_sha: HEAD,
    base_sha: BASE,
    tests: ['src/foo.test.ts'],
    head: 'pass',
    base: 'fail',
    verdict: 'fail_to_pass',
    command: 'pnpm vitest run {files}',
    runner: 'alienware-glot-1',
    duration_s: 42,
    log_tail: 'ok',
    ...over,
  })
}

function verifyCheck(text: string | null, over: Partial<VerifyCheckRunLike> = {}): VerifyCheckRunLike {
  return { id: 9, name: 'Mushi verify', status: 'completed', conclusion: 'success', started_at: '2026-10-21T11:00:00Z', output: { text }, ...over }
}

const green = (name: string): VerifyCheckRunLike => ({ name, status: 'completed', conclusion: 'success', started_at: '2026-10-21T11:00:00Z', completed_at: '2026-10-21T11:05:00Z' })

describe('isTestPath', () => {
  it.each([
    'src/__tests__/a.ts',
    'src/foo.test.ts',
    'src/foo.spec.tsx',
    'test/a.js',
    'pkg/tests/a.py',
    'e2e/login.ts',
    'svc/handler_test.go',
    'app/test_views.py',
    'app/views_test.py',
    'src/main/java/FooTest.java',
    'Sources/AppTests.swift',
  ])('%s is a test', (p) => expect(isTestPath(p)).toBe(true))

  it.each(['src/foo.ts', 'src/testing-utils.ts', 'src/contest/a.ts', 'src/latest.ts', 'docs/test.md.bak', 'src/attestation.py'])(
    '%s is not a test',
    (p) => expect(isTestPath(p)).toBe(false),
  )
})

describe('analyzeDiff and the protected-paths gate', () => {
  it('passes a fix with a new test and no weakening', () => {
    const a = analyzeDiff([
      file('src/cart.ts', '@@ -1 +1 @@\n-return a\n+return a ?? 0'),
      file('src/cart.test.ts', '@@ -1 +1,3 @@\n+it("handles null", () => {\n+  expect(total(null)).toBe(0)\n+})', { status: 'added' }),
    ])
    expect(a.sourceFiles).toEqual(['src/cart.ts'])
    expect(a.testFiles).toEqual(['src/cart.test.ts'])
    expect(a.assertions).toEqual([{ file: 'src/cart.test.ts', removed: 0, added: 1 }])
    expect(protectedGate(a)).toMatchObject({ status: 'pass', label: 'No tests weakened' })
  })

  it('fails a deleted test file', () => {
    const a = analyzeDiff([file('src/cart.test.ts', '@@\n-it("x", () => expect(1).toBe(1))', { status: 'removed' })])
    expect(a.testFilesDeleted).toEqual(['src/cart.test.ts'])
    const g = protectedGate(a)
    expect(g.status).toBe('fail')
    expect(g.detail).toMatch(/deletes test file src\/cart\.test\.ts/)
  })

  it('fails a test renamed out of the test folders', () => {
    const a = analyzeDiff([file('src/cart-helpers.ts', '@@\n+x', { status: 'renamed', previous_filename: 'src/__tests__/cart.ts' })])
    expect(a.testFilesDeleted).toEqual(['src/__tests__/cart.ts'])
    expect(protectedGate(a).status).toBe('fail')
  })

  it('fails when more assertions are removed than added in a test file (glot.it #99)', () => {
    const patch = ['@@', '-  expect(a).toBe(1)', '-  expect(b).toBe(2)', '-  assert.equal(c, 3)', '+  expect(a).toBeTruthy()'].join('\n')
    const a = analyzeDiff([file('src/x.test.ts', patch)])
    expect(a.assertions).toEqual([{ file: 'src/x.test.ts', removed: 3, added: 1 }])
    expect(a.assertionsWeakened).toEqual(['src/x.test.ts'])
    expect(protectedGate(a).status).toBe('fail')
  })

  it('allows rewriting assertions one for one', () => {
    const a = analyzeDiff([file('src/x.test.ts', '@@\n-  expect(a).toBe(1)\n+  expect(a).toBe(2)')])
    expect(a.assertionsWeakened).toEqual([])
    expect(protectedGate(a).status).toBe('pass')
  })

  it('counts Python assert statements and Go require calls', () => {
    const a = analyzeDiff([
      file('app/test_views.py', '@@\n-    assert resp.status == 200\n-    assert body'),
      file('svc/h_test.go', '@@\n-\trequire.NoError(t, err)\n+\trequire.NoError(t, err)'),
    ])
    expect(a.assertions).toEqual([
      { file: 'app/test_views.py', removed: 2, added: 0 },
      { file: 'svc/h_test.go', removed: 1, added: 1 },
    ])
    expect(a.assertionsWeakened).toEqual(['app/test_views.py'])
  })

  it.each([
    ['.skip(', 'src/a.test.ts', '+it.skip("x", () => {})'],
    ['.only(', 'src/a.test.ts', '+describe.only("x", () => {})'],
    ['xit(', 'src/a.spec.ts', '+xit("x", () => {})'],
    ['xdescribe(', 'src/a.spec.ts', '+xdescribe("x", () => {})'],
    ['@pytest.mark.skip', 'tests/test_a.py', '+@pytest.mark.skip'],
    ['@ts-ignore', 'src/a.ts', '+  // @ts-ignore'],
    ['@ts-expect-error', 'src/a.ts', '+  // @ts-expect-error'],
    ['eslint-disable', 'src/a.ts', '+/* eslint-disable no-console */'],
    ['istanbul ignore', 'src/a.ts', '+/* istanbul ignore next */'],
    ['# pragma: no cover', 'app/a.py', '+    pass  # pragma: no cover'],
  ])('fails an added %s', (marker, path, line) => {
    const a = analyzeDiff([file(path, `@@\n${line}`)])
    expect(a.markersAdded.map((m) => m.marker)).toContain(marker)
    expect(protectedGate(a).status).toBe('fail')
  })

  it('ignores a marker the diff only moves, and .skip( in application code', () => {
    const a = analyzeDiff([
      file('src/a.ts', '@@\n-  // @ts-ignore\n+  // @ts-ignore'),
      file('src/stream.ts', '@@\n+  return rows.skip(10)'),
    ])
    expect(a.markersAdded).toEqual([])
    expect(protectedGate(a).status).toBe('pass')
  })

  it('fails a lockfile change unless the report is about a dependency', () => {
    const a = analyzeDiff([file('pnpm-lock.yaml', '@@\n+x'), file('package.json', '@@\n-"a": "1"\n+"a": "2"')])
    expect(a.lockfilesTouched).toEqual(['pnpm-lock.yaml'])
    expect(a.sourceFiles).toEqual(['package.json'])
    expect(protectedGate(a).status).toBe('fail')
    expect(protectedGate(a, { allowLockfiles: true }).status).toBe('pass')
  })

  it('fails a CI config change', () => {
    for (const path of ['.github/workflows/ci.yml', '.gitlab-ci.yml', '.circleci/config.yml']) {
      const a = analyzeDiff([file(path, '@@\n+x')])
      expect(a.ciConfigTouched).toEqual([path])
      expect(protectedGate(a).status).toBe('fail')
    }
  })

  it(`fails snapshot updates over ${SNAPSHOT_LINE_LIMIT} lines, not at the limit`, () => {
    const lines = (n: number) => `@@\n${Array.from({ length: n }, (_, i) => `+line ${i}`).join('\n')}`
    const atLimit = analyzeDiff([file('src/__snapshots__/a.test.ts.snap', lines(SNAPSHOT_LINE_LIMIT))])
    expect(atLimit.snapshotLines).toBe(SNAPSHOT_LINE_LIMIT)
    expect(atLimit.testFiles).toEqual([])
    expect(protectedGate(atLimit).status).toBe('pass')
    const over = analyzeDiff([file('src/__snapshots__/a.test.ts.snap', lines(SNAPSHOT_LINE_LIMIT + 1))])
    expect(protectedGate(over).status).toBe('fail')
  })

  it('fails a test file GitHub sent no patch for (binary or too large): nobody can count its assertions', () => {
    const a = analyzeDiff([{ filename: 'src/big.test.ts', status: 'modified', additions: 900, deletions: 400, patch: null }])
    expect(a.unreadableTestFiles).toEqual(['src/big.test.ts'])
    expect(protectedGate(a).status).toBe('fail')
  })

  it('does not fail a source file without a patch (the budget still counts it)', () => {
    const a = analyzeDiff([{ filename: 'src/big.ts', status: 'modified', additions: 10, deletions: 2, patch: null }])
    expect(protectedGate(a).status).toBe('pass')
    expect(a.sourceLines).toBe(12)
  })

  it('fails the project\'s protected globs', () => {
    const a = analyzeDiff([file('supabase/migrations/001_x.sql', '@@\n+x'), file('src/auth/session.ts', '@@\n+x')], {
      protectedGlobs: ['*.sql', 'src/auth/**'],
    })
    expect(a.protectedTouched).toEqual([
      { file: 'supabase/migrations/001_x.sql', glob: '*.sql' },
      { file: 'src/auth/session.ts', glob: 'src/auth/**' },
    ])
    expect(protectedGate(a).status).toBe('fail')
  })

  it('fails an incomplete file list', () => {
    expect(protectedGate(analyzeDiff([file('src/a.ts', '@@\n+x')], { complete: false })).status).toBe('fail')
  })
})

describe('globToRegExp', () => {
  it('matches like a gitignore glob', () => {
    expect(globToRegExp('*.sql').test('a/b/c.sql')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false)
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('src/a/b/c.ts')).toBe(true)
    expect(globToRegExp('migrations').test('db/migrations/001.sql')).toBe(true)
    expect(globToRegExp('infra/').test('infra/main.tf')).toBe(true)
    expect(globToRegExp('a.b').test('axb')).toBe(false)
  })
})

describe('budgetGate at the edges', () => {
  const lines = (n: number) => `@@\n${Array.from({ length: n }, () => '+x').join('\n')}`
  it('passes at exactly the file and line limits, fails one over each', () => {
    const at = analyzeDiff([file('a.ts', lines(50)), file('b.ts', lines(50)), file('c.ts', lines(50))])
    expect(budgetGate(at, { maxFiles: 3, maxLines: 150 })).toMatchObject({ status: 'pass', label: 'Small change (3 files, 150 lines)' })
    const overLines = analyzeDiff([file('a.ts', lines(50)), file('b.ts', lines(50)), file('c.ts', lines(51))])
    expect(budgetGate(overLines, { maxFiles: 3, maxLines: 150 })).toMatchObject({ status: 'fail', label: 'Too big to merge on its own (3 files, 151 lines)' })
    const overFiles = analyzeDiff([file('a.ts', lines(1)), file('b.ts', lines(1)), file('c.ts', lines(1)), file('d.ts', lines(1))])
    expect(budgetGate(overFiles, { maxFiles: 3, maxLines: 150 }).status).toBe('fail')
  })

  it('leaves tests, lockfiles, snapshots, images and prose out of the budget', () => {
    const a = analyzeDiff([
      file('src/a.ts', lines(2)),
      file('src/a.test.ts', lines(400)),
      file('yarn.lock', lines(400)),
      file('src/__snapshots__/a.snap', lines(10)),
      file('docs/guide.md', lines(400)),
      file('public/logo.png', null),
    ])
    expect(budgetGate(a, { maxFiles: 1, maxLines: 10 })).toMatchObject({ status: 'pass', label: 'Small change (1 file, 2 lines)' })
  })

  it('fails when GitHub listed only part of the files', () => {
    expect(budgetGate(analyzeDiff([file('a.ts', lines(1))], { complete: false }), { maxFiles: 3, maxLines: 150 }).status).toBe('fail')
  })
})

describe('the Mushi verify check run', () => {
  it('passes a fail-to-pass result for the PR head', () => {
    const g = readVerifyCheck(verifyCheck(verifyText()), HEAD)
    expect(g).toMatchObject({ id: 'fail_to_pass', status: 'pass', label: 'Test proves the fix' })
    expect(g.evidence).toMatchObject({ tests: ['src/foo.test.ts'], runner: 'alienware-glot-1', durationS: 42 })
  })

  it.each([
    ['not JSON', 'definitely not json'],
    ['empty', ''],
    ['null', null],
    ['an array', '[1,2]'],
    ['the wrong schema', verifyText({ schema: 2 })],
    ['an unknown verdict', verifyText({ verdict: 'probably_fine' })],
    ['a fail_to_pass that contradicts its runs', verifyText({ head: 'pass', base: 'pass' })],
    ['a fail_to_pass with no tests', verifyText({ tests: [] })],
    ['a bad sha', verifyText({ head_sha: 'not-a-sha' })],
  ])('fails on %s with "could not read result"', (_what, text) => {
    expect(readVerifyCheck(verifyCheck(text as string | null), HEAD)).toMatchObject({ status: 'fail', label: 'Mushi verify: could not read result' })
  })

  it('fails a result about another commit', () => {
    expect(readVerifyCheck(verifyCheck(verifyText({ head_sha: 'c'.repeat(40) })), HEAD)).toMatchObject({ status: 'fail', label: 'Mushi verify: result is for another commit' })
  })

  it('reads a ```json fence and a short head sha', () => {
    const text = '```json\n' + verifyText({ head_sha: HEAD.slice(0, 7) }) + '\n```'
    expect(readVerifyCheck(verifyCheck(text), HEAD).status).toBe('pass')
  })

  it('decides no_test from the verdict, also when head reads "error" (the action posts head error, base skipped)', () => {
    const g = readVerifyCheck(verifyCheck(verifyText({ tests: [], head: 'error', base: 'skipped', verdict: 'no_test' })), HEAD)
    expect(g).toMatchObject({ status: 'fail', label: 'No test proves the fix' })
  })

  it.each([
    ['passes_without_fix', 'Tests pass without the fix', { base: 'pass' }],
    ['fails_with_fix', 'Tests fail with the fix', { head: 'fail', base: 'skipped' }],
    ['error', 'Mushi verify could not run the tests', { head: 'error', base: 'error' }],
  ])('fails %s', (verdict, label, runs) => {
    expect(readVerifyCheck(verifyCheck(verifyText({ verdict, ...runs })), HEAD)).toMatchObject({ status: 'fail', label })
  })

  it('is pending while the check runs', () => {
    expect(readVerifyCheck(verifyCheck(null, { status: 'in_progress', conclusion: null }), HEAD).status).toBe('pending')
  })

  it('caps the log tail at 4000 characters', () => {
    expect(parseVerifyResult(verifyText({ log_tail: 'x'.repeat(9000) }))?.log_tail).toHaveLength(4000)
  })

  it('reads only the check named exactly "Mushi verify", newest first', () => {
    const job = { ...verifyCheck(null), id: 1, name: 'Mushi verify run' }
    const older = { ...verifyCheck(verifyText({ verdict: 'no_test', head: 'error', base: 'skipped', tests: [] })), id: 2, started_at: '2026-10-21T10:00:00Z' }
    const newer = { ...verifyCheck(verifyText()), id: 3, started_at: '2026-10-21T11:30:00Z' }
    expect(findVerifyCheck([job, older, newer])?.id).toBe(3)
    expect(findVerifyCheck([job])).toBeNull()
  })

  it('is not_set_up without a check and without the workflow, pending with the workflow or when unknown', () => {
    expect(failToPassGate([green('build')], HEAD, false).status).toBe('not_set_up')
    expect(failToPassGate([green('build')], HEAD, true).status).toBe('pending')
    expect(failToPassGate([], HEAD, null).status).toBe('pending')
  })
})

describe('ciGate', () => {
  it('passes when every check is green and leaves out both Mushi verify checks', () => {
    const failingVerify = { ...verifyCheck(verifyText({ verdict: 'no_test', head: 'error', base: 'skipped', tests: [] })), conclusion: 'failure' }
    const failingJob = { name: 'Mushi verify run', status: 'completed', conclusion: 'failure', started_at: '2026-10-21T11:00:00Z' }
    const g = ciGate([green('build'), green('test'), failingVerify, failingJob], { now: NOW })
    expect(g).toMatchObject({ status: 'pass', label: 'CI passed (2 checks)' })
  })

  it('leaves out review bots', () => {
    const bot = { name: 'copilot-pull-request-reviewer', status: 'completed', conclusion: 'failure' }
    expect(ciGate([green('build'), bot], { now: NOW }).status).toBe('pass')
  })

  it('fails a code failure and a plain cancel', () => {
    expect(ciGate([green('build'), { name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-10-21T11:00:00Z' }], { now: NOW })).toMatchObject({
      status: 'fail',
      label: 'CI failed (test)',
    })
    expect(ciGate([{ name: 'test', status: 'completed', conclusion: 'cancelled', started_at: '2026-10-21T11:55:00Z', completed_at: '2026-10-21T11:56:00Z' }], { now: NOW }).status).toBe('fail')
  })

  it('reads an infra stop as pending, never a pass or a code failure (ADR 0033)', () => {
    const lost = { name: 'test', status: 'completed', conclusion: 'cancelled', started_at: '2026-10-21T11:00:00Z' }
    const g = ciGate([green('build'), lost], { now: NOW, ciInfra: { kind: 'runner_lost', infra: true, job: 'test', runner: 'alienware-glot-1', detail: 'lost', at: '' } })
    expect(g.status).toBe('pending')
    expect(g.label).toMatch(/runner lost on alienware-glot-1/)
  })

  it('reads a lost-runner annotation as infra', () => {
    const lost = { name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-10-21T11:00:00Z' }
    expect(ciGate([lost], { now: NOW, annotations: { test: ['The runner has received a shutdown signal.'] } }).status).toBe('pending')
    expect(ciGate([lost], { now: NOW }).status).toBe('fail')
  })

  it('reads a long-running job cancelled by a person as cancelled (fail), not as a stranded queue', () => {
    const cancelled = { name: 'test', status: 'completed', conclusion: 'cancelled', started_at: '2026-10-21T10:00:00Z', completed_at: '2026-10-21T11:00:00Z' }
    expect(ciGate([cancelled], { now: NOW }).status).toBe('fail')
  })

  it('reads a check queued past the wait as waiting for a runner (pending)', () => {
    const queued = { name: 'test', status: 'queued', conclusion: null, started_at: '2026-10-21T11:00:00Z' }
    expect(ciGate([queued], { now: NOW }).label).toMatch(/waiting for a runner/)
  })

  it('is pending while running, or with no CI at all', () => {
    expect(ciGate([{ name: 'test', status: 'in_progress', conclusion: null, started_at: '2026-10-21T11:58:00Z' }], { now: NOW }).status).toBe('pending')
    expect(ciGate([verifyCheck(verifyText())], { now: NOW })).toMatchObject({ status: 'pending', label: 'Waiting for CI' })
  })
})

describe('reviewGate', () => {
  it('passes only a merge verdict about this head', () => {
    expect(reviewGate({ status: 'completed', verdict: 'merge', headSha: HEAD }, HEAD)).toMatchObject({ status: 'pass', label: 'Opus review: merge' })
    expect(reviewGate({ status: 'completed', verdict: 'fix_first', headSha: HEAD }, HEAD)).toMatchObject({ status: 'fail', label: 'Opus review: fix first' })
    expect(reviewGate({ status: 'completed', verdict: 'hold', headSha: HEAD }, HEAD)).toMatchObject({ status: 'fail', label: 'Opus review: hold' })
    expect(reviewGate({ status: 'completed', verdict: 'merge', headSha: BASE }, HEAD).status).toBe('pending')
    expect(reviewGate(null, HEAD).status).toBe('pending')
    expect(reviewGate({ status: 'queued', verdict: null, headSha: null }, HEAD).status).toBe('pending')
    expect(reviewGate({ status: 'skipped', verdict: null, headSha: null, reason: 'No Anthropic key' }, HEAD)).toMatchObject({ status: 'unavailable', label: 'Opus review skipped' })
  })
})

describe('second review', () => {
  const record = (over: Partial<SecondJudgeRecord> = {}): SecondJudgeRecord => ({
    provider: 'openai',
    model: 'gpt-5.4',
    verdict: 'merge',
    findings: [],
    summary: 'ok',
    input_tokens: 10,
    output_tokens: 5,
    cost_usd: 0.01,
    at: NOW.toISOString(),
    ...over,
  })

  it('waits for the other five gates', () => {
    expect(secondReviewGate({ kind: 'result', record: record() }, false)).toMatchObject({ status: 'pending', label: 'Second review waits for the other checks' })
  })

  it('passes merge, fails fix_first and hold, and is unavailable without a key or when off', () => {
    expect(secondReviewGate({ kind: 'result', record: record() }, true)).toMatchObject({ status: 'pass', label: 'Second review (gpt-5.4): merge' })
    expect(secondReviewGate({ kind: 'result', record: record({ verdict: 'hold' }) }, true).status).toBe('fail')
    expect(secondReviewGate({ kind: 'result', record: record({ verdict: 'fix_first' }) }, true).status).toBe('fail')
    expect(secondReviewGate({ kind: 'unavailable', reason: 'no_key' }, true).status).toBe('unavailable')
    expect(secondReviewGate({ kind: 'unavailable', reason: 'off' }, true)).toMatchObject({ status: 'unavailable', label: 'Second review is off' })
    expect(secondReviewGate(null, true).status).toBe('pending')
  })

  it('retries a failed call up to three times, then stops', () => {
    expect(secondJudgeDue(null)).toBe(true)
    expect(secondJudgeDue(record())).toBe(false)
    expect(secondJudgeDue(record({ verdict: null, error: 'timeout', tries: 2 }))).toBe(true)
    expect(secondJudgeDue(record({ verdict: null, error: 'timeout', tries: 3 }))).toBe(false)
    expect(secondReviewGate({ kind: 'result', record: record({ verdict: null, error: 'x', tries: 1 }) }, true).status).toBe('pending')
    expect(secondReviewGate({ kind: 'result', record: record({ verdict: null, error: 'x', tries: 3 }) }, true).status).toBe('unavailable')
  })

  it('reads a stored record defensively', () => {
    expect(readSecondJudge(record())).toMatchObject({ provider: 'openai', verdict: 'merge' })
    expect(readSecondJudge({ provider: 'anthropic', model: 'x', at: 'y' })).toBeNull()
    expect(readSecondJudge('nope')).toBeNull()
    expect(readSecondJudge({ provider: 'openrouter', model: 'openai/gpt-5.4', at: 'y', verdict: 'approve' })?.verdict).toBeNull()
  })
})

describe('evaluateVerification', () => {
  const passing = (over: Partial<VerificationInput> = {}): VerificationInput => ({
    headSha: HEAD,
    review: { status: 'completed', verdict: 'merge', headSha: HEAD },
    checks: [green('build'), verifyCheck(verifyText())],
    workflowInstalled: true,
    files: [file('src/cart.ts', '@@\n-a\n+b'), file('src/cart.test.ts', '@@\n+  expect(x).toBe(1)', { status: 'added' })],
    filesComplete: true,
    settings: { verifyMaxFiles: 3, verifyMaxLines: 150, verifyProtectedGlobs: [] },
    secondJudge: null,
    now: NOW,
    ...over,
  })

  it('returns the gates in order: review, ci, fail_to_pass, protected, budget, second_review', () => {
    const r = evaluateVerification(passing())
    expect(r.gates.map((g) => g.id)).toEqual(['review', 'ci', 'fail_to_pass', 'protected', 'budget', 'second_review'])
    expect(VERIFY_GATE_ORDER).toEqual(r.gates.map((g) => g.id))
  })

  it('holds the second review to the end: pending until the others pass, and passed only with its merge', () => {
    const r = evaluateVerification(passing())
    expect(r.othersPass).toBe(true)
    expect(r.passed).toBe(false)
    expect(r.gates[5]).toMatchObject({ id: 'second_review', status: 'pending', label: 'Second review running' })

    const done = evaluateVerification(passing({ secondJudge: { kind: 'result', record: { provider: 'openai', model: 'gpt-5.4', verdict: 'merge', findings: [], summary: null, input_tokens: 1, output_tokens: 1, cost_usd: 0, at: '' } } }))
    expect(done.passed).toBe(true)
    expect(done.gates.every((g) => g.status === 'pass')).toBe(true)
  })

  it('does not run the second review while any other gate is open, even with a stored merge', () => {
    const stored = { kind: 'result' as const, record: { provider: 'openai' as const, model: 'gpt-5.4', verdict: 'merge' as const, findings: [], summary: null, input_tokens: 1, output_tokens: 1, cost_usd: 0, at: '' } }
    const r = evaluateVerification(passing({ checks: [green('build')], workflowInstalled: false, secondJudge: stored }))
    expect(r.gates[2].status).toBe('not_set_up')
    expect(r.othersPass).toBe(false)
    expect(r.gates[5].status).toBe('pending')
    expect(r.passed).toBe(false)
  })

  it('a PR that only edits tests fails the proof (no_test) and never passes', () => {
    const r = evaluateVerification(passing({
      checks: [green('build'), verifyCheck(verifyText({ verdict: 'passes_without_fix', base: 'pass' }))],
      files: [file('src/cart.test.ts', '@@\n-  expect(x).toBe(1)\n+  expect(x).toBe(1)')],
    }))
    expect(r.gates[2].status).toBe('fail')
    expect(r.passed).toBe(false)
  })

  it('allows lockfiles for a dependency report only', () => {
    const files = [file('src/a.ts', '@@\n+x'), file('package-lock.json', '@@\n+x')]
    expect(evaluateVerification(passing({ files })).gates[3].status).toBe('fail')
    expect(evaluateVerification(passing({ files, allowLockfiles: true })).gates[3].status).toBe('pass')
    expect(isDependencyReport({ summary: 'Bump axios to fix CVE-2026-1234' })).toBe(true)
    expect(isDependencyReport({ summary: 'Cart total is wrong' })).toBe(false)
  })
})

describe('isVerificationFinal', () => {
  const gates = (status: Record<string, string>) => VERIFY_GATE_ORDER.map((id) => ({ id, status: status[id] ?? 'pass', label: id, detail: '' }))
  it('settles on deterministic failures and on a merge outcome, keeps re-checkable states open', () => {
    expect(isVerificationFinal({ gates: gates({ budget: 'fail' }), passed: false, auto_merge_state: 'none' })).toBe(true)
    expect(isVerificationFinal({ gates: gates({ review: 'fail' }), passed: false, auto_merge_state: 'none' })).toBe(true)
    expect(isVerificationFinal({ gates: gates({ ci: 'fail' }), passed: false, auto_merge_state: 'none' })).toBe(false)
    expect(isVerificationFinal({ gates: gates({ fail_to_pass: 'pending' }), passed: false, auto_merge_state: 'none' })).toBe(false)
    expect(isVerificationFinal({ gates: gates({}), passed: true, auto_merge_state: 'skipped' })).toBe(false)
    expect(isVerificationFinal({ gates: gates({}), passed: true, auto_merge_state: 'merged' })).toBe(true)
    expect(isVerificationFinal({ gates: [], passed: false, auto_merge_state: 'none' })).toBe(false)
  })
})

describe('autoMergeDecision: the daily cap and the switch', () => {
  const on = { verifiedAutoMerge: true, verifiedAutoMergeDailyLimit: 5 }
  it('merges under the cap, stops at it', () => {
    expect(autoMergeDecision({ passed: true, settings: on, mergedToday: 4, reportStatus: 'fixing', prOpen: true })).toMatchObject({ merge: true, state: 'eligible' })
    const capped = autoMergeDecision({ passed: true, settings: on, mergedToday: 5, reportStatus: 'fixing', prOpen: true })
    expect(capped).toMatchObject({ merge: false, state: 'skipped' })
    expect(capped.detail).toMatch(/limit of 5 automatic merges/)
    expect(autoMergeDecision({ passed: true, settings: { ...on, verifiedAutoMergeDailyLimit: 1 }, mergedToday: 1, reportStatus: null, prOpen: true }).merge).toBe(false)
  })

  it('never merges when off, failing, closed or already fixed', () => {
    expect(autoMergeDecision({ passed: true, settings: { ...on, verifiedAutoMerge: false }, mergedToday: 0, reportStatus: null, prOpen: true })).toMatchObject({ merge: false, state: 'skipped' })
    expect(autoMergeDecision({ passed: false, settings: on, mergedToday: 0, reportStatus: null, prOpen: true })).toMatchObject({ merge: false, state: 'none' })
    expect(autoMergeDecision({ passed: true, settings: on, mergedToday: 0, reportStatus: 'fixed', prOpen: true }).merge).toBe(false)
    expect(autoMergeDecision({ passed: true, settings: on, mergedToday: 0, reportStatus: null, prOpen: false }).merge).toBe(false)
  })

  it('counts the day in UTC', () => {
    expect(utcDayStart(new Date('2026-10-21T23:59:00+09:00'))).toBe('2026-10-21T00:00:00.000Z')
  })
})

describe('revertSafety', () => {
  const prFiles = ['src/cart.ts', 'src/cart.test.ts']
  it('is safe when nothing landed after the merge, or later commits touched other files', () => {
    expect(revertSafety(prFiles, { status: 'identical', totalCommits: 0, commitsListed: 0, files: [] }).safe).toBe(true)
    expect(revertSafety(prFiles, { status: 'ahead', totalCommits: 2, commitsListed: 2, files: [{ filename: 'src/other.ts' }] }).safe).toBe(true)
  })

  it('is not_safe when a later commit touched the same file', () => {
    const r = revertSafety(prFiles, { status: 'ahead', totalCommits: 1, commitsListed: 1, files: [{ filename: 'src/cart.ts' }] })
    expect(r).toMatchObject({ safe: false, touched: ['src/cart.ts'] })
    expect(r.reason).toMatch(/Later commits changed src\/cart\.ts/)
    // A rename away from one of the files counts too.
    expect(revertSafety(prFiles, { status: 'ahead', totalCommits: 1, commitsListed: 1, files: [{ filename: 'src/basket.ts', previous_filename: 'src/cart.ts' }] }).safe).toBe(false)
  })

  it('is not_safe when it cannot see everything', () => {
    expect(revertSafety(prFiles, null).safe).toBe(false)
    expect(revertSafety(prFiles, { status: 'diverged', totalCommits: 1, commitsListed: 1, files: [] }).safe).toBe(false)
    expect(revertSafety(prFiles, { status: 'ahead', totalCommits: 300, commitsListed: 250, files: [] }).safe).toBe(false)
    expect(revertSafety(prFiles, { status: 'ahead', totalCommits: 1, commitsListed: 1, files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}` })) }).safe).toBe(false)
  })

  it('names the branch mushi/revert-<short>', () => {
    expect(revertBranchName('ABCDEF1234567')).toBe('mushi/revert-abcdef1')
  })
})

describe('regression signals', () => {
  it('ci on the merge commit: a code failure, never an infra stop or a running job', () => {
    expect(ciFailedOnMerge([{ name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-10-21T11:00:00Z' }], { now: NOW }).failed).toBe(true)
    expect(ciFailedOnMerge([{ name: 'test', status: 'in_progress', conclusion: null, started_at: '2026-10-21T11:59:00Z' }], { now: NOW }).failed).toBe(false)
    expect(ciFailedOnMerge([green('test')], { now: NOW }).failed).toBe(false)
  })

  it('a report reopened after the merge', () => {
    const mergedAt = '2026-10-21T10:00:00.000Z'
    expect(reportReopenedSince({ status: 'reopened', reopened_at: '2026-10-21T11:00:00.000Z' }, mergedAt)).toBe(true)
    expect(reportReopenedSince({ status: 'fixed', reopened_at: '2026-10-20T11:00:00.000Z' }, mergedAt)).toBe(false)
    expect(reportReopenedSince({ status: 'fixed', reopened_at: null }, mergedAt)).toBe(false)
    expect(reportReopenedSince(null, mergedAt)).toBe(false)
  })

  it('new reports whose stack names a changed file', () => {
    const hits = reportsInChangedFiles(
      [
        { id: 'r1', framePaths: ['src/cart.ts'] },
        { id: 'r2', framePaths: ['src/other.ts'] },
        { id: 'r3', framePaths: ['cart.ts'] },
      ],
      ['src/cart.ts', 'src/cart.test.ts'],
    )
    expect(hits).toEqual([
      { reportId: 'r1', files: ['src/cart.ts'] },
      { reportId: 'r3', files: ['src/cart.ts'] },
    ])
  })
})

describe('settings', () => {
  it('defaults every field, and keeps automatic merge off', () => {
    expect(verifySettingsFromRow(null)).toEqual(VERIFY_SETTINGS_DEFAULTS)
    expect(VERIFY_SETTINGS_DEFAULTS.verifiedAutoMerge).toBe(false)
    expect(verifySettingsFromRow({ verify_max_files: 99, verify_runs_on: ['bad label!'], verify_second_judge: 'claude' })).toMatchObject({
      verifyMaxFiles: 3,
      verifyRunsOn: ['ubuntu-latest'],
      verifySecondJudge: 'auto',
    })
  })

  it('round-trips the column names the console sends', () => {
    const row = verifySettingsToRow(VERIFY_SETTINGS_DEFAULTS)
    expect(Object.keys(row).sort()).toEqual(
      ['auto_revert', 'verified_auto_merge', 'verified_auto_merge_daily_limit', 'verify_max_files', 'verify_max_lines', 'verify_protected_globs', 'verify_runs_on', 'verify_second_judge', 'verify_second_judge_model', 'verify_test_command'],
    )
    expect(verifySettingsFromRow(row)).toEqual(VERIFY_SETTINGS_DEFAULTS)
  })

  it.each([
    [{ verified_auto_merge_daily_limit: 0 }],
    [{ verified_auto_merge_daily_limit: 51 }],
    [{ verified_auto_merge_daily_limit: 2.5 }],
    [{ verify_runs_on: [] }],
    [{ verify_runs_on: Array.from({ length: 9 }, (_, i) => `r${i}`) }],
    [{ verify_runs_on: ['has space'] }],
    [{ verify_runs_on: ['x'.repeat(65)] }],
    [{ verify_test_command: 'pnpm vitest run' }],
    [{ verify_test_command: `pnpm vitest run {files} ${'x'.repeat(300)}` }],
    [{ verify_test_command: 'pnpm vitest run {files}\nrm -rf /' }],
    [{ verify_test_command: 'pnpm test {files} ${{ secrets.X }}' }],
    [{ verify_max_files: 0 }],
    [{ verify_max_files: 21 }],
    [{ verify_max_lines: 9 }],
    [{ verify_max_lines: 1001 }],
    [{ verify_protected_globs: Array.from({ length: 31 }, (_, i) => `g${i}`) }],
    [{ verify_protected_globs: ['x'.repeat(201)] }],
    [{ verify_second_judge: 'anthropic' }],
    [{ verify_second_judge_model: 'gpt 5' }],
    [{ auto_revert: 'merge' }],
    [{ verifiedAutoMerge: true }],
  ])('rejects %j', (body) => {
    expect(verifySettingsPatchSchema.safeParse(body).success).toBe(false)
  })

  it('accepts the edges and maps them to columns', () => {
    const body = {
      verified_auto_merge: true,
      verified_auto_merge_daily_limit: 50,
      verify_runs_on: ['self-hosted', 'alienware-glot-1', 'x'.repeat(64), ...Array.from({ length: 5 }, (_, i) => `r${i}`)],
      verify_test_command: `${'x'.repeat(293)}{files}`,
      verify_max_files: 20,
      verify_max_lines: 10,
      verify_protected_globs: Array.from({ length: 30 }, () => 'y'.repeat(200)),
      verify_second_judge: 'openrouter',
      verify_second_judge_model: 'openai/gpt-5.4',
      auto_revert: 'off',
    }
    const parsed = verifySettingsPatchSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    expect(verifySettingsPatchToRow(parsed.data!)).toEqual(body)
    expect(verifySettingsPatchToRow(verifySettingsPatchSchema.parse({ verify_test_command: null }))).toEqual({ verify_test_command: null })
  })
})

describe('what callers see', () => {
  it('shows the merged head first, then the current head, then the newest', () => {
    const rows = [
      { head_sha: 'h1', merged_at: null, evaluated_at: '2026-10-21T10:00:00Z' },
      { head_sha: 'h2', merged_at: null, evaluated_at: '2026-10-21T11:00:00Z' },
    ]
    expect(pickVerificationRow(rows, 'h1')?.head_sha).toBe('h1')
    expect(pickVerificationRow(rows, 'zz')?.head_sha).toBe('h2')
    expect(pickVerificationRow([...rows, { head_sha: 'h0', merged_at: '2026-10-21T09:00:00Z', evaluated_at: '2026-10-21T09:00:00Z' }], 'h2')?.head_sha).toBe('h0')
    expect(pickVerificationRow([], 'h1')).toBeNull()
  })

  it('maps rows to the API shape and drops unknown gates', () => {
    const v = toPublicVerification(
      {
        id: 'v1',
        fix_attempt_id: 'f1',
        head_sha: HEAD,
        base_sha: null,
        gates: [{ id: 'review', status: 'pass', label: 'Opus review: merge', detail: 'x' }, { id: 'vibes', status: 'pass' }],
        passed: false,
        second_judge: null,
        auto_merge_state: 'skipped',
        auto_merge_detail: 'off',
        merged_at: null,
        merge_sha: null,
        evaluated_at: '2026-10-21T10:00:00Z',
      },
      [{ id: 'g1', signal: 'report_reopened', detail: null, merge_sha: 'm', revert_state: 'pr_opened', revert_pr_url: 'https://github.com/a/b/pull/2', created_at: 't' }],
    )
    expect(v.gates).toHaveLength(1)
    expect(v.autoMerge).toEqual({ state: 'skipped', detail: 'off' })
    expect(v.regressions[0]).toMatchObject({ id: 'g1', signal: 'report_reopened', label: 'The report was reopened', revertState: 'pr_opened', createdAt: 't' })
    expect(toPublicVerification(null, [], 'abc')).toMatchObject({ headSha: 'abc', gates: [], passed: false, autoMerge: { state: 'none', detail: null } })
    expect(readGates('nope')).toEqual([])
  })
})

describe('pickVerifyBatch', () => {
  it('takes at most 10, and at most 3 of one app', () => {
    const rows = [...Array.from({ length: 6 }, () => ({ project_id: 'p1' })), ...Array.from({ length: 12 }, (_, i) => ({ project_id: `q${i % 4}` }))]
    const batch = pickVerifyBatch(rows)
    expect(batch).toHaveLength(10)
    expect(batch.filter((r) => r.project_id === 'p1')).toHaveLength(3)
  })
})
