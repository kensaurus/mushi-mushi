/**
 * FILE: packages/cli/src/commands/work-agents.ts
 * PURPOSE: The coding agents `mushi work` and the local worker can run on this
 *          machine, in one table: the binary, its argv, how the prompt gets
 *          to it, how its sign-in is checked, and the name it goes by in
 *          logs, commits, PR bodies and branch names. Every place that starts
 *          an agent reads it from here.
 *
 *            - cursor: the Cursor CLI (`cursor-agent -p`), signed in to a
 *              Cursor account;
 *            - claude: Claude Code (`claude -p`), signed in to a claude.ai
 *              plan. The prompt goes on stdin (Windows caps a command line at
 *              about 32K characters; the prompt may be 40K). Only the app
 *              repo's own settings load (`--setting-sources project,local`)
 *              and no MCP server (`--strict-mcp-config`): the person's own
 *              hooks and MCP servers (which hold credentials outside the
 *              environment) never reach an agent that reads report text.
 *
 *          Both run with the environment `agentEnv` (work.ts) leaves them.
 */

import { stripVTControlCharacters } from 'node:util'
import { MushiCliError } from '../errors.js'
import type { Proc } from './work.js'

export const LOCAL_AGENTS = ['cursor', 'claude'] as const
export type LocalAgent = (typeof LOCAL_AGENTS)[number]

/** What one sign-in check says. Only a clear answer counts: a timeout or a crash is `unknown`. */
export type AgentSignIn = 'signed_in' | 'signed_out' | 'unknown' | 'missing'

/** `edit` changes the worktree (fixes, follow-ups, conflicts); `ask` only reads it (the code-read audit). */
export type AgentMode = 'edit' | 'ask'

export interface AgentRun {
  cmd: string
  args: string[]
  /** The prompt on stdin instead of argv. */
  input?: string
}

interface AgentSpec {
  /** In logs, commit bodies and PR bodies: "a local <label> agent". */
  label: string
  /** The `-local-<branchTag>` branch suffix. */
  branchTag: string
  bin: string
  run: (o: { mode: AgentMode; workspace: string; model?: string; prompt: string }) => AgentRun
  /** The sign-in check's argv. */
  status: string[]
  signInState: (p: Proc) => AgentSignIn
  install: string
  login: string
  /** Where to look up model ids, for `--model` help and errors. */
  models: string
}

/**
 * @internal Exported for tests only. What one `cursor-agent status` run says.
 * "Not logged in" is checked before "logged in", which it contains.
 */
export function cursorSignInState(p: Proc): AgentSignIn {
  if (p.code === null && /\bENOENT\b/.test(p.stderr)) return 'missing'
  if (p.timedOut || p.code === null) return 'unknown'
  const out = stripVTControlCharacters(`${p.stdout}\n${p.stderr}`)
  if (/\bnot\s+(?:logged|signed)\s+in\b|\blogged\s+out\b/i.test(out)) return 'signed_out'
  if (p.code === 0 && /\b(?:logged|signed)\s+in\b/i.test(out)) return 'signed_in'
  return 'unknown'
}

/** @internal Exported for tests only. What one `claude auth status` run says (it prints JSON with `loggedIn`). */
export function claudeSignInState(p: Proc): AgentSignIn {
  if (p.code === null && /\bENOENT\b/.test(p.stderr)) return 'missing'
  if (p.timedOut || p.code === null) return 'unknown'
  const out = stripVTControlCharacters(p.stdout).trim()
  try {
    const parsed = JSON.parse(out.slice(out.indexOf('{'))) as { loggedIn?: unknown }
    if (parsed.loggedIn === true) return 'signed_in'
    if (parsed.loggedIn === false) return 'signed_out'
  } catch {
    // Not JSON: an older Claude Code, or an error; read the words.
  }
  if (/\bnot\s+(?:logged|signed)\s+in\b/i.test(`${out}\n${p.stderr}`)) return 'signed_out'
  return 'unknown'
}

