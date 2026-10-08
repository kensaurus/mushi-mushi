// SPDX-License-Identifier: MIT
/**
 * A one-minute check that the agent can run and use its file tools, before
 * the worktree, install and dev server spend ten minutes. The agent reads a
 * file holding a random code word; the check passes when the code word comes
 * back in its output (the tool result or the reply).
 *
 * Why (glot.it, 2026-10-06): the Cursor CLI was logged out on the first run,
 * and on a later run every tool call was refused by a Claude Code hook the
 * CLI loads. Both surfaced only after the first attempt's full time box.
 */

import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentAdapter } from './agents.js'
import { agentFinalMessage } from './verdict.js'

const PREFLIGHT_TIMEOUT_MS = 3 * 60_000

const NOT_LOGGED_IN_RE = /not (logged|signed) in|log ?in required|please (log|sign) ?in|unauthori[sz]ed|invalid api key|authentication/i
const HOOK_RE = /\bhooks?\b/i

/**
 * Plain-English next step for a failed check, by agent and symptom.
 * @internal Exported for tests only.
 */
export function preflightAdvice(agent: string, output: string, platform: NodeJS.Platform = process.platform): string {
  if (NOT_LOGGED_IN_RE.test(output)) {
    const login: Record<string, string> = {
      cursor: 'Run `agent login` (Cursor CLI), then start the run again.',
      'claude-code': 'Run `claude` once and sign in, or set ANTHROPIC_API_KEY.',
      codex: 'Run `codex login`, or set OPENAI_API_KEY.',
    }
    return `The agent is not signed in. ${login[agent] ?? 'Sign the agent in, then start the run again.'}`
  }
  if (agent === 'cursor' && HOOK_RE.test(output)) {
    return (
      'A hook refused the agent’s tool calls. The Cursor CLI also runs the hooks in ~/.claude/settings.json; ' +
      (platform === 'win32'
        ? 'on Windows a hook fails when the run is started from Git Bash. Start `mushi ux` from PowerShell or cmd, or fix the hook.'
        : 'fix the failing hook or remove it, then start the run again.')
    )
  }
  return 'Run the agent once by hand in this repo to see what it needs, then start the run again.'
}

/**
 * Null when the agent read the file; otherwise a message that says what
 * went wrong and what to do. Never throws for an agent failure.
 */
export async function preflightAgent(
  agent: AgentAdapter,
  opts: { model?: string | null; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), 'mushi-ux-preflight-'))
  const word = randomBytes(4).toString('hex')
  try {
    writeFileSync(join(dir, 'PREFLIGHT.txt'), `The code word is ${word}.\n`)
    const timeoutMs = opts.timeoutMs ?? PREFLIGHT_TIMEOUT_MS
    const res = await agent.run({
      cwd: dir,
      prompt: 'Read the file PREFLIGHT.txt in this folder and reply with only the code word it contains. Do not edit anything.',
      model: opts.model,
      timeoutMs,
      signal: opts.signal,
    })
    if (res.stdout.includes(word) || res.tail.includes(word)) return null
    if (opts.signal?.aborted) return 'Stopped.'
    const said = agentFinalMessage(res.stdout) ?? res.tail.trim()
    const output = `${said}\n${res.tail}`
    const what = res.timedOut
      ? `did not answer within ${Math.round(timeoutMs / 1000)} s`
      : res.exitCode !== 0
        ? `exited with code ${res.exitCode}`
        : 'answered without reading the file'
    const quote = said ? ` It said: “${said.replace(/\s+/g, ' ').slice(-300)}”` : ''
    return `Agent check failed: ${agent.name}${opts.model ? ` (${opts.model})` : ''} ${what}.${quote} ${preflightAdvice(String(agent.name), output)}`
  } catch (err) {
    return `Agent check failed: could not start ${agent.name}: ${(err as Error).message}. Is it installed and on PATH?`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
