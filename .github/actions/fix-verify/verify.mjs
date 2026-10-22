#!/usr/bin/env node
/**
 * FILE: .github/actions/fix-verify/verify.mjs
 * PURPOSE: The fail-to-pass proof behind the "Mushi verify" check (Plan 024,
 *          ADR 0035). Runs in a HOST repo, on an agent's pull request:
 *
 *   1. base = merge-base of the base ref and HEAD (checkout needs fetch-depth: 0);
 *   2. the PR's changes: `git diff --name-status --no-renames -z base HEAD`;
 *   3. the tests to run: test files the PR added or modified (none → no_test);
 *   4. run the test command on HEAD: the tests must pass (else fails_with_fix);
 *   5. put the PR's non-test files back to base (`git checkout <base> -- …`,
 *      and remove the non-test files the PR added), keep the head's tests,
 *      run again: the tests must fail (else passes_without_fix);
 *   6. restore HEAD, then post the result as a check run named exactly
 *      "Mushi verify" on the PR head SHA, conclusion success only for
 *      fail_to_pass, with the JSON contract of Plan 024 in output.text.
 *
 * Plain Node ≥ 20, no dependencies. The pure parts are exported for
 * verify.test.mjs; main() runs only when this file is executed.
 *
 * Local dry run (prints the JSON, posts nothing):
 *   node verify.mjs --dry-run --test-command "npx vitest run {files}" --base-ref main
 */

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

export const CHECK_NAME = 'Mushi verify'
export const LOG_TAIL_MAX = 4000
export const DEFAULT_RUN_TIMEOUT_MINUTES = 8

// ─── Test detection ──────────────────────────────────────────────────────────

/** Directory names whose files count as tests (Plan 024 `isTestPath`). */
const TEST_DIRS = new Set(['__tests__', 'test', 'tests', 'e2e'])

/**
 * Plan 024's `isTestPath`: `__tests__/`, `*.test.*`, `*.spec.*`, `test/`,
 * `tests/`, `e2e/`, `*_test.go`, `test_*.py`, `*_test.py`, `*Test.java`,
 * `*Tests.swift`. The server uses the same rules for the protected-paths gate.
 */
export function isTestPath(path) {
  const parts = String(path).split('/')
  const base = parts[parts.length - 1] ?? ''
  if (parts.slice(0, -1).some((d) => TEST_DIRS.has(d))) return true
  if (/\.(test|spec)\.[^/]+$/.test(base)) return true
  if (/_test\.go$/.test(base)) return true
  if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base)) return true
  if (/Test\.java$/.test(base)) return true
  if (/Tests\.swift$/.test(base)) return true
  return false
}

const CODE_EXT = /\.(?:[cm]?[jt]sx?|py|go|java|kt|kts|swift|rb|rs|php|cs|dart|ex|exs|scala|vue|svelte)$/
const NOT_RUNNABLE_DIRS = new Set(['__snapshots__', 'fixtures', '__fixtures__', '__mocks__'])
const NOT_RUNNABLE_NAMES = new Set(['conftest.py', '__init__.py'])

/**
 * A test file worth passing to the test command: a test path that is source
 * code, not a snapshot, fixture, mock or a pytest conftest.
 */
export function isRunnableTest(path) {
  if (!isTestPath(path)) return false
  const parts = String(path).split('/')
  const base = parts[parts.length - 1] ?? ''
  if (!CODE_EXT.test(base)) return false
  if (/\.d\.[cm]?ts$/.test(base)) return false
  if (NOT_RUNNABLE_NAMES.has(base)) return false
  if (parts.slice(0, -1).some((d) => NOT_RUNNABLE_DIRS.has(d))) return false
  return true
}

/** `test-globs` input: a comma (or newline) separated list. */
export function parseGlobs(input) {
  return String(input ?? '')
    .split(/[,\n]/)
    .map((g) => g.trim())
    .filter(Boolean)
}

/**
 * A glob as a RegExp over repo-relative paths: `**` any depth, `*` and `?`
 * within one segment, `{a,b}` alternatives. A glob without `/` matches the
 * file name at any depth (`*.test.ts`), as in .gitignore.
 */
export function globToRegExp(glob) {
  let g = String(glob).trim().replace(/^\.\//, '')
  const anyDepth = !g.includes('/')
  let re = ''
  let braces = 0
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++
        if (g[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      braces++
      re += '(?:'
    } else if (c === '}' && braces > 0) {
      braces--
      re += ')'
    } else if (c === ',' && braces > 0) re += '|'
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(anyDepth ? `(?:^|/)${re}$` : `^${re}$`)
}

export function matchesAnyGlob(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path))
}

