import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentRun, agentUnavailable, claudeSignInState, isClaudeModel, parseLocalAgent } from './work-agents.js'
import { agentEnv, agentUnavailablePayload, branchNameFor, checkAgentSignIn, inLocalCooldown, stopLine, WORK_AGENT_KIND, WORK_INFRA_PREFIX, workOne } from './work.js'

const R1 = '11111111-1111-4111-8111-111111111111'
const proc = (p: Partial<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>) => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...p })

describe('local agents: one table maps each agent to its binary and argv', () => {
  it('cursor keeps the argv mushi work always ran, the prompt last', () => {
    expect(agentRun('cursor', { mode: 'edit', workspace: '/wt', model: 'gpt-5', prompt: 'P' })).toEqual({
      cmd: 'cursor-agent',
      args: ['-p', '--force', '--trust', '--output-format', 'text', '--workspace', '/wt', '--model', 'gpt-5', 'P'],
    })
    expect(agentRun('cursor', { mode: 'ask', workspace: '/wt', prompt: 'P' })).toEqual({
      cmd: 'cursor-agent',
      args: ['-p', '--mode', 'ask', '--trust', '--output-format', 'text', '--workspace', '/wt', 'P'],
    })
  })

  it('claude gets the prompt on stdin, never argv (Windows caps a command line near 32K; the prompt may be 40K)', () => {
    const prompt = 'x'.repeat(40_000)
    const edit = agentRun('claude', { mode: 'edit', workspace: '/wt', model: 'opus', prompt })
    expect(edit.cmd).toBe('claude')
    expect(edit.args).toEqual([
      '-p',
      '--output-format',
      'text',
      '--permission-mode',
      'bypassPermissions',
      '--strict-mcp-config',
      '--setting-sources',
      'project,local',
      '--no-session-persistence',
      '--model',
      'opus',
    ])
    expect(edit.input).toBe(prompt)
    expect(edit.args.join(' ').length).toBeLessThan(500)
  })

  it('claude in ask mode (the code-read audit) has read-only tools and refuses anything that would prompt', () => {
    const ask = agentRun('claude', { mode: 'ask', workspace: '/wt', prompt: 'P' })
    expect(ask.args).toEqual(expect.arrayContaining(['--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob', '--strict-mcp-config']))
    expect(ask.args).not.toContain('bypassPermissions')
    expect(ask.args).not.toContain('--model')
  })

  it('names the branch after the agent', () => {
    expect(branchNameFor(R1, 'bug', 'claude')).toBe(`bugfix/MUSHI-${R1}-local-claude`)
    expect(branchNameFor(R1, 'bug')).toBe(`bugfix/MUSHI-${R1}-local-cursor`)
  })

  it('records both agents as the same local fix kind, so cooldowns and the console read them alike', () => {
    expect(WORK_AGENT_KIND).toBe('mcp')
  })
})

describe('--agent', () => {
  it('defaults to cursor and takes claude in any case', () => {
    expect(parseLocalAgent(undefined)).toBe('cursor')
    expect(parseLocalAgent('cursor')).toBe('cursor')
    expect(parseLocalAgent('claude')).toBe('claude')
    expect(parseLocalAgent('Claude')).toBe('claude')
  })

  it('refuses anything else, naming the choices', () => {
    expect(() => parseLocalAgent('codex')).toThrow(/Unknown agent "codex"/)
    expect(() => parseLocalAgent('claude_code')).toThrow(/Unknown agent/)
  })
})

describe('the Claude Code sign-in check (claude auth status)', () => {
  it('reads loggedIn from the JSON it prints', () => {
    expect(claudeSignInState(proc({ stdout: '{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}\n' }))).toBe('signed_in')
    expect(claudeSignInState(proc({ code: 1, stdout: '{"loggedIn": false}' }))).toBe('signed_out')
  })

  it('tells a missing claude apart, and never calls a timeout signed out', () => {
    expect(claudeSignInState(proc({ code: null, stderr: 'spawn claude ENOENT' }))).toBe('missing')
    expect(claudeSignInState(proc({ code: null, timedOut: true }))).toBe('unknown')
    expect(claudeSignInState(proc({ code: 1, stdout: 'segfault' }))).toBe('unknown')
  })

  it('checkAgentSignIn runs the agent\'s own status command', async () => {
    const seen: string[] = []
    const r = await checkAgentSignIn('claude', async (cmd, args) => {
      seen.push([cmd, ...args].join(' '))
      return proc({ stdout: '{"loggedIn": true}' })
    })
    expect(r.state).toBe('signed_in')
    expect(seen).toEqual(['claude auth status'])
  })
})

