#!/usr/bin/env node
/**
 * check-release-version.mjs
 *
 * Run the release workflow's version step against the current tree, then put
 * the tree back. Catches a release-only failure while it is still a PR.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-13, PR #380 passed every gate in ci.yml — build, typecheck, lint,
 * 85/85 test tasks, and all 35 `check:*` scripts — merged, deployed to seven
 * channels, and then the Release workflow died at `changeset version`:
 *
 *     Error: Function yaml.safeLoad is removed in js-yaml 4.
 *       at parse (read-yaml-file@1.1.0/index.js)
 *
 * Nothing in CI had ever executed `changeset version`. It runs only inside
 * release.yml, after the merge, so the first time anyone learned the release
 * was broken was after master had already shipped. This closes that gap: the
 * same command now runs on every PR that carries a changeset.
 *
 * SAFETY
 * ------
 * `changeset version` rewrites package.json files, CHANGELOGs, and consumes
 * .changeset/*.md. This script therefore refuses to run against a dirty tree,
 * and restores with `git checkout -- . && git clean -fd` afterwards. With a
 * clean precondition there is nothing to lose; with a dirty one it declines
 * rather than risk a developer's work.
 *
 * Usage: node scripts/check-release-version.mjs
 *        node scripts/check-release-version.mjs --skip-dirty   # warn, exit 0
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CI = process.env.CI === 'true' || process.env.CI === '1'
const skipDirty = process.argv.includes('--skip-dirty')

// Bounded: on 2026-10-07 this step sat for the job's whole 25 minutes on
// two CI runs before printing anything, so every call fails fast instead.
const GIT_TIMEOUT_MS = 60_000
const VERSION_TIMEOUT_MS = 5 * 60_000

// changesets captures the output of the git commands it runs, so GIT_TRACE
// goes to a file whose tail is printed when the step fails.
const GIT_TRACE_FILE = path.join(tmpdir(), `check-release-version-git-trace-${process.pid}.log`)

function printGitTrace() {
  if (!existsSync(GIT_TRACE_FILE)) return
  const lines = readFileSync(GIT_TRACE_FILE, 'utf8').trim().split('\n')
  console.error(`\n   Last git commands changesets ran (${lines.length} trace lines in total):`)
  console.error(lines.slice(-30).map((l) => `   ${l}`).join('\n'))
}

function runVersion() {
  return new Promise((resolve) => {
    const started = Date.now()
    const stamp = () => `[${((Date.now() - started) / 1000).toFixed(1)}s]`
    let stdout = ''
    let stderr = ''
    let error = null
    const child = spawn('pnpm', ['exec', 'changeset', 'version'], {
      cwd: ROOT,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: CI ? { ...process.env, GIT_TRACE: GIT_TRACE_FILE } : process.env,
    })
    const relay = (chunk, sink) => {
      const text = chunk.toString()
      for (const line of text.split('\n')) if (line.trim()) sink.write(`   ${stamp()} ${line}\n`)
      return text
    }
    child.stdout.on('data', (c) => { stdout += relay(c, process.stdout) })
    child.stderr.on('data', (c) => {
      stderr += relay(c, process.stderr)
    })
    const timer = setTimeout(() => {
      error = new Error(`timed out after ${VERSION_TIMEOUT_MS / 1000}s (the last lines above show where it stopped)`)
      child.kill('SIGKILL')
    }, VERSION_TIMEOUT_MS)
    child.on('error', (err) => { error = err })
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ status: error ? null : status, stdout, stderr, error })
    })
  })
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: GIT_TIMEOUT_MS }).trim()
}

// ── 1. Is there anything to version? ────────────────────────────────────────
const changesets = readdirSync(path.join(ROOT, '.changeset'))
  .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')

if (changesets.length === 0) {
  console.log('✓  check-release-version: no pending changesets — nothing to version.')
  process.exit(0)
}

// ── 2. Refuse to touch a dirty tree ─────────────────────────────────────────
console.error(`   ${changesets.length} pending changeset(s); checking the tree is clean…`)
const dirty = git(['status', '--porcelain'])
if (dirty) {
  const msg =
    'check-release-version needs a clean tree — it runs `changeset version` and then restores.'
  if (CI) {
    console.error(`✗  ${msg}\n\nUnexpected changes in CI:\n${dirty}`)
    process.exit(1)
  }
  if (skipDirty) {
    console.log(`⚠  ${msg} Skipping (--skip-dirty).`)
    process.exit(0)
  }
  console.error(`✗  ${msg}\n\nCommit or stash first, or pass --skip-dirty.\n\n${dirty}`)
  process.exit(1)
}

// ── 3. Run it, then always restore ──────────────────────────────────────────
console.log(`   Running \`changeset version\` against ${changesets.length} pending changeset(s)…`)
// Output streams as it arrives, stamped with seconds since start. On
// 2026-10-09 the step hit its 5-minute timeout twice on CI having printed
// nothing, and nothing could say where it stopped. No stdin, so a prompt can
// never wait for an answer. On CI, GIT_TRACE records every git command
// changesets runs (it deepens a shallow clone to find the commit that added a
// changeset); the tail is printed when the step fails.
const run = await runVersion()
if (run.error) console.error(`✗  \`changeset version\` did not finish: ${run.error.message}`)
if (run.error || run.status !== 0) printGitTrace()
rmSync(GIT_TRACE_FILE, { force: true })

let restoreError = null
try {
  git(['checkout', '--', '.'])
  git(['clean', '-fd'])
} catch (err) {
  restoreError = err
}

if (restoreError) {
  console.error('✗  FAILED TO RESTORE THE TREE after `changeset version`.')
  console.error('   Run: git checkout -- . && git clean -fd')
  console.error(String(restoreError))
  process.exit(1)
}

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`

if (run.status !== 0) {
  console.error('✗  `changeset version` failed — this would break the Release workflow.\n')
  console.error(output.trim().split('\n').slice(-25).join('\n'))
  console.error(
    '\n   This is the step that runs AFTER a merge, inside release.yml. A failure\n' +
      '   here means master would deploy and then fail to publish to npm.\n',
  )
  process.exit(1)
}

// Changesets reports resolution problems on stdout while still exiting 0.
if (/\berror\b/i.test(output) && !/0 errors/i.test(output)) {
  console.error('✗  `changeset version` exited 0 but reported an error:\n')
  console.error(output.trim().split('\n').slice(-25).join('\n'))
  process.exit(1)
}

const after = git(['status', '--porcelain'])
if (after) {
  console.error(`✗  tree not fully restored after the check:\n${after}`)
  process.exit(1)
}

console.log('✓  check-release-version: `changeset version` succeeds and the tree is restored.')
