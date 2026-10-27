/**
 * Tests for the pure parts of .github/actions/fix-verify/verify.mjs, the
 * fail-to-pass proof behind the "Mushi verify" check (Plan 024, ADR 0035):
 * test detection, the change plan, {files} quoting, run classification, the
 * verdict and the check-run payload. Run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  CHECK_NAME,
  LOG_TAIL_MAX,
  buildResult,
  buildTestCommand,
  checkRunPayload,
  classifyRun,
  computeVerdict,
  conclusionFor,
  globToRegExp,
  isRunnableTest,
  isTestPath,
  parseArgs,
  parseGlobs,
  parseNameStatusZ,
  planChanges,
  redactSecrets,
  renderSummary,
  shellQuote,
  tailText,
  testEnv,
} from '../.github/actions/fix-verify/verify.mjs'

test('isTestPath follows the Plan 024 rules', () => {
  for (const p of [
    'src/__tests__/foo.ts',
    'src/foo.test.ts',
    'src/foo.spec.tsx',
    'test/foo.js',
    'packages/a/tests/foo.py',
    'e2e/login.ts',
    'pkg/foo_test.go',
    'tests_x/test_foo.py',
    'app/foo_test.py',
    'src/main/java/FooTest.java',
    'Sources/FooTests.swift',
  ]) {
    assert.equal(isTestPath(p), true, p)
  }
  for (const p of ['src/foo.ts', 'src/testing.ts', 'src/contest/foo.ts', 'latest/foo.ts', 'src/FooTester.java', 'test.ts', 'docs/e2e.md']) {
    assert.equal(isTestPath(p), false, p)
  }
})

test('isRunnableTest keeps test code and drops snapshots, fixtures and helpers that are not code', () => {
  assert.equal(isRunnableTest('src/foo.test.ts'), true)
  assert.equal(isRunnableTest('tests/test_api.py'), true)
  assert.equal(isRunnableTest('src/__tests__/__snapshots__/foo.test.ts.snap'), false)
  assert.equal(isRunnableTest('tests/fixtures/data.json'), false)
  assert.equal(isRunnableTest('tests/fixtures/mock.ts'), false)
  assert.equal(isRunnableTest('tests/conftest.py'), false)
  assert.equal(isRunnableTest('test/globals.d.ts'), false)
  assert.equal(isRunnableTest('src/foo.ts'), false)
})

test('globs: ** spans directories, * stays in a segment, braces and bare names', () => {
  assert.equal(globToRegExp('**/*.test.ts').test('a/b/c.test.ts'), true)
  assert.equal(globToRegExp('**/*.test.ts').test('c.test.ts'), true)
  assert.equal(globToRegExp('src/*.test.ts').test('src/a/c.test.ts'), false)
  assert.equal(globToRegExp('src/*.test.ts').test('src/c.test.ts'), true)
  assert.equal(globToRegExp('*.spec.{ts,js}').test('deep/x.spec.js'), true)
  assert.equal(globToRegExp('*.spec.{ts,js}').test('deep/x.spec.py'), false)
  assert.equal(globToRegExp('e2e/**').test('e2e/a/b.ts'), true)
  assert.equal(globToRegExp('a.b').test('axb'), false)
  assert.deepEqual(parseGlobs(' **/*.test.ts, e2e/**\n,'), ['**/*.test.ts', 'e2e/**'])
})

test('parseNameStatusZ reads -z output, splitting renames into delete + add', () => {
  const raw = ['M', 'src/a.ts', 'A', 'src/a.test.ts', 'D', 'src/old.ts', 'R087', 'src/x.ts', 'src/y.ts', 'T', 'bin/run', ''].join('\0')
  assert.deepEqual(parseNameStatusZ(raw), [
    { status: 'M', path: 'src/a.ts' },
    { status: 'A', path: 'src/a.test.ts' },
    { status: 'D', path: 'src/old.ts' },
    { status: 'D', path: 'src/x.ts' },
    { status: 'A', path: 'src/y.ts' },
    { status: 'T', path: 'bin/run' },
  ])
  assert.deepEqual(parseNameStatusZ('M\0with space/and\nnewline.ts\0'), [{ status: 'M', path: 'with space/and\nnewline.ts' }])
})