describe('an agent account that cannot run (out of usage, signed out)', () => {
  it('is recognised for Claude Code and Cursor when the run failed', () => {
    for (const out of [
      "You've hit your limit · resets 3pm (Asia/Tokyo)",
      "You're out of usage credits",
      'Claude AI usage limit reached|1762837200',
      '5-hour limit reached ∙ resets 2am',
      'Credit balance is too low',
      'Not logged in · Run /login',
      'API Error: 401 Invalid API key · Please run /login',
      'OAuth token has expired. Please obtain a new token or refresh your existing token.',
      "ActionRequiredError: Increase limits for faster responses You're out of usage",
      // Claude Code 2.1.322, verbatim, for --model claude-opus-5-5-medium (a Cursor id).
      "There's an issue with the selected model (claude-opus-5-5-medium). It may not exist or you may not have access to it. Run --model to pick a different model.",
    ]) {
      expect(agentUnavailable(proc({ code: 1, stdout: out })), out).toBe(true)
    }
  })

  it('never on a finished run, whatever its summary says (Mushi Mushi has a usage-limit page)', () => {
    expect(agentUnavailable(proc({ code: 0, stdout: 'Fixed the banner that says "usage limit reached" when the user is not logged in.' }))).toBe(false)
    expect(agentUnavailable(proc({ code: 1, stdout: 'TypeError: cannot read properties of undefined' }))).toBe(false)
    expect(agentUnavailable(proc({ code: null, timedOut: true, stdout: "You've hit your limit" }))).toBe(false)
  })

  it('closes the run as infra, so the report gets no 7-day cooldown', () => {
    const now = Date.parse('2026-11-11T12:00:00Z')
    const payload = agentUnavailablePayload('bugfix/MUSHI-x-local-claude', 'claude', { stdout: "You've hit your limit · resets 3pm", stderr: '' }, new Date(now))
    expect(payload).toMatchObject({ status: 'failed', error: expect.stringMatching(new RegExp(`^${WORK_INFRA_PREFIX} the Claude Code agent could not run`)) })
    expect(inLocalCooldown([{ id: 'a', status: 'failed', pr_url: null, agent: WORK_AGENT_KIND, created_at: new Date(now - 60_000).toISOString(), error: payload.error as string }], now)).toBe(false)
  })

  it('says why the batch stopped and what is left', () => {
    expect(stopLine('claude', 2, 'report')).toMatch(/^Stopped: the Claude Code agent could not run .* 2 reports left untouched .*claude auth status$/)
    expect(stopLine('cursor', 1, 'pull request')).toMatch(/1 pull request left .*cursor-agent status$/)
  })
})

describe('agentEnv', () => {
  it('empties the git credential helper list (Git for Windows names manager in its system config)', () => {
    const env = agentEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', CLAUDE_CODE_OAUTH_TOKEN: 't' }, '/tmp/empty')
    expect(env).toMatchObject({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '', GCM_INTERACTIVE: 'never' })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(Object.keys(env).filter((k) => /KEY|TOKEN|SECRET|CRED/i.test(k) && k !== 'GIT_CONFIG_KEY_0')).toEqual([])
  })
})

describe('isClaudeModel', () => {
  it('takes aliases and claude ids, not Cursor ids', () => {
    for (const m of ['opus', 'sonnet', 'haiku', 'fable', 'claude-opus-5-5', 'claude-sonnet-5']) expect(isClaudeModel(m), m).toBe(true)
    for (const m of ['grok-4.7-xhigh-fast', 'gpt-5', 'composer-2', 'auto', 'claude-opus-5-5-medium', 'claude-4.5-sonnet', 'claude-sonnet-5-thinking', 'opus-fast']) expect(isClaudeModel(m), m).toBe(false)
  })
})

