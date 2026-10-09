// SPDX-License-Identifier: MIT
/**
 * Coding agents the loop can drive, each as a headless subprocess in the
 * worktree. The full instructions live in `.mushi-ux/PROMPT.md`; the agent
 * gets a one-line pointer to it, edits files, and the loop decides what to
 * keep.
 *
 * Credential boundary (ADR 0006 / 0020): the agent never gets the browser
 * profile or the Mushi CLI config. Its environment is scrubbed of every
 * credential except its own model key, and Claude Code runs `--restricted`,
 * which removes shell tools and confines file access to the worktree.
 *
 * `claude-code` is verified on Windows. `cursor` and `codex` follow their
 * documented headless flags and are unverified until the Plan 021 Phase 0
 * probes run (docs/execplans/ux-loop.md §5).
 */

import { cursorCloudAdapter } from './cursor-cloud.js'
import { run, scrubbedEnv, type RunResult } from './proc.js'

export type AgentName = 'claude-code' | 'cursor' | 'codex' | 'cursor-cloud'

export interface AgentRunOptions {
  cwd: string
  prompt: string
  model?: string | null
  timeoutMs: number
  onLine?: (line: string) => void
  /** Aborted by the studio's Stop button: the agent's process tree is killed. */
  signal?: AbortSignal
  /** Continue this earlier session (adapters with canResume) instead of starting a new one. */
  resumeSession?: string
}

export interface AgentAdapter {
  name: AgentName | (string & {})
  verified: boolean
  /** Can continue a session by id (its stream reports session_id): used for "time is up, finish now". */
  canResume?: boolean
  run(opts: AgentRunOptions): Promise<RunResult>
}

const claudeCode: AgentAdapter = {
  name: 'claude-code',
  verified: true,
  run: ({ cwd, prompt, model, timeoutMs, onLine, signal }) =>
    run(
      'claude',
      [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--restricted',
        '--strict-mcp-config',
        '--permission-mode',
        'acceptEdits',
        '--no-session-persistence',
        ...(model ? ['--model', model] : []),
      ],
      {
        cwd,
        stdin: prompt,
        timeoutMs,
        onLine,
        signal,
        env: scrubbedEnv(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']),
      },
    ),
}

const cursor: AgentAdapter = {
  name: 'cursor',
  // Verified on Windows 2026-10-06 (2026.10.01, Grok 4.7), launched outside Git Bash.
  verified: true,
  canResume: true,
  // Cursor's CLI takes the prompt as an argument in print mode; whether it
  // reads stdin is a Phase 0 probe. The `.cmd` shim needs a shell on Windows.
  // The loop's prompt is a one-line pointer to .mushi-ux/PROMPT.md, so it
  // stays far below cmd.exe's command-line limit.
  run: ({ cwd, prompt, model, timeoutMs, onLine, signal, resumeSession }) =>
    run(
      'agent',
      [
        '-p',
        ...(resumeSession ? ['--resume', quoteArg(resumeSession)] : []),
        '--force',
        // Headless runs otherwise stop on the workspace-trust prompt in a fresh worktree.
        '--trust',
        '--output-format',
        'stream-json',
        '--workspace',
        '.',
        ...(model ? ['--model', quoteArg(cursorCliModel(model))] : []),
        quoteArg(prompt),
      ],
      { cwd, timeoutMs, onLine, signal, shell: true, env: scrubbedEnv(['CURSOR_API_KEY']) },
    ),
}

const codex: AgentAdapter = {
  name: 'codex',
  verified: false,
  run: ({ cwd, prompt, model, timeoutMs, onLine, signal }) =>
    run(
      'codex',
      ['exec', '--json', '--full-auto', '-C', '.', ...(model ? ['-m', quoteArg(model)] : []), '-'],
      { cwd, stdin: prompt, timeoutMs, onLine, signal, shell: true, env: scrubbedEnv(['OPENAI_API_KEY', 'CODEX_API_KEY']) },
    ),
}

/**
 * The Cursor CLI takes a model's settings in brackets
 * (`claude-opus-4-8[context=1m,effort=high]`); the UI and the Cursor API use
 * `id?context=1m&effort=high`. A bare id passes through.
 */
export function cursorCliModel(spec: string): string {
  const [id, query] = spec.split('?')
  if (!query) return id
  const params = query.split('&').filter(Boolean)
  return params.length ? `${id}[${params.join(',')}]` : id
}

/**
 * Quote one argument for the shell `spawn({ shell: true })` uses, so model
 * specs like `grok-4.7?reasoning_effort=xhigh&context=500k` survive.
 * cmd.exe has no escape inside double quotes, so quotes are dropped there.
 */
export function quoteArg(s: string, platform: NodeJS.Platform = process.platform): string {
  if (/^[\w./:=@-]+$/.test(s)) return s
  const flat = s.replace(/\r?\n/g, ' ')
  if (platform === 'win32') return `"${flat.replace(/"/g, '')}"`
  return `'${flat.replace(/'/g, `'\\''`)}'`
}

export const AGENTS: Record<AgentName, AgentAdapter> = {
  'claude-code': claudeCode,
  cursor,
  codex,
  // Cursor Cloud: the edit runs on Cursor's machines (your plan pays), the
  // measuring stays here. Needs CURSOR_API_KEY and a GitHub origin.
  'cursor-cloud': cursorCloudAdapter(),
}

export function getAgent(name: string): AgentAdapter {
  const adapter = AGENTS[name as AgentName]
  if (!adapter) throw new Error(`Unknown agent "${name}". Use one of: ${Object.keys(AGENTS).join(', ')}`)
  return adapter
}