// ─── Changed files ───────────────────────────────────────────────────────────

/**
 * Parse `git diff --name-status --no-renames -z` output:
 * `M\0path\0A\0path\0…` → [{ status: 'M', path }]. Renames and copies are not
 * expected (--no-renames), but are read as their new path.
 */
export function parseNameStatusZ(text) {
  const tokens = String(text).split('\0')
  if (tokens[tokens.length - 1] === '') tokens.pop()
  const out = []
  for (let i = 0; i < tokens.length; ) {
    const raw = tokens[i++]
    const status = raw.charAt(0)
    if (!status) continue
    if (status === 'R' || status === 'C') {
      const from = tokens[i++]
      const to = tokens[i++]
      if (from !== undefined) out.push({ status: 'D', path: from })
      if (to !== undefined) out.push({ status: 'A', path: to })
      continue
    }
    const path = tokens[i++]
    if (path !== undefined) out.push({ status, path })
  }
  return out
}

/**
 * Split the PR's changes:
 *   tests   added or modified test files to run (`test-globs` overrides detection);
 *   restore  non-test files that exist on base (modified, deleted, type-changed),
 *            checked out from base for the second run;
 *   baseOnly the restored files the PR deleted (not in HEAD), removed again after;
 *   remove   non-test files the PR added, deleted for the second run.
 * A file counts as a test (kept at head) when isTestPath says so or a glob matches.
 */
export function planChanges(changes, globs = []) {
  const tests = []
  const restore = []
  const baseOnly = []
  const remove = []
  for (const { status, path } of changes) {
    const globHit = globs.length > 0 && matchesAnyGlob(path, globs)
    const keepAtHead = isTestPath(path) || globHit
    if (keepAtHead) {
      if (status === 'A' || status === 'M' || status === 'T') {
        if (globs.length > 0 ? globHit : isRunnableTest(path)) tests.push(path)
      }
      continue
    }
    if (status === 'A') remove.push(path)
    else {
      restore.push(path)
      if (status === 'D') baseOnly.push(path)
    }
  }
  return { tests: [...new Set(tests)].sort(), restore, baseOnly, remove }
}

// ─── {files} substitution ────────────────────────────────────────────────────