test('planChanges: tests stay at head, source goes back to base, added source is removed', () => {
  const plan = planChanges([
    { status: 'M', path: 'src/sum.ts' },
    { status: 'A', path: 'src/new-helper.ts' },
    { status: 'D', path: 'src/legacy.ts' },
    { status: 'A', path: 'src/sum.test.ts' },
    { status: 'M', path: 'src/other.spec.ts' },
    { status: 'D', path: 'src/gone.test.ts' },
    { status: 'M', path: 'tests/fixtures/data.json' },
  ])
  assert.deepEqual(plan.tests, ['src/other.spec.ts', 'src/sum.test.ts'])
  assert.deepEqual(plan.restore, ['src/sum.ts', 'src/legacy.ts'])
  assert.deepEqual(plan.baseOnly, ['src/legacy.ts'])
  assert.deepEqual(plan.remove, ['src/new-helper.ts'])
})

test('planChanges with test-globs: only matching files run, and a glob match is kept at head', () => {
  const plan = planChanges(
    [
      { status: 'A', path: 'src/sum.test.ts' },
      { status: 'A', path: 'checks/sum.check.ts' },
      { status: 'M', path: 'src/sum.ts' },
    ],
    ['*.check.ts'],
  )
  assert.deepEqual(plan.tests, ['checks/sum.check.ts'])
  assert.deepEqual(plan.restore, ['src/sum.ts'])
  assert.deepEqual(plan.remove, [])
})

test('planChanges with only edits to source gives no tests', () => {
  assert.deepEqual(planChanges([{ status: 'M', path: 'src/a.ts' }]).tests, [])
})

test('shellQuote and buildTestCommand quote every path so the shell runs nothing from a name', () => {
  assert.equal(shellQuote("it's.test.ts"), `'it'\\''s.test.ts'`)
  const cmd = buildTestCommand('pnpm vitest run {files}', ['src/a b.test.ts', 'src/$(touch pwned).test.ts', '-rf.test.ts'])
  assert.equal(cmd, `pnpm vitest run 'src/a b.test.ts' 'src/$(touch pwned).test.ts' './-rf.test.ts'`)
  const echoed = spawnSync('bash', ['-c', buildTestCommand('printf "%s\\n" {files}', ["a'b.ts", '$(id).ts', '`x`.ts'])], { encoding: 'utf8' })
  assert.equal(echoed.stdout, "a'b.ts\n$(id).ts\n`x`.ts\n")
  assert.equal(buildTestCommand('run {files} && also {files}', ['a.ts']), "run 'a.ts' && also 'a.ts'")
  assert.throws(() => buildTestCommand('pnpm vitest run', ['a.ts']), /must contain \{files\}/)
  assert.throws(() => buildTestCommand('x {files}', ['a\nb.test.ts']), /line break/)
  assert.throws(() => buildTestCommand('x {files}', ['a\rb.test.ts']), /line break/)
})

test('classifyRun: only exit 1-125 is a test failure; timeouts, signals and missing commands are errors', () => {
  assert.equal(classifyRun({ code: 0 }), 'pass')
  assert.equal(classifyRun({ code: 1 }), 'fail')
  assert.equal(classifyRun({ code: 2 }), 'fail')
  assert.equal(classifyRun({ code: 0, timedOut: true }), 'error')
  assert.equal(classifyRun({ code: null, signal: 'SIGKILL' }), 'error')
  assert.equal(classifyRun({ code: 127 }), 'error')
  assert.equal(classifyRun({ code: 126 }), 'error')
  assert.equal(classifyRun({ code: 137 }), 'error')
  assert.equal(classifyRun({ code: null }), 'error')
  assert.equal(classifyRun({ code: 1, spawnError: new Error('ENOENT') }), 'error')
})

test('computeVerdict covers every pair of runs', () => {
  const t = ['a.test.ts']
  assert.equal(computeVerdict({ tests: [], head: 'pass', base: 'fail' }), 'no_test')
  assert.equal(computeVerdict({ tests: t, head: 'pass', base: 'fail' }), 'fail_to_pass')
  assert.equal(computeVerdict({ tests: t, head: 'pass', base: 'pass' }), 'passes_without_fix')
  assert.equal(computeVerdict({ tests: t, head: 'fail', base: 'skipped' }), 'fails_with_fix')
  assert.equal(computeVerdict({ tests: t, head: 'error', base: 'skipped' }), 'error')
  assert.equal(computeVerdict({ tests: t, head: 'pass', base: 'error' }), 'error')
  assert.equal(computeVerdict({ tests: t, head: 'pass', base: 'skipped' }), 'error')
  assert.equal(conclusionFor('fail_to_pass'), 'success')
  for (const v of ['no_test', 'passes_without_fix', 'fails_with_fix', 'error']) assert.equal(conclusionFor(v), 'failure')
})

