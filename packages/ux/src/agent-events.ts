// SPDX-License-Identifier: MIT
/**
 * Turns an agent's stream-json lines into short steps a person can follow:
 * "Read app/page.tsx", "Edit globals.css", "Run pnpm lint", or what the
 * agent said. The raw stream is still saved per attempt for debugging.
 *
 * Formats, as documented on 2026-10-06:
 * - Cursor CLI (cursor.com/docs/cli/reference/output-format): `assistant`
 *   messages, `tool_call` started/completed keyed `<name>ToolCall`, a final
 *   `result`. Only `started` is shown, so each call appears once.
 * - Claude Code: `assistant` messages whose content holds `text` and
 *   `tool_use` blocks; `user` tool results are skipped.
 * - Codex `exec --json`: `item.started` / `item.completed` with
 *   `command_execution`, `file_change` and `agent_message` items.
 * Unknown events are dropped; a line that is not JSON (stderr, the cloud
 * adapter's status lines) is shown as is.
 */

type AgentStepKind = 'say' | 'read' | 'edit' | 'run' | 'search' | 'tool' | 'done' | 'error'

export interface AgentStep {
  kind: AgentStepKind
  text: string
  /** File the step read or changed, when it names one. */
  path?: string
}

const MAX_TEXT = 300

const clip = (s: string, n = MAX_TEXT) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/**
 * Path relative to the worktree when the agent gave an absolute one.
 * @internal Exported for tests only.
 */
export function shortPath(p: string, cwd?: string): string {
  const norm = p.replace(/\\/g, '/')
  if (cwd) {
    const base = cwd.replace(/\\/g, '/').replace(/\/$/, '') + '/'
    if (norm.toLowerCase().startsWith(base.toLowerCase())) return norm.slice(base.length)
  }
  return norm
}

const EDIT_TOOLS = /^(write|edit|multiedit|strreplace|str_replace|searchreplace|applypatch|apply_patch|delete|notebookedit|create)/i
const READ_TOOLS = /^(read|view|ls|list|readfile|readlints)/i
const SEARCH_TOOLS = /^(grep|glob|search|find|codebasesearch|semanticsearch|websearch|webfetch)/i
const RUN_TOOLS = /^(shell|bash|run|terminal|exec|command)/i

/** One tool call, from its name and arguments, in any of the three formats. */
function describeTool(name: string, args: Json, cwd?: string): AgentStep {
  const path = str(args.path) ?? str(args.file_path) ?? str(args.filePath) ?? str(args.target_file) ?? str(args.notebook_path)
  const command = str(args.command) ?? (Array.isArray(args.command) ? args.command.join(' ') : undefined)
  const pattern = str(args.pattern) ?? str(args.query) ?? str(args.globPattern) ?? str(args.glob_pattern) ?? str(args.url)
  const label = name.replace(/ToolCall$/, '')
  const p = path ? shortPath(path, cwd) : undefined
  // The kind already says what happened ("[edit] app/page.tsx"), so the text is just the object.
  if (EDIT_TOOLS.test(label)) return { kind: 'edit', text: `${p ?? '(a file)'}${/^delete/i.test(label) ? ' (deleted)' : ''}`, path: p }
  if (RUN_TOOLS.test(label) && command) return { kind: 'run', text: clip(command, 160) }
  if (SEARCH_TOOLS.test(label)) return { kind: 'search', text: clip(pattern ?? p ?? label, 160) }
  if (READ_TOOLS.test(label)) return { kind: 'read', text: p ?? (clip(pattern ?? '', 160) || '(a file)'), path: p }
  return { kind: 'tool', text: clip(`${label}${p ? ` ${p}` : pattern ? ` ${pattern}` : ''}`, 160) }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c): c is Json => isObj(c) && c.type === 'text')
    .map((c) => str(c.text) ?? '')
    .join(' ')
}