/** POSIX single-quote one argument. */
export function shellQuote(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`
}

export class UnsafePathError extends Error {}

/**
 * The test command with `{files}` replaced by the quoted test paths. Refuses
 * paths with a newline or NUL, and prefixes a path starting with `-` with
 * `./` so no test runner reads it as a flag.
 */
export function buildTestCommand(template, files) {
  const t = String(template ?? '')
  if (!t.includes('{files}')) throw new UnsafePathError('test-command must contain {files}')
  const quoted = files.map((f) => {
    if (/[\n\r\0]/.test(f)) throw new UnsafePathError(`refusing a test path with a line break: ${JSON.stringify(f)}`)
    return shellQuote(f.startsWith('-') ? `./${f}` : f)
  })
  return t.split('{files}').join(quoted.join(' '))
}

// ─── Run outcome and verdict ─────────────────────────────────────────────────

/**
 * One test run as pass / fail / error. Exit 0 passes. A timeout, a signal,
 * a spawn error, "command not found" (127), "not executable" (126) or a
 * shell-reported signal (≥ 128, e.g. 137 for an OOM kill) is an error:
 * the run says nothing about the fix. Any other non-zero exit is a test failure
 * (vitest/jest 1, pytest 1 or 2 for a collection error, go test 1).
 */
export function classifyRun({ code, signal, timedOut, spawnError }) {
  if (timedOut || spawnError || signal) return 'error'
  if (code === 0) return 'pass'
  if (typeof code !== 'number' || code === 126 || code === 127 || code >= 128 || code < 0) return 'error'
  return 'fail'
}

/**
 * The verdict of Plan 024's contract from the two runs.
 * head: pass | fail | error; base: pass | fail | error | skipped.
 */
export function computeVerdict({ tests, head, base }) {
  if (!tests || tests.length === 0) return 'no_test'
  if (head === 'error') return 'error'
  if (head === 'fail') return 'fails_with_fix'
  if (head !== 'pass') return 'error'
  if (base === 'fail') return 'fail_to_pass'
  if (base === 'pass') return 'passes_without_fix'
  return 'error'
}

export function conclusionFor(verdict) {
  return verdict === 'fail_to_pass' ? 'success' : 'failure'
}

const TITLES = {
  fail_to_pass: 'The new test fails without the fix and passes with it',
  no_test: 'No test was added or changed',
  passes_without_fix: 'The tests pass even without the fix',
  fails_with_fix: 'The tests fail with the fix',
  error: 'The tests could not run',
}

const NEXT_STEP = {
  fail_to_pass: 'This is the proof Mushi needs before it merges on its own.',
  no_test: 'Add a test that reproduces the bug, so it fails before the fix and passes after it.',
  passes_without_fix: 'The tests do not reproduce the bug. Add a test that fails on the code before this fix.',
  fails_with_fix: 'The fix does not make its own tests pass. Fix the code or the test.',
  error: 'The test command did not finish normally. Read the log below, then check the command and the runner.',
}

export function titleFor(verdict) {
  return TITLES[verdict] ?? TITLES.error
}

// ─── Output ──────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bmushi_[0-9a-f]{32}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /(authorization:\s*(?:bearer|token|basic)\s+)[^\s'"]+/gi,
]

/**
 * Mask token-shaped strings before a log leaves the runner: GitHub masks
 * secrets in job logs, not in a check run's text, which anyone who can read
 * the repo can see.
 */
export function redactSecrets(text) {
  let out = String(text ?? '')
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, prefix) => (typeof prefix === 'string' && m.startsWith(prefix) ? `${prefix}***` : '***'))
  }
  return out
}

/** The last `max` characters, cut at a line start when one is near. */
export function tailText(text, max = LOG_TAIL_MAX) {
  const s = String(text ?? '')
  if (s.length <= max) return s
  const cut = s.slice(s.length - max + 2)
  const nl = cut.indexOf('\n')
  const body = nl >= 0 && nl < 200 ? cut.slice(nl + 1) : cut
  return `…\n${body}`.slice(-max)
}

/** The check-run JSON (Plan 024 contract, schema 1). */
export function buildResult({ headSha, baseSha, tests, head, base, verdict, command, runner, durationS, log }) {
  return {
    schema: 1,
    head_sha: headSha,
    base_sha: baseSha ?? null,
    tests,
    head,
    base,
    verdict,
    command,
    runner: runner || 'unknown',
    duration_s: Math.max(0, Math.round(durationS ?? 0)),
    log_tail: tailText(redactSecrets(log ?? '')),
  }
}

const short = (sha) => (sha ? String(sha).slice(0, 7) : '—')
// Backslashes first, so an escape in the input cannot undo ours.
const mdCell = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

const RUN_WORDS = { pass: 'passed', fail: 'failed', error: 'error', skipped: 'not run' }

/** A short human table for output.summary and $GITHUB_STEP_SUMMARY. */
export function renderSummary(result, note = '') {
  const tests = result.tests.length ? result.tests.map((t) => `\`${mdCell(t)}\``).join(', ') : 'none'
  const lines = [
    `**${titleFor(result.verdict)}**`,
    '',
    '| Step | Result |',
    '| --- | --- |',
    `| Tests | ${tests} |`,
    `| With the fix (${short(result.head_sha)}) | ${RUN_WORDS[result.head] ?? result.head} |`,
    `| Without the fix (${short(result.base_sha)}) | ${RUN_WORDS[result.base] ?? result.base} |`,
    `| Verdict | \`${result.verdict}\` |`,
    `| Runner | ${mdCell(result.runner)} |`,
    `| Time | ${result.duration_s} s |`,
    '',
    NEXT_STEP[result.verdict] ?? NEXT_STEP.error,
  ]
  if (note) lines.push('', mdCell(note))
  return lines.join('\n')
}

/** The body of POST /repos/{owner}/{repo}/check-runs. */
export function checkRunPayload(result, { startedAt, completedAt, note } = {}) {
  return {
    name: CHECK_NAME,
    head_sha: result.head_sha,
    status: 'completed',
    conclusion: conclusionFor(result.verdict),
    ...(startedAt ? { started_at: startedAt } : {}),
    completed_at: completedAt ?? new Date().toISOString(),
    output: {
      title: titleFor(result.verdict),
      summary: renderSummary(result, note),
      text: JSON.stringify(result, null, 2),
    },
  }
}

// ─── Options ─────────────────────────────────────────────────────────────────