test('redactSecrets masks token shapes; tailText keeps the last 4000 characters', () => {
  const log = [
    'token ' + 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123', // built from parts, like the AWS key below
    'key ' + 'sk-' + 'ant-api03-abcdefghijklmnopqrstuv',
    'mushi_' + '0123456789abcdef'.repeat(2),
    'Authorization: Bearer abc.def.ghi',
    'AKIA' + 'ABCDEFGHIJKLMNOP', // built so the repo's secret scan does not read the fake key
    'ok line',
  ].join('\n')
  const out = redactSecrets(log)
  assert.doesNotMatch(out, /ghp_abc|sk-ant-api03-abc|mushi_0123|abc\.def\.ghi|AKIAABCD/)
  assert.match(out, /Authorization: Bearer \*\*\*/)
  assert.match(out, /ok line/)

  const long = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n')
  const tail = tailText(long)
  assert.ok(tail.length <= LOG_TAIL_MAX)
  assert.ok(tail.endsWith('line 1999'))
  assert.equal(tailText('short'), 'short')
})

test('testEnv strips the tokens a test never needs', () => {
  const env = testEnv({ GITHUB_TOKEN: 'x', INPUT_GITHUB_TOKEN: 'y', ACTIONS_RUNTIME_TOKEN: 'z', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'w', PATH: '/bin' })
  assert.deepEqual(env, { PATH: '/bin', CI: 'true' })
})

test('buildResult and checkRunPayload follow the Plan 024 contract', () => {
  const result = buildResult({
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    tests: ['src/sum.test.ts'],
    head: 'pass',
    base: 'fail',
    verdict: 'fail_to_pass',
    command: 'pnpm vitest run {files}',
    runner: 'alienware-glot-1',
    durationS: 41.6,
    log: 'x'.repeat(10_000),
  })
  assert.deepEqual(Object.keys(result), ['schema', 'head_sha', 'base_sha', 'tests', 'head', 'base', 'verdict', 'command', 'runner', 'duration_s', 'log_tail'])
  assert.equal(result.schema, 1)
  assert.equal(result.duration_s, 42)
  assert.ok(result.log_tail.length <= LOG_TAIL_MAX)

  const payload = checkRunPayload(result, { startedAt: '2026-10-21T00:00:00Z', completedAt: '2026-10-21T00:01:00Z' })
  assert.equal(payload.name, CHECK_NAME)
  assert.equal(payload.name, 'Mushi verify')
  assert.equal(payload.head_sha, 'a'.repeat(40))
  assert.equal(payload.status, 'completed')
  assert.equal(payload.conclusion, 'success')
  assert.deepEqual(JSON.parse(payload.output.text), result)
  assert.match(payload.output.title, /fails without the fix and passes with it/)
  assert.match(payload.output.summary, /\| Tests \| `src\/sum.test.ts` \|/)
  assert.match(payload.output.summary, /\| Runner \| alienware-glot-1 \|/)

  const none = checkRunPayload(buildResult({ headSha: 'c', tests: [], head: 'error', base: 'skipped', verdict: 'no_test', command: 'x {files}', runner: '' }))
  assert.equal(none.conclusion, 'failure')
  assert.equal(JSON.parse(none.output.text).runner, 'unknown')
  assert.equal(JSON.parse(none.output.text).base_sha, null)
  assert.match(renderSummary(JSON.parse(none.output.text)), /No test was added or changed/)
})

test('parseArgs reads inputs from the environment, flags override', () => {
  const opts = parseArgs(['--dry-run', '--base-ref', 'main'], { INPUT_TEST_COMMAND: 'pytest {files}', INPUT_TIMEOUT_MINUTES: 'x' })
  assert.deepEqual(opts, { testCommand: 'pytest {files}', testGlobs: '', baseRef: 'main', timeoutMinutes: 8, dryRun: true })
  assert.throws(() => parseArgs(['--nope'], {}), /unknown option/)
})