function parseArgs(raw: unknown): Json {
  if (isObj(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw) as unknown
      return isObj(v) ? v : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** The steps one line holds (a Claude Code message can hold several), or none. */
export function describeAgentLine(line: string, cwd?: string): AgentStep[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  if (!trimmed.startsWith('{')) return [{ kind: 'say', text: clip(trimmed) }]
  let ev: Json
  try {
    const v = JSON.parse(trimmed) as unknown
    if (!isObj(v)) return []
    ev = v
  } catch {
    return [{ kind: 'say', text: clip(trimmed) }]
  }
  const type = str(ev.type)

  if (type === 'system' && ev.subtype === 'init') {
    return [{ kind: 'tool', text: `Started${str(ev.model) ? ` (${ev.model})` : ''}` }]
  }
  if (type === 'assistant' && isObj(ev.message)) {
    // Cursor partial-output flushes repeat text already shown.
    if (ev.model_call_id !== undefined) return []
    const content = ev.message.content
    const steps: AgentStep[] = []
    const said = clip(textOf(content))
    if (said) steps.push({ kind: 'say', text: said })
    if (Array.isArray(content)) {
      for (const c of content) {
        if (isObj(c) && c.type === 'tool_use' && str(c.name)) steps.push(describeTool(c.name as string, parseArgs(c.input), cwd))
      }
    }
    return steps
  }
  if (type === 'tool_call') {
    if (ev.subtype !== 'started' || !isObj(ev.tool_call)) return []
    const [key, body] = Object.entries(ev.tool_call)[0] ?? []
    if (!key || !isObj(body)) return []
    if (key === 'function') return [describeTool(str(body.name) ?? 'tool', parseArgs(body.arguments), cwd)]
    return [describeTool(key, parseArgs(body.args), cwd)]
  }
  if (type === 'result') {
    if (ev.is_error === true || (str(ev.subtype) && ev.subtype !== 'success')) {
      return [{ kind: 'error', text: clip(str(ev.result) ?? str(ev.error) ?? `Finished with ${String(ev.subtype)}`) }]
    }
    return [{ kind: 'done', text: 'Finished' }]
  }
  // Codex exec --json
  if ((type === 'item.started' || type === 'item.completed') && isObj(ev.item)) {
    const item = ev.item
    if (item.type === 'command_execution' && type === 'item.started' && str(item.command)) {
      return [{ kind: 'run', text: clip(item.command as string, 160) }]
    }
    if (item.type === 'file_change' && type === 'item.completed' && Array.isArray(item.changes)) {
      return item.changes
        .filter((c): c is Json => isObj(c) && !!str(c.path))
        .map((c) => {
          const p = shortPath(c.path as string, cwd)
          return { kind: 'edit' as const, text: p, path: p }
        })
    }
    if (item.type === 'agent_message' && type === 'item.completed' && str(item.text)) {
      return [{ kind: 'say', text: clip(item.text as string) }]
    }
    return []
  }
  if (type === 'error') return [{ kind: 'error', text: clip(str(ev.message) ?? 'Error') }]
  return []
}

/**
 * Per-attempt files under `<run>/agent/`: `<base>.steps.log` gets one
 * readable step per line as the agent works (the studio reads its tail
 * after a reload), `<base>.log` the raw output when the attempt ends.
 */
export function attemptLogBase(surfaceKey: string, attempt: number): string {
  return `${surfaceKey.replace(/[^\w.-]+/g, '_')}-${attempt}`
}

/** The session id a stream-json run reports (Cursor and Claude Code put it on every event), or null. */
export function sessionIdOf(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    try {
      const id = (JSON.parse(line) as { session_id?: unknown }).session_id
      if (typeof id === 'string' && /^[\w-]{6,80}$/.test(id)) return id
    } catch {
      /* not JSON */
    }
  }
  return null
}

const ICON: Record<AgentStepKind, string> = {
  say: '›',
  read: 'read',
  edit: 'edit',
  run: 'run',
  search: 'find',
  tool: 'tool',
  done: 'done',
  error: 'error',
}

/** One line for the live log: the kind, then the text. */
export function formatStep(step: AgentStep): string {
  return step.kind === 'say' ? `› ${step.text}` : `[${ICON[step.kind]}] ${step.text}`
}
