import { describe, expect, it } from 'vitest'
import { runOneFix, type ExecOptions, type ExecResult, type ReportBody, type ServeDeps, type ServeOptions } from './serve.js'
import type { ClaimedAttempt } from './plan.js'

const ATTEMPT: ClaimedAttempt = {
  id: '3000000a-0000-4000-8000-000000000000',
  projectId: '1000000a-0000-4000-8000-000000000000',
  reportId: '2000000a-0000-4000-8000-000000000000',
  repoUrl: 'https://github.com/kensaurus/glot.it',
  baseBranch: 'main',
  branchName: 'bugfix/MUSHI-2000000a-0000-4000-8000-000000000000-local-3000000a',
}
const SCRATCH = '/tmp/mushi-agent-test'
const WT = `${SCRATCH}/worktree`
const PR = 'https://github.com/kensaurus/glot.it/pull/42'

type Responder = (argv: string[], opts: ExecOptions) => Partial<ExecResult> | undefined

function harness(over: { attempt?: ClaimedAttempt | null; respond?: Responder; files?: Record<string, string>; existing?: string[] } = {}) {
  const calls: Array<{ argv: string[]; cwd: string; env?: Record<string, string>; stdin?: string }> = []
  const reports: Array<{ id: string; body: ReportBody }> = []
  const written: Record<string, string> = {}
  const removed: string[] = []
  const links: Array<[string, string]> = []
  const files = over.files ?? {}
  const existing = new Set(over.existing ?? [])
  const deps: ServeDeps = {
    claim: async () => ({ attempt: over.attempt === undefined ? ATTEMPT : over.attempt, context: { summary: 'Cart total shows NaN', fix_prompt: 'Fix the cart.' } }),
    report: async (id, body) => {
      reports.push({ id, body })
      return { ok: true }
    },
    exec: async (argv, opts) => {
      calls.push({ argv, cwd: opts.cwd, env: opts.env, stdin: opts.stdin })
      const custom = over.respond?.(argv, opts)
      if (custom) return { code: 0, stdout: '', stderr: '', ...custom }
      const cmd = argv.slice(0, 3).join(' ')
      if (cmd === 'git remote get-url') return { code: 0, stdout: 'git@github.com:kensaurus/glot.it.git\n', stderr: '' }
      if (cmd === 'git status --porcelain') return { code: 0, stdout: ' M src/cart.ts\n', stderr: '' }
      if (cmd === 'git rev-list --count') return { code: 0, stdout: '1\n', stderr: '' }
      if (argv[0] === 'claude') return { code: 0, stdout: JSON.stringify({ result: 'Rounded the total.' }), stderr: '' }
      if (argv[0] === 'gh') return { code: 0, stdout: `${PR}\n`, stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    },
    makeScratchDir: () => SCRATCH,
    writeFile: (path, content) => { written[path] = content },
    readFile: (path) => files[path] ?? null,
    exists: (path) => existing.has(path),
    symlink: (target, path) => { links.push([target, path]) },
    removeDir: (path) => { removed.push(path) },
    log: () => {},
  }
  const opts: ServeOptions = {
    repoDir: '/home/me/glot.it',
    agent: 'claude',
    model: 'qwen3-coder:30b',
    agentTimeoutMs: 30 * 60_000,
    testTimeoutMs: 10 * 60_000,
    renewEveryMs: 60 * 60_000,
    env: { ANTHROPIC_BASE_URL: 'http://localhost:11434' },
  }
  return { deps, opts, calls, reports, written, removed, links }
}

const argvs = (h: ReturnType<typeof harness>) => h.calls.map((c) => c.argv.join(' '))

describe('runOneFix', () => {
  it('does nothing when no fix waits', async () => {
    const h = harness({ attempt: null })
    expect(await runOneFix(h.deps, h.opts)).toEqual({ outcome: 'none' })
    expect(h.calls).toEqual([])
  })

  it('worktree → agent → commit → tests → push → draft PR → report, then cleans up', async () => {
    const h = harness({
      files: { [`${WT}/package.json`]: '{"scripts":{"test":"vitest run"}}' },
      existing: [`${WT}/pnpm-lock.yaml`, '/home/me/glot.it/node_modules'],
    })
    const res = await runOneFix(h.deps, h.opts)
    expect(res).toEqual({ outcome: 'completed', attemptId: ATTEMPT.id, prUrl: PR })
    expect(argvs(h)).toEqual([
      'git remote get-url origin',
      'git fetch origin main',
      `git worktree add -B ${ATTEMPT.branchName} ${WT} origin/main`,
      `claude -p --output-format json --settings ${SCRATCH}/claude-settings.json --permission-mode acceptEdits --model qwen3-coder:30b`,
      'git status --porcelain',
      'git add -A',
      `git commit -m fix: Cart total shows NaN (MUSHI-2000000a) -m Mushi report ${ATTEMPT.reportId} (local fix agent: claude).`,
      'git rev-list --count origin/main..HEAD',
      'pnpm test',
      `git push -u origin HEAD:refs/heads/${ATTEMPT.branchName}`,
      `gh pr create --draft --repo kensaurus/glot.it --base main --head ${ATTEMPT.branchName} --title fix: Cart total shows NaN (MUSHI-2000000a) --body-file ${SCRATCH}/pr-body.md`,
      `git worktree remove --force ${WT}`,
    ])
    // The agent runs in the worktree with the offline env and the prompt on stdin.
    const agent = h.calls[3]!
    expect(agent.cwd).toBe(WT)
    expect(agent.env).toMatchObject({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ANTHROPIC_BASE_URL: 'http://localhost:11434' })
    expect(agent.stdin).toContain('<mushi-report>\nFix the cart.\n</mushi-report>')
    expect(JSON.parse(h.written[`${SCRATCH}/claude-settings.json`]!)).toMatchObject({ skipWebFetchPreflight: true })
    expect(h.links).toEqual([['/home/me/glot.it/node_modules', `${WT}/node_modules`]])
    expect(h.written[`${SCRATCH}/pr-body.md`]).toContain("Passed: `pnpm test` (with the checkout's node_modules)")
    expect(h.reports).toEqual([{ id: ATTEMPT.id, body: { status: 'completed', prUrl: PR, branch: ATTEMPT.branchName, summary: 'Rounded the total.' } }])
    expect(h.removed).toEqual([SCRATCH])
  })

  it('reports completed without a PR when the agent changed nothing', async () => {
    const h = harness({
      respond: (argv) =>
        argv[1] === 'status' ? { stdout: '' } : argv[1] === 'rev-list' ? { stdout: '0\n' } : argv[0] === 'claude' ? { stdout: JSON.stringify({ result: 'Already fixed on main.' }) } : undefined,
    })
    expect(await runOneFix(h.deps, h.opts)).toMatchObject({ outcome: 'no_change' })
    expect(argvs(h).some((a) => a.startsWith('git push') || a.startsWith('gh '))).toBe(false)
    expect(h.reports[0]!.body).toEqual({ status: 'completed', branch: ATTEMPT.branchName, summary: 'Already fixed on main.' })
  })

  it('reports failed with the reason when the agent fails, and still cleans up', async () => {
    const h = harness({ respond: (argv) => (argv[0] === 'claude' ? { code: 1, stderr: 'model not found' } : undefined) })
    const res = await runOneFix(h.deps, h.opts)
    expect(res).toMatchObject({ outcome: 'failed' })
    expect(h.reports[0]!.body).toMatchObject({ status: 'failed', error: 'claude exited 1: model not found' })
    expect(argvs(h)).toContain(`git worktree remove --force ${WT}`)
    expect(h.removed).toEqual([SCRATCH])
  })

  it('refuses a checkout of another repo before touching it', async () => {
    const h = harness({ respond: (argv) => (argv[1] === 'remote' ? { stdout: 'https://github.com/someone/else.git\n' } : undefined) })
    const res = await runOneFix(h.deps, h.opts)
    expect(res).toMatchObject({ outcome: 'failed' })
    expect(h.reports[0]!.body).toMatchObject({ status: 'failed', error: expect.stringContaining('this fix is for kensaurus/glot.it') })
    expect(argvs(h)).toEqual(['git remote get-url origin'])
  })

  it('refuses an Ollama cloud model before the agent runs', async () => {
    const h = harness()
    const res = await runOneFix(h.deps, { ...h.opts, model: 'gpt-oss:120b-cloud' })
    expect(res).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('ollama.com') })
    expect(argvs(h).some((a) => a.startsWith('claude'))).toBe(false)
  })

  it('starts from the local base branch when fetch fails, and says gh failed with the branch pushed', async () => {
    const h = harness({
      respond: (argv) => (argv[1] === 'fetch' ? { code: 1, stderr: 'no network' } : argv[0] === 'gh' ? { code: 1, stderr: 'not logged in' } : undefined),
    })
    const res = await runOneFix(h.deps, h.opts)
    expect(argvs(h)).toContain(`git worktree add -B ${ATTEMPT.branchName} ${WT} main`)
    expect(res).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('gh pr create failed (the branch') })
  })

  it('aider: Mushi commits the change and the prompt goes in a file', async () => {
    const h = harness()
    await runOneFix(h.deps, { ...h.opts, agent: 'aider' })
    expect(argvs(h)).toContain(`aider --model ollama_chat/qwen3-coder:30b --yes-always --no-auto-commits --no-dirty-commits --no-check-update --analytics-disable --no-show-release-notes --no-pretty --message-file ${SCRATCH}/prompt.md`)
    expect(h.written[`${SCRATCH}/prompt.md`]).toContain('<mushi-report>')
    expect(argvs(h)).toContain('git add -A')
  })
})