describe('workOne with Claude Code', () => {
  /** A clone with an origin, a fake `claude` (the script, given the temp root) and no gh; runs `check` with workOne's outcome. */
  async function withFakeClaude(script: (root: string) => string, check: (r: { out: Awaited<ReturnType<typeof workOne>>; root: string; patches: Array<Record<string, unknown>>; heads: string }) => void): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'mushi-work-claude-'))
    const bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    writeFileSync(join(bin, 'claude'), script(root), { mode: 0o755 })
    const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
    const origin = join(root, 'origin.git')
    sh(root, 'init', '-q', '--bare', '-b', 'main', origin)
    const clone = join(root, 'clone')
    sh(root, 'clone', '-q', origin, clone)
    sh(clone, 'config', 'user.email', 'w@example.com')
    sh(clone, 'config', 'user.name', 'worker')
    sh(clone, 'commit', '-q', '--allow-empty', '-m', 'first')
    sh(clone, 'push', '-q', 'origin', 'HEAD:main')
    sh(clone, 'remote', 'set-head', 'origin', 'main')
    const saved = { PATH: process.env['PATH'], HOME: process.env['HOME'] }
    process.env['PATH'] = `${bin}:${saved.PATH}`
    process.env['HOME'] = root
    const patches: Array<Record<string, unknown>> = []
    const api = (async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST' && path === '/v1/admin/fixes') return { fixId: 'f1' }
      if (init?.method === 'PATCH') patches.push(JSON.parse(String(init.body)))
      return {}
    }) as never
    try {
      const out = await workOne(api, { id: R1, summary: 'Total is wrong', category: 'bug' } as never, { repoDir: clone, agent: 'claude', log: () => {}, earlier: [] })
      check({ out, root, patches, heads: sh(clone, 'ls-remote', '--heads', 'origin') })
    } finally {
      process.env['PATH'] = saved.PATH
      process.env['HOME'] = saved.HOME
      rmSync(root, { recursive: true, force: true })
    }
  }

  it.skipIf(process.platform === 'win32')('sends the prompt on stdin, and a spent account commits nothing and closes the run as infra', async () => {
    // Reads its prompt from stdin, edits a file, then fails as a spent plan does.
    await withFakeClaude(
      (root) => `#!/bin/sh\ncat > '${root}/prompt.txt'\necho half > half.txt\necho "You've hit your limit · resets 3pm"\nexit 1\n`,
      ({ out, root, patches, heads }) => {
        expect(out).toMatchObject({ result: 'failed', failureKind: 'infra', agentUnavailable: true })
        expect(readFileSync(join(root, 'prompt.txt'), 'utf8')).toContain(`# Fix Mushi report ${R1}`)
        expect(patches.at(-1)).toMatchObject({ status: 'failed', error: expect.stringMatching(new RegExp(`^${WORK_INFRA_PREFIX}`)) })
        expect(heads).not.toMatch(/local-claude/)
        // The half-done change stays in the worktree for a person to look at; nothing was committed.
        expect(existsSync(join(root, '.cache', 'mushi', 'work', 'clone', R1.slice(0, 8), 'half.txt'))).toBe(true)
      },
    )
  }, 30_000)

  it.skipIf(process.platform === 'win32')('a spent account that exits 0 with no change and no verdict is still infra, not a cooldown', async () => {
    await withFakeClaude(
      () => `#!/bin/sh\ncat > /dev/null\necho "You've hit your limit · resets 3pm"\nexit 0\n`,
      ({ out, patches }) => {
        expect(out).toMatchObject({ result: 'failed', failureKind: 'infra', agentUnavailable: true })
        expect(patches.at(-1)).toMatchObject({ status: 'failed', error: expect.stringMatching(new RegExp(`^${WORK_INFRA_PREFIX}`)) })
      },
    )
  }, 30_000)

  it.skipIf(process.platform === 'win32')('a finished run with a verdict stays a verdict, even when it mentions a usage limit', async () => {
    await withFakeClaude(
      () => `#!/bin/sh\ncat > /dev/null\necho "Mushi verdict: already_fixed the usage limit banner already shows"\nexit 0\n`,
      ({ out, patches }) => {
        expect(out).toMatchObject({ result: 'verdict' })
        expect(out.agentUnavailable).toBeUndefined()
        expect(String(patches.at(-1)?.error)).toMatch(/^Agent found nothing to change/)
      },
    )
  }, 30_000)
})