export function parseArgs(argv, env = {}) {
  const opts = {
    testCommand: env.INPUT_TEST_COMMAND ?? '',
    testGlobs: env.INPUT_TEST_GLOBS ?? '',
    baseRef: env.INPUT_BASE_REF ?? '',
    timeoutMinutes: Number(env.INPUT_TIMEOUT_MINUTES || DEFAULT_RUN_TIMEOUT_MINUTES),
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--test-command') opts.testCommand = next()
    else if (a === '--test-globs') opts.testGlobs = next()
    else if (a === '--base-ref') opts.baseRef = next()
    else if (a === '--timeout-minutes') opts.timeoutMinutes = Number(next())
    else throw new Error(`unknown option ${a}`)
  }
  if (!Number.isFinite(opts.timeoutMinutes) || opts.timeoutMinutes <= 0) opts.timeoutMinutes = DEFAULT_RUN_TIMEOUT_MINUTES
  return opts
}

/** Tokens a test never needs; a test that prints its environment must not leak them. */
const STRIPPED_ENV = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'INPUT_GITHUB_TOKEN',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
]

export function testEnv(env) {
  const out = { ...env, CI: env.CI ?? 'true' }
  for (const k of STRIPPED_ENV) delete out[k]
  return out
}

// ─── Side effects (not unit-tested; exercised by the dry run) ────────────────

function git(args, { input, allowFail = false } = {}) {
  const res = spawnSync('git', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })
  if (res.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${(res.stderr || res.stdout || '').trim().slice(0, 500)}`)
  }
  return res
}

function resolveCommit(ref) {
  const res = git(['rev-parse', '--verify', '-q', `${ref}^{commit}`], { allowFail: true })
  return res.status === 0 ? res.stdout.trim() : null
}

/** The base ref as a commit: local, origin/<ref>, then one fetch from origin. */
function resolveBase(ref) {
  const direct = resolveCommit(ref) ?? resolveCommit(`origin/${ref}`)
  if (direct) return direct
  const fetched = git(['fetch', '--no-tags', '-q', 'origin', ref], { allowFail: true })
  if (fetched.status === 0) return resolveCommit('FETCH_HEAD')
  return null
}

function runTests(command, timeoutMs, env, out) {
  return new Promise((resolve) => {
    const started = Date.now()
    let log = ''
    let timedOut = false
    let child
    try {
      child = spawn('bash', ['-c', command], { env: testEnv(env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ outcome: 'error', log: `could not start the test command: ${err.message}\n`, ms: 0 })
      return
    }
    const onData = (chunk) => {
      out.write(chunk)
      log += chunk.toString()
      if (log.length > 200_000) log = log.slice(-100_000)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    let spawnError = null
    child.on('error', (err) => {
      spawnError = err
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) log += `\n[mushi verify] stopped after ${Math.round(timeoutMs / 60000)} min\n`
      if (spawnError) log += `\n[mushi verify] ${spawnError.message}\n`
      resolve({ outcome: classifyRun({ code, signal, timedOut, spawnError }), log, ms: Date.now() - started })
    })
  })
}

function nulList(paths) {
  return paths.map((p) => `${p}\0`).join('')
}

/** Put the PR's non-test files back to base; the head's tests stay. */
function applyBase(baseSha, plan) {
  if (plan.restore.length > 0) {
    git(['checkout', '-q', '--pathspec-from-file=-', '--pathspec-file-nul', baseSha], { input: nulList(plan.restore) })
  }
  for (const p of plan.remove) rmSync(p, { force: true })
}

/** Back to HEAD: drop the files only base has, then check out every tracked file. */
function restoreHead(plan) {
  if (plan.baseOnly.length > 0) {
    git(['rm', '-q', '-f', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: nulList(plan.baseOnly), allowFail: true })
  }
  git(['checkout', '-q', 'HEAD', '--', '.'], { allowFail: true })
}

function readEvent(env) {
  if (!env.GITHUB_EVENT_PATH) return null
  try {
    return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  } catch {
    return null
  }
}

async function postCheckRun(payload, env) {
  const token = env.INPUT_GITHUB_TOKEN || env.GITHUB_TOKEN
  const repo = env.GITHUB_REPOSITORY
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required to post the check run')
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '')
  const res = await fetch(`${api}/repos/${repo}/check-runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mushi-fix-verify',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const hint = res.status === 403 ? ' The workflow needs `permissions: checks: write`; fork pull requests get a read-only token.' : ''
    throw new Error(`creating the check run failed: HTTP ${res.status} ${body.slice(0, 300)}${hint}`)
  }
  return res.json()
}

