/**
 * FILE: packages/cli/src/commands/agent.ts
 * PURPOSE: `mushi agent serve` (Plan 023 Phase 3, ADR 0034): this machine runs
 *          the fixes dispatched with `agent: 'local'` (`mushi fix <id> --agent
 *          local`, the console, or MCP dispatch_fix). It polls
 *          POST /v1/admin/agent/claim, runs Claude Code, Codex or Aider in a
 *          git worktree, pushes the branch with your git, opens a draft PR
 *          with your gh, and reports to POST /v1/admin/agent/attempts/:id/report.
 *          The steps live in ../agent/serve.ts and ../agent/plan.ts.
 */

import type { Command } from 'commander'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { apiCall, requireConfig, requireUuid } from '../cli-shared.js'
import { MushiCliError } from '../errors.js'
import { getAbortSignal } from '../signals.js'
import { cloudModelRefusal, LOCAL_AGENT_KINDS, OSS_PROVIDERS, type ClaimedAttempt, type FixContext, type LocalAgentKind, type OssProvider } from '../agent/plan.js'
import { nodeExec, nodeServeFs, runOneFix, type ServeDeps } from '../agent/serve.js'

const RENEW_EVERY_MS = 5 * 60_000

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (signal.aborted) return done()
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      done()
    }, { once: true })
  })
}

