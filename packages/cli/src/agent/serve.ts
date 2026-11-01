/**
 * FILE: packages/cli/src/agent/serve.ts
 * PURPOSE: Runs one local fix end to end (Plan 023 Phase 3): claim → git
 *          worktree on a new branch → the agent, headless → commit → the
 *          repo's own tests (best effort) → push with the user's git
 *          credentials → `gh pr create --draft` → report → clean up.
 *          Every side effect goes through ServeDeps so tests drive it with a
 *          fake exec; agent/plan.ts builds the command lines.
 *
 *          What leaves the machine: the branch (pushed to the repo's own
 *          `origin`), the draft PR (through the user's `gh`), and the outcome
 *          (to the Mushi API). The repo contents go only where the chosen
 *          agent and model send them.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  agentSummary,
  buildAgentCommand,
  buildFixPrompt,
  detectTestCommand,
  pullRequestText,
  repoSlugOf,
  type ClaimedAttempt,
  type FixContext,
  type LocalAgentKind,
  type OssProvider,
} from './plan.js'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
  timedOut?: boolean
}

export interface ExecOptions {
  cwd: string
  env?: Record<string, string>
  stdin?: string
  timeoutMs: number
}

export type ReportBody =
  | { status: 'running'; branch?: string }
  | { status: 'completed'; prUrl?: string; branch?: string; summary?: string }
  | { status: 'failed'; error: string; branch?: string }

export interface ServeDeps {
  claim: () => Promise<{ attempt: ClaimedAttempt | null; context: FixContext | null }>
  report: (attemptId: string, body: ReportBody) => Promise<{ ok: boolean; message?: string }>
  exec: (argv: string[], opts: ExecOptions) => Promise<ExecResult>
  makeScratchDir: () => string
  writeFile: (path: string, content: string) => void
  readFile: (path: string) => string | null
  exists: (path: string) => boolean
  symlink: (target: string, path: string) => void
  removeDir: (path: string) => void
  log: (line: string) => void
}

export interface ServeOptions {
  repoDir: string
  agent: LocalAgentKind
  model?: string
  provider?: OssProvider
  agentTimeoutMs: number
  testTimeoutMs: number
  /** How often to renew the 30-minute lease while the agent works. */
  renewEveryMs: number
  env: Record<string, string | undefined>
}

export type FixRunOutcome =
  | { outcome: 'none' }
  | { outcome: 'completed'; attemptId: string; prUrl: string }
  | { outcome: 'no_change'; attemptId: string; summary: string }
  | { outcome: 'failed'; attemptId: string; reason: string }

const GIT_TIMEOUT_MS = 5 * 60_000

class StepError extends Error {}

function tail(text: string, n = 600): string {
  const t = text.trim()
  return t.length > n ? `…${t.slice(-n)}` : t
}