const AGENTS: Record<LocalAgent, AgentSpec> = {
  cursor: {
    label: 'Cursor',
    branchTag: 'cursor',
    bin: 'cursor-agent',
    run: ({ mode, workspace, model, prompt }) => ({
      cmd: 'cursor-agent',
      args: [
        '-p',
        ...(mode === 'ask' ? ['--mode', 'ask'] : ['--force']),
        '--trust',
        '--output-format',
        'text',
        '--workspace',
        workspace,
        ...(model ? ['--model', model] : []),
        prompt,
      ],
    }),
    status: ['status'],
    signInState: cursorSignInState,
    install: 'Install it: https://cursor.com/cli',
    login: 'Run: cursor-agent login',
    models: 'cursor-agent --list-models',
  },
  claude: {
    label: 'Claude Code',
    branchTag: 'claude',
    bin: 'claude',
    // The worktree is the cwd (runProc's), which is Claude Code's workspace.
    run: ({ mode, model, prompt }) => ({
      cmd: 'claude',
      args: [
        '-p',
        '--output-format',
        'text',
        // ask: read-only tools, and anything that would prompt is refused.
        ...(mode === 'ask' ? ['--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob'] : ['--permission-mode', 'bypassPermissions']),
        '--strict-mcp-config',
        '--setting-sources',
        'project,local',
        '--no-session-persistence',
        ...(model ? ['--model', model] : []),
      ],
      input: prompt,
    }),
    status: ['auth', 'status'],
    signInState: claudeSignInState,
    install: 'Install it: https://code.claude.com/docs/en/setup (the native installer puts claude on PATH)',
    login: 'Run: claude auth login',
    models: 'an alias such as opus, sonnet or haiku, or a full claude-… id',
  },
}

export function agentSpec(agent: LocalAgent): AgentSpec {
  return AGENTS[agent]
}

/** @internal Exported for tests only. The argv and stdin that start `agent` in `workspace`. */
export function agentRun(agent: LocalAgent, o: { mode: AgentMode; workspace: string; model?: string; prompt: string }): AgentRun {
  return AGENTS[agent].run(o)
}

/** `--agent` and the worker config's `agent`: one of LOCAL_AGENTS, default cursor. */
export function parseLocalAgent(raw: unknown, where = '--agent'): LocalAgent {
  if (raw === undefined || raw === null || raw === '') return 'cursor'
  if (typeof raw === 'string' && (LOCAL_AGENTS as readonly string[]).includes(raw.toLowerCase())) return raw.toLowerCase() as LocalAgent
  throw new MushiCliError('E_INVALID_INPUT', `Unknown agent "${String(raw).slice(0, 40)}" (${where}).`, `Use one of: ${LOCAL_AGENTS.join(', ')}.`)
}

/**
 * @internal Exported for tests only. A model id Claude Code takes: an alias or
 * a claude-… id. A lane's model is set in the console for Cursor (grok-4.7-xhigh,
 * gpt-5): handed to Claude Code, every run would fail.
 */
export function isClaudeModel(id: string): boolean {
  // Cursor names Claude models too, with an effort or speed suffix or dots
  // (claude-opus-5-5-medium, claude-4.5-sonnet): Claude Code refuses those.
  if (/\.|-(?:low|medium|high|xhigh|max|thinking|fast)$/i.test(id)) return false
  return /^(?:claude-[a-z]|(?:opus|sonnet|haiku|fable)$)/i.test(id)
}

/**
 * The agent account would not run at all: spent usage, a model its plan
 * lacks, a lost sign-in. Cursor: "Increase limits", ActionRequiredError.
 * Claude Code (its own strings, 2.1.x): "You've hit your …", "You're out of
 * usage credits", "… limit reached · resets …", "Credit balance is too low",
 * "Not logged in · Run /login", "Invalid API key · Please run /login", an
 * expired OAuth token, and a model it refuses ("There's an issue with the
 * selected model"): every next run would fail the same way.
 */
export const AGENT_UNAVAILABLE =
  /ActionRequiredError|Increase limits|usage limit|out of (?:extra )?(?:usage|credits)|Cannot use this model|You've (?:hit|reached) your|You're out of usage|(?:spend|usage) limit reached|limit reached\s*[·∙•]\s*resets|credit balance (?:is )?too low|run \/login|Invalid API key|OAuth token (?:has )?(?:expired|refresh failed|unavailable)|issue with the selected model/i

/**
 * @internal Exported for tests only. True when an agent run ended because its
 * account could not run, not because of the report: only a run that failed
 * (a finished agent's summary may well talk about a usage limit; Mushi Mushi
 * has a billing page) and only on the start and end of what it printed.
 */
export function agentUnavailable(run: Pick<Proc, 'code' | 'stdout' | 'stderr' | 'timedOut'>): boolean {
  if (run.code === 0 || run.timedOut) return false
  const text = stripVTControlCharacters(`${run.stdout}\n${run.stderr}`).trim()
  return AGENT_UNAVAILABLE.test(text.length > 4000 ? `${text.slice(0, 2000)}\n${text.slice(-2000)}` : text)
}
