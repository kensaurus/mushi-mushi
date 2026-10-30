/**
 * FILE: packages/cli/src/commands/work-conflicts.test.ts
 * PURPOSE: `mushi work --conflicts` against a temp git repo: no conflicted
 *          rows, a clean merge that pushes, conflict markers left (no push),
 *          and a commit hook that fails (no push, hooks not skipped).
 *          HOME points at a temp directory so the conflict worktree is not
 *          created under the developer's real home.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { okReply, runCli, type RecordedCall } from '../test-harness.js'
import { registerWorkCommands } from './work.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const QUEUE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const PROJECT = '11111111-2222-4333-8444-555555555555'

const savedEnv = new Map<string, string | undefined>()
const cleanups: Array<() => void> = []

function remember(key: string, value: string) {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key])
  process.env[key] = value
}

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  savedEnv.clear()
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: process.env, encoding: 'utf8' }).trim()
}

function writeExe(path: string, source: string) {
  writeFileSync(path, source)
  chmodSync(path, 0o755)
}

/** A clone whose origin URL is GitHub and whose fetch/push go to a local bare repo. */
function conflictRepo(kind: 'clean' | 'markers'): { repo: string; bare: string; headSha: string; mainSha: string; hookLog: string; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'mushi-wc-home-'))
  remember('HOME', home)
  const repo = mkdtempSync(join(tmpdir(), 'mushi-wc-'))
  const bare = `${repo}-origin.git`
  const hookLog = `${repo}-hooks.log`
  const gitConfig = `${repo}-gitconfig`
  writeFileSync(gitConfig, '')
  remember('GIT_CONFIG_GLOBAL', gitConfig)
  remember('GIT_CONFIG_NOSYSTEM', '1')
  remember('GIT_AUTHOR_NAME', 'Mushi Test')
  remember('GIT_AUTHOR_EMAIL', 't@example.com')
  remember('GIT_COMMITTER_NAME', 'Mushi Test')
  remember('GIT_COMMITTER_EMAIL', 't@example.com')
  remember('GIT_TERMINAL_PROMPT', '0')
  execFileSync('git', ['init', '--bare', '-q', bare], { env: process.env })
  execFileSync('git', ['config', 'uploadpack.allowReachableSHA1InWant', 'true'], { cwd: bare, env: process.env })
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Mushi Test'])
  git(repo, ['config', 'user.email', 't@example.com'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  // The real remote is the local bare repo. A git wrapper reports the GitHub
  // URL `git remote get-url` would show, so fetch and push never leave the machine.
  git(repo, ['remote', 'add', 'origin', bare])
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  git(repo, ['add', 'a.txt'])
  git(repo, ['commit', '-q', '-m', 'base'])
  git(repo, ['push', '-q', 'origin', 'main'])
  git(repo, ['checkout', '-q', '-b', 'fix/pr'])
  if (kind === 'clean') writeFileSync(join(repo, 'b.txt'), 'from the PR\n')
  else writeFileSync(join(repo, 'a.txt'), 'one\nfrom the PR\nthree\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'pr'])
  const headSha = git(repo, ['rev-parse', 'HEAD'])
  git(repo, ['push', '-q', 'origin', 'fix/pr'])
  git(repo, ['checkout', '-q', 'main'])
  if (kind === 'clean') writeFileSync(join(repo, 'c.txt'), 'from main\n')
  else writeFileSync(join(repo, 'a.txt'), 'one\nfrom main\nthree\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'main'])
  const mainSha = git(repo, ['rev-parse', 'HEAD'])
  git(repo, ['push', '-q', 'origin', 'main'])
  git(repo, ['checkout', '-q', 'fix/pr'])
  const hooks = git(repo, ['rev-parse', '--git-path', 'hooks'])
  const hookDir = hooks.startsWith('/') ? hooks : join(repo, hooks)
  const failFlag = `${repo}-fail-hook`
  writeExe(join(hookDir, 'pre-commit'), `#!/bin/sh
printf '%s\\n' commit >> '${hookLog}'
if [ -f '${failFlag}' ]; then
  echo "pre-commit hook refused" >&2
  exit 1
fi
`)
  writeExe(join(hookDir, 'pre-push'), `#!/bin/sh
printf '%s\\n' push >> '${hookLog}'
exit 0
`)
  cleanups.push(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
    rmSync(bare, { recursive: true, force: true })
    rmSync(hookLog, { force: true })
    rmSync(gitConfig, { force: true })
    rmSync(failFlag, { force: true })
  })
  return { repo, bare, headSha, mainSha, hookLog, home }
}

function tip(bare: string, ref = 'refs/heads/fix/pr'): string {
  return execFileSync('git', ['--git-dir', bare, 'rev-parse', ref], { env: process.env, encoding: 'utf8' }).trim()
}

function hookText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function installFakes(pr: { headSha: string }): string {
  const bin = mkdtempSync(join(tmpdir(), 'mushi-wc-bin-'))
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  writeExe(join(bin, 'git'), `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
if (args[0] === 'remote' && args.includes('get-url')) {
  process.stdout.write('https://github.com/acme/app.git\\n')
  process.exit(0)
}
const r = spawnSync(process.env.REAL_GIT, args, { stdio: 'inherit' })
if (r.error) {
  process.stderr.write(String(r.error.message))
  process.exit(127)
}
process.exit(r.status === null ? 1 : r.status)
`)
  writeExe(join(bin, 'gh'), `#!/usr/bin/env node
const cmd = process.argv[2]
if (cmd === 'auth') process.exit(0)
if (cmd === 'pr') {
  process.stdout.write(process.env.GH_PR_JSON || '')
  process.exit(0)
}
process.stderr.write('unexpected gh ' + process.argv.slice(2).join(' '))
process.exit(1)
`)
  writeExe(join(bin, 'cursor-agent'), `#!/usr/bin/env node
if (process.argv[2] === 'status') {
  process.stdout.write('Logged in\\n')
  process.exit(0)
}
process.exit(0)
`)
  remember('REAL_GIT', realGit)
  remember('PATH', `${bin}${delimiter}${process.env.PATH ?? ''}`)
  remember('GH_PR_JSON', JSON.stringify({
    state: 'OPEN',
    headRefName: 'fix/pr',
    headRefOid: pr.headSha,
    baseRefName: 'main',
    isCrossRepository: false,
  }))
  cleanups.push(() => rmSync(bin, { recursive: true, force: true }))
  return bin
}

interface DoneBody {
  result: string
  headAfter: string | null
  detail: string
}

async function runConflicts(repo: string, conflicts: unknown[]): Promise<{ run: Awaited<ReturnType<typeof runCli>>; done: DoneBody | null }> {
  let done: DoneBody | null = null
  const run = await runCli(registerWorkCommands, ['work', '--conflicts', '--repo-dir', repo], (call: RecordedCall) => {
    if (call.path === `/v1/admin/projects/${PROJECT}/local-conflicts`) return okReply({ conflicts })
    if (call.method === 'POST' && call.path === `/v1/admin/merge-queue/${QUEUE}/local-conflict`) return okReply({ token: 'tok-1' })
    if (call.method === 'POST' && call.path.endsWith('/local-conflict/done')) {
      done = call.body as DoneBody
      return okReply({ state: done.result === 'pushed' ? 'waiting' : 'blocked' })
    }
    return okReply({})
  })
  return { run, done }
}

const conflictRow = (headSha: string) => ({
  queueId: QUEUE,
  repo: 'acme/app',
  prNumber: 7,
  headRef: 'fix/pr',
  headSha,
  prUrl: 'https://github.com/acme/app/pull/7',
  fixAttemptId: 'ffffffff-1111-4222-8333-444444444444',
})

describe('mushi work --conflicts', () => {
  it('does nothing when no conflicted pull request is waiting', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'mushi-wc-'))
    const gitConfig = `${repo}-gitconfig`
    writeFileSync(gitConfig, '')
    remember('GIT_CONFIG_GLOBAL', gitConfig)
    remember('GIT_CONFIG_NOSYSTEM', '1')
    git(repo, ['init', '-q', '-b', 'main'])
    git(repo, ['remote', 'add', 'origin', 'https://github.com/acme/app.git'])
    cleanups.push(() => {
      rmSync(repo, { recursive: true, force: true })
      rmSync(gitConfig, { force: true })
    })
    const { run, done } = await runConflicts(repo, [])
    expect(run.exitCode).toBe(0)
    expect(run.stdout).toContain('No pull request of this clone is waiting on a merge conflict.')
    expect(run.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET /v1/admin/projects/${PROJECT}/local-conflicts`])
    expect(done).toBeNull()
  })

  it('pushes a clean merge and runs the commit and push hooks', async () => {
    const realHome = homedir()
    const fx = conflictRepo('clean')
    installFakes(fx)
    const { run, done } = await runConflicts(fx.repo, [conflictRow(fx.headSha)])
    expect(run.exitCode, `${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`).toBe(0)
    expect(done?.result).toBe('pushed')
    expect(done?.headAfter).toMatch(/^[0-9a-f]{40}$/)
    expect(tip(fx.bare)).toBe(done?.headAfter)
    const parents = execFileSync('git', ['--git-dir', fx.bare, 'rev-list', '--parents', '-n', '1', 'refs/heads/fix/pr'], { env: process.env, encoding: 'utf8' }).trim().split(' ')
    expect(parents).toEqual([done?.headAfter, fx.headSha, fx.mainSha])
    expect(hookText(fx.hookLog)).toBe('commit\npush\n')
    const cacheName = basename(fx.repo)
    expect(existsSync(join(fx.home, '.cache', 'mushi', 'conflicts', cacheName))).toBe(true)
    expect(existsSync(join(realHome, '.cache', 'mushi', 'conflicts', cacheName))).toBe(false)
  }, 60_000)

  it('does not push when conflict markers are left', async () => {
    const fx = conflictRepo('markers')
    installFakes(fx)
    const { run, done } = await runConflicts(fx.repo, [conflictRow(fx.headSha)])
    expect(run.exitCode).toBe(1)
    expect(done?.result).toBe('refused')
    expect(done?.headAfter).toBeNull()
    expect(done?.detail).toContain('conflict markers')
    expect(tip(fx.bare)).toBe(fx.headSha)
    expect(hookText(fx.hookLog)).not.toContain('push')
  }, 60_000)

  it('does not push when a commit hook fails', async () => {
    const fx = conflictRepo('clean')
    writeFileSync(`${fx.repo}-fail-hook`, '1')
    installFakes(fx)
    const { run, done } = await runConflicts(fx.repo, [conflictRow(fx.headSha)])
    expect(run.exitCode).toBe(1)
    expect(done?.result).toBe('failed')
    expect(done?.headAfter).toBeNull()
    expect(done?.detail).toMatch(/hook|commit failed/i)
    expect(tip(fx.bare)).toBe(fx.headSha)
    expect(hookText(fx.hookLog)).toBe('commit\n')
  }, 60_000)
})