/** Claim one local fix and run it. `none` when nothing was waiting. */
export async function runOneFix(deps: ServeDeps, opts: ServeOptions): Promise<FixRunOutcome> {
  const { attempt, context } = await deps.claim()
  if (!attempt) return { outcome: 'none' }
  deps.log(`Claimed fix ${attempt.id} for report ${attempt.reportId} (branch ${attempt.branchName}).`)

  const scratch = deps.makeScratchDir()
  const worktree = join(scratch, 'worktree')
  let worktreeAdded = false
  const renew = setInterval(() => {
    void deps.report(attempt.id, { status: 'running', branch: attempt.branchName }).catch(() => undefined)
  }, opts.renewEveryMs)
  const git = async (args: string[], cwd = opts.repoDir, what = `git ${args[0]}`): Promise<ExecResult> => {
    const res = await deps.exec(['git', ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })
    if (res.code !== 0) throw new StepError(`${what} failed: ${tail(res.stderr || res.stdout)}`)
    return res
  }

  try {
    // The fix must land on the repo this checkout pushes to.
    const origin = (await git(['remote', 'get-url', 'origin'], opts.repoDir, 'reading the origin remote')).stdout.trim()
    const want = repoSlugOf(attempt.repoUrl)
    const have = repoSlugOf(origin)
    if (want && have !== want) {
      throw new StepError(`--repo-dir pushes to ${have ?? origin}, but this fix is for ${want}. Run agent serve in a checkout of ${want}.`)
    }

    const fetched = await deps.exec(['git', 'fetch', 'origin', attempt.baseBranch], { cwd: opts.repoDir, timeoutMs: GIT_TIMEOUT_MS })
    const baseRef = fetched.code === 0 ? `origin/${attempt.baseBranch}` : attempt.baseBranch
    if (fetched.code !== 0) deps.log(`Could not fetch origin/${attempt.baseBranch}; starting from the local ${attempt.baseBranch}.`)
    await git(['worktree', 'add', '-B', attempt.branchName, worktree, baseRef], opts.repoDir, 'creating the worktree')
    worktreeAdded = true

    const command = buildAgentCommand({
      agent: opts.agent,
      model: opts.model,
      provider: opts.provider,
      prompt: buildFixPrompt(attempt, context),
      scratchDir: scratch,
      env: opts.env,
    })
    for (const f of command.files) deps.writeFile(f.path, f.content)
    deps.log(`Running ${command.argv[0]} in ${worktree} …`)
    const run = await deps.exec(command.argv, { cwd: worktree, env: command.env, stdin: command.stdin, timeoutMs: opts.agentTimeoutMs })
    if (run.timedOut) throw new StepError(`${command.argv[0]} did not finish within ${Math.round(opts.agentTimeoutMs / 60_000)} min.`)
    if (run.code !== 0) throw new StepError(`${command.argv[0]} exited ${run.code}: ${tail(run.stderr || run.stdout)}`)
    const summary = agentSummary(opts.agent, run.stdout)

    const { title } = pullRequestText({ attempt, context, agent: opts.agent, model: opts.model, summary, tests: null })
    const dirty = (await git(['status', '--porcelain'], worktree)).stdout.trim()
    if (dirty) {
      await git(['add', '-A'], worktree)
      await git(['commit', '-m', title, '-m', `Mushi report ${attempt.reportId} (local fix agent: ${opts.agent}).`], worktree, 'committing the fix')
    }
    const ahead = Number((await git(['rev-list', '--count', `${baseRef}..HEAD`], worktree)).stdout.trim()) || 0
    if (ahead === 0) {
      deps.log('The agent changed nothing.')
      await deps.report(attempt.id, { status: 'completed', branch: attempt.branchName, summary: summary || 'The local agent made no change.' })
      return { outcome: 'no_change', attemptId: attempt.id, summary }
    }

    // The repo's own tests, best effort: they never block the PR, the PR says how they went.
    let tests: { command: string[]; passed: boolean; note: string } | null = null
    const testCmd = detectTestCommand(deps.readFile(join(worktree, 'package.json')), {
      pnpm: deps.exists(join(worktree, 'pnpm-lock.yaml')),
      yarn: deps.exists(join(worktree, 'yarn.lock')),
      bun: deps.exists(join(worktree, 'bun.lockb')) || deps.exists(join(worktree, 'bun.lock')),
    })
    if (testCmd) {
      let note = ''
      if (!deps.exists(join(worktree, 'node_modules')) && deps.exists(join(opts.repoDir, 'node_modules'))) {
        deps.symlink(join(opts.repoDir, 'node_modules'), join(worktree, 'node_modules'))
        note = "with the checkout's node_modules"
      }
      deps.log(`Running the repo's tests: ${testCmd.join(' ')}`)
      const t = await deps.exec(testCmd, { cwd: worktree, env: { CI: '1' }, timeoutMs: opts.testTimeoutMs })
      tests = { command: testCmd, passed: t.code === 0 && !t.timedOut, note: t.timedOut ? `stopped after ${Math.round(opts.testTimeoutMs / 60_000)} min` : note }
    }

    await git(['push', '-u', 'origin', `HEAD:refs/heads/${attempt.branchName}`], worktree, 'pushing the branch')
    const pr = pullRequestText({ attempt, context, agent: opts.agent, model: opts.model, summary, tests })
    const bodyPath = join(scratch, 'pr-body.md')
    deps.writeFile(bodyPath, pr.body)
    const created = await deps.exec(
      [
        'gh', 'pr', 'create', '--draft',
        ...(want ? ['--repo', want] : []),
        '--base', attempt.baseBranch,
        '--head', attempt.branchName,
        '--title', pr.title,
        '--body-file', bodyPath,
      ],
      { cwd: worktree, timeoutMs: GIT_TIMEOUT_MS },
    )
    const prUrl = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/.exec(created.stdout)?.[0]
    if (created.code !== 0 || !prUrl) {
      throw new StepError(`gh pr create failed (the branch ${attempt.branchName} is pushed): ${tail(created.stderr || created.stdout)}`)
    }
    const reported = await deps.report(attempt.id, { status: 'completed', prUrl, branch: attempt.branchName, summary })
    if (!reported.ok) deps.log(`Opened ${prUrl}, but Mushi did not record it: ${reported.message ?? 'unknown error'}`)
    else deps.log(`Opened draft PR ${prUrl}.`)
    return { outcome: 'completed', attemptId: attempt.id, prUrl }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    deps.log(`Fix ${attempt.id} failed: ${reason}`)
    await deps.report(attempt.id, { status: 'failed', error: reason.slice(0, 2000), branch: attempt.branchName }).catch(() => undefined)
    return { outcome: 'failed', attemptId: attempt.id, reason }
  } finally {
    clearInterval(renew)
    if (worktreeAdded) {
      await deps.exec(['git', 'worktree', 'remove', '--force', worktree], { cwd: opts.repoDir, timeoutMs: GIT_TIMEOUT_MS }).catch(() => undefined)
    }
    try {
      deps.removeDir(scratch)
    } catch {
      // A temp folder left behind is not worth failing over.
    }
  }
}

/** Real exec: argv only (no shell), output captured (capped), killed at the timeout. */
export function nodeExec(argv: string[], opts: ExecOptions): Promise<ExecResult> {
  return new Promise((done) => {
    const [cmd, ...args] = argv
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const cap = (s: string, chunk: Buffer) => (s.length > 2_000_000 ? s : s + chunk.toString('utf8'))
    let child
    try {
      child = spawn(cmd!, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      done({ code: 127, stdout: '', stderr: String(err) })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref()
    }, opts.timeoutMs)
    child.stdout.on('data', (c: Buffer) => { stdout = cap(stdout, c) })
    child.stderr.on('data', (c: Buffer) => { stderr = cap(stderr, c) })
    child.on('error', (err: Error) => {
      clearTimeout(timer)
      done({ code: 127, stdout, stderr: `${stderr}${err.message}` })
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      done({ code: code ?? 1, stdout, stderr, timedOut })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(opts.stdin ?? '')
  })
}

/** The file-system half of ServeDeps on this machine. */
export const nodeServeFs: Pick<ServeDeps, 'makeScratchDir' | 'writeFile' | 'readFile' | 'exists' | 'symlink' | 'removeDir'> = {
  makeScratchDir: () => mkdtempSync(join(tmpdir(), 'mushi-agent-')),
  writeFile: (path, content) => writeFileSync(path, content, { mode: 0o600 }),
  readFile: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
  exists: (path) => existsSync(path),
  symlink: (target, path) => symlinkSync(target, path, 'dir'),
  removeDir: (path) => rmSync(path, { recursive: true, force: true }),
}