function setOutput(env, name, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv, env)
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const event = readEvent(env)
  const eventHead = event?.pull_request?.head?.sha ?? null
  const localHead = git(['rev-parse', 'HEAD']).stdout.trim()
  const headSha = eventHead ?? localHead
  const baseRef = opts.baseRef || event?.pull_request?.base?.sha || env.GITHUB_BASE_REF || ''
  const runner = env.RUNNER_NAME || 'local'
  // A dry run keeps stdout for the JSON alone.
  const out = opts.dryRun ? process.stderr : process.stdout
  const say = (line) => out.write(`${line}\n`)

  let log = ''
  let tests = []
  let head = 'error'
  let base = 'skipped'
  let baseSha = null
  let note = ''
  /** 'no_test' or 'error' when the runs never decided it. */
  let forced = null

  const finish = () => {
    const verdict = forced ?? computeVerdict({ tests, head, base })
    return buildResult({ headSha, baseSha, tests, head, base, verdict, command: opts.testCommand, runner, durationS: (Date.now() - t0) / 1000, log })
  }

  try {
    if (eventHead && eventHead !== localHead) {
      throw new Error(`HEAD is ${short(localHead)}, not the PR head ${short(eventHead)}. Check out with ref: \${{ github.event.pull_request.head.sha }} (a pull_request checkout is a merge commit by default).`)
    }
    if (!opts.testCommand.includes('{files}')) throw new Error('test-command must contain {files}')
    if (!baseRef) throw new Error('No base ref: pass base-ref, or run on a pull_request event.')
    const baseTip = resolveBase(baseRef)
    if (!baseTip) throw new Error(`Base ref ${baseRef} is not in this checkout. Check out with fetch-depth: 0.`)
    const mb = git(['merge-base', baseTip, 'HEAD'], { allowFail: true })
    if (mb.status !== 0) throw new Error('No merge base between the base ref and HEAD. Check out with fetch-depth: 0.')
    baseSha = mb.stdout.trim()

    const diff = git(['-c', 'core.quotepath=off', 'diff', '--name-status', '--no-renames', '-z', baseSha, 'HEAD']).stdout
    const plan = planChanges(parseNameStatusZ(diff), parseGlobs(opts.testGlobs))
    tests = plan.tests
    if (tests.length === 0) {
      // Nothing ran. The contract's head field has no "skipped", so it reads error.
      forced = 'no_test'
      note = 'Nothing ran: the PR adds or changes no test file.'
    } else {
      const command = buildTestCommand(opts.testCommand, tests)
      const timeoutMs = opts.timeoutMinutes * 60_000
      say(`::group::With the fix (${short(localHead)}): ${command}`)
      const h = await runTests(command, timeoutMs, env, out)
      say('::endgroup::')
      head = h.outcome
      log += `== with the fix (${short(localHead)}): ${head} ==\n${h.log}\n`
      if (head === 'pass') {
        try {
          applyBase(baseSha, plan)
          say(`::group::Without the fix (${short(baseSha)}): ${command}`)
          const b = await runTests(command, timeoutMs, env, out)
          say('::endgroup::')
          base = b.outcome
          log += `== without the fix (${short(baseSha)}): ${base} ==\n${b.log}\n`
        } finally {
          restoreHead(plan)
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    note = message
    log += `\n[mushi verify] ${message}\n`
    if (head === 'pass') base = 'error'
    forced = 'error'
    say(`::error::${message}`)
  }

  const result = finish()
  const payload = checkRunPayload(result, { startedAt, note })
  setOutput(env, 'verdict', result.verdict)
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `## ${CHECK_NAME}\n\n${payload.output.summary}\n`)
    } catch {
      /* a missing summary file never changes the verdict */
    }
  }

  if (opts.dryRun) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    try {
      const created = await postCheckRun(payload, env)
      console.log(`${CHECK_NAME}: ${result.verdict} — ${created?.html_url ?? 'check run created'}`)
    } catch (err) {
      console.log(`::error::${err instanceof Error ? err.message : String(err)}`)
      return 1
    }
  }
  if (result.verdict !== 'fail_to_pass') {
    console.error(`${CHECK_NAME}: ${titleFor(result.verdict)} (${result.verdict})`)
    return 1
  }
  return 0
}

function isMain() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isMain()) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`::error::${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    },
  )
}