function positiveInt(raw: string, flag: string, max: number): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > max) throw new MushiCliError('E_INVALID_INPUT', `${flag} must be a whole number from 1 to ${max}.`)
  return n
}

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description('Run fixes on your own machine: claim fixes dispatched with --agent local and open draft PRs with your own git and gh')

  agent
    .command('serve')
    .description('Poll for local fixes, run a coding agent in a git worktree, push the branch and open a draft PR')
    .requiredOption('--repo-dir <path>', 'A checkout of the repo the fixes go to (its origin is where the branch is pushed)')
    .option('--agent <name>', `Coding agent: ${LOCAL_AGENT_KINDS.join(' | ')}`, 'claude')
    .option('--model <id>', 'Model id (Claude Code --model, Codex -m, Aider ollama_chat/<id>). Ollama :cloud models are refused')
    .option('--provider <name>', `Codex local provider: ${OSS_PROVIDERS.join(' | ')}`, 'ollama')
    .option('--project <id>', 'Only claim fixes of this project (defaults to the configured project)')
    .option('--once', 'Claim at most one fix, run it, and exit')
    .option('--interval <seconds>', 'Seconds between polls when nothing waits', '30')
    .option('--timeout <minutes>', 'Stop the agent after this many minutes', '30')
    .option('--test-timeout <minutes>', "Stop the repo's tests after this many minutes", '10')
    .addHelpText('after', `
Where your code goes: the repo contents go only where the chosen agent and model
send them. Mushi itself receives the claim, the outcome, the PR link and the
agent's summary, never your files. The branch is pushed to your checkout's
origin with your git credentials, and the draft PR is opened with your gh login.

Offline settings:
  claude  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1,
          CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1 and a settings
          file with skipWebFetchPreflight. Set ANTHROPIC_BASE_URL (for example
          http://localhost:11434 for Ollama 0.14+, or a LiteLLM proxy) to keep
          the model local; it is passed through.
  codex   codex exec --oss --local-provider <provider>, analytics and feedback off.
  aider   aider --model ollama_chat/<model>, update checks and analytics off;
          Mushi commits the change.
Ollama models tagged :cloud run on ollama.com and are refused.

Each fix: a git worktree on a new branch from the base branch, the agent run
headless with the fix context as its prompt, the repo's own tests when
package.json has a test script (best effort, reported in the PR), commit, push,
gh pr create --draft, then the worktree is removed. A fix this machine claims is
held for 30 minutes and renewed while it runs; if the machine stops, another can
take it.

Examples:
  mushi fix <reportId> --agent local
  mushi agent serve --repo-dir ~/code/app --once
  ANTHROPIC_BASE_URL=http://localhost:11434 mushi agent serve --repo-dir . --model qwen3-coder:30b
  mushi agent serve --repo-dir . --agent codex --provider lmstudio --model qwen3-coder
  mushi agent serve --repo-dir . --agent aider --model qwen3-coder:30b`)
    .action(async (opts: {
      repoDir: string; agent: string; model?: string; provider: string; project?: string
      once?: boolean; interval: string; timeout: string; testTimeout: string
    }) => {
      if (!(LOCAL_AGENT_KINDS as readonly string[]).includes(opts.agent)) {
        throw new MushiCliError('E_INVALID_INPUT', `--agent must be one of ${LOCAL_AGENT_KINDS.join(', ')}.`)
      }
      if (!(OSS_PROVIDERS as readonly string[]).includes(opts.provider)) {
        throw new MushiCliError('E_INVALID_INPUT', `--provider must be one of ${OSS_PROVIDERS.join(', ')}.`)
      }
      const refusal = cloudModelRefusal(opts.model)
      if (refusal) throw new MushiCliError('E_INVALID_INPUT', refusal)
      if (opts.agent === 'aider' && !opts.model) throw new MushiCliError('E_INVALID_INPUT', 'Aider needs --model (an Ollama model).')
      const repoDir = resolve(opts.repoDir)
      try {
        if (!statSync(repoDir).isDirectory()) throw new Error('not a folder')
      } catch {
        throw new MushiCliError('E_INVALID_INPUT', `--repo-dir ${repoDir} is not a folder.`)
      }
      const intervalMs = positiveInt(opts.interval, '--interval', 3600) * 1000
      const agentTimeoutMs = positiveInt(opts.timeout, '--timeout', 240) * 60_000
      const testTimeoutMs = positiveInt(opts.testTimeout, '--test-timeout', 120) * 60_000

      const config = requireConfig()
      const projectId = opts.project ? requireUuid(opts.project, 'project id') : config.projectId
      const scoped = { ...config, projectId }
      const deps: ServeDeps = {
        ...nodeServeFs,
        exec: nodeExec,
        log: (line) => console.log(`${new Date().toISOString()} ${line}`),
        claim: async () => {
          const res = await apiCall<{ attempt: ClaimedAttempt | null; context?: FixContext | null }>(
            '/v1/admin/agent/claim',
            scoped,
            { method: 'POST', body: JSON.stringify(projectId ? { projectId } : {}) },
            { timeoutMs: 60_000 },
          )
          if (!res.ok) throw new MushiCliError('E_API_ERROR', `Claim failed: ${res.error.code} — ${res.error.message}`)
          return { attempt: res.data.attempt, context: res.data.context ?? null }
        },
        report: async (attemptId, body) => {
          const res = await apiCall(`/v1/admin/agent/attempts/${encodeURIComponent(attemptId)}/report`, scoped, {
            method: 'POST',
            body: JSON.stringify(body),
          }, { timeoutMs: 60_000 })
          return res.ok ? { ok: true } : { ok: false, message: `${res.error.code} — ${res.error.message}` }
        },
      }
      const serveOpts = {
        repoDir,
        agent: opts.agent as LocalAgentKind,
        model: opts.model,
        provider: opts.provider as OssProvider,
        agentTimeoutMs,
        testTimeoutMs,
        renewEveryMs: RENEW_EVERY_MS,
        env: process.env,
      }

      const signal = getAbortSignal()
      console.log(`Serving local fixes for ${repoDir} with ${opts.agent}${opts.model ? ` (${opts.model})` : ''}. Ctrl-C to stop.`)
      for (;;) {
        let outcome
        try {
          outcome = await runOneFix(deps, serveOpts)
        } catch (err) {
          if (opts.once) throw err
          process.stderr.write(`${new Date().toISOString()} ${err instanceof Error ? err.message : String(err)}\n`)
          outcome = { outcome: 'none' as const }
        }
        if (opts.once) {
          if (outcome.outcome === 'none') console.log('No local fix is waiting.')
          if (outcome.outcome === 'failed') process.exitCode = 1
          return
        }
        if (signal.aborted) return
        // Right after a fix, look for the next one at once.
        if (outcome.outcome === 'none') await sleep(intervalMs, signal)
        if (signal.aborted) return
      }
    })
}
