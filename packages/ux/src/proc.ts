// SPDX-License-Identifier: MIT
/**
 * Child processes for agents, installs and dev servers. Prompts go on stdin
 * (cmd.exe caps a command line near 8 KB), timeouts kill the whole process
 * tree (`taskkill /T /F` on Windows), and agents get a scrubbed environment.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'

export interface RunResult {
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  /** Last ~4 KB of combined output. */
  tail: string
  /** Full stdout, capped at 1 MB. */
  stdout: string
}

export interface RunOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  stdin?: string
  timeoutMs?: number
  /** Needed for `.cmd` shims and shell syntax in user-given commands. */
  shell?: boolean
  onLine?: (line: string) => void
  /** Stops the process tree when aborted (the studio's Stop button). */
  signal?: AbortSignal
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

export function run(cmd: string, args: readonly string[], opts: RunOptions): Promise<RunResult> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: opts.shell ?? false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let tail = ''
    let stdout = ''
    let partial = ''
    let timedOut = false
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      tail = (tail + text).slice(-4096)
      if (!opts.onLine) return
      partial += text
      const lines = partial.split(/\r?\n/)
      partial = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) opts.onLine(line)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 1_000_000) stdout += chunk.toString('utf8')
      onData(chunk)
    })
    child.stderr?.on('data', onData)
    child.on('error', reject)
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          killTree(child)
        }, opts.timeoutMs)
      : null
    const onAbort = () => killTree(child)
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (partial.trim() && opts.onLine) opts.onLine(partial)
      resolve({ exitCode: code, timedOut, durationMs: Date.now() - started, tail, stdout })
    })
    child.stdin?.end(opts.stdin ?? '')
  })
}

/** Long-running child (a dev server); the caller stops it with `stop()`. */
export function start(command: string, opts: { cwd: string; env?: NodeJS.ProcessEnv; onLine?: (l: string) => void }) {
  const child = spawn(command, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    shell: true,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const forward = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) opts.onLine?.(line)
  }
  child.stdout?.on('data', forward)
  child.stderr?.on('data', forward)
  return { child, stop: () => killTree(child) }
}

/**
 * The tool's own credentials. The dev server and the install run the app's
 * code, which the agent edits, so they get the app's environment without
 * these: on a CI runner that is the Cursor and Anthropic keys and the job's
 * GitHub tokens. App variables (VITE_*_KEY and the like) stay.
 */
const TOOL_SECRET_RE = /^(MUSHI_.*|CURSOR_API_KEY|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|CODEX_API_KEY|GITHUB_TOKEN|GH_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|ACTIONS_ID_TOKEN_REQUEST_URL)$/i

export function appEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && !TOOL_SECRET_RE.test(k)) out[k] = v
  }
  return out
}

const SECRET_NAME_RE = /(^MUSHI_|^SUPABASE_|_TOKEN$|_KEY$|_SECRET$|PASSWORD|^GH_|^GITHUB_)/i

/**
 * The environment an agent runs with: everything except credentials, plus
 * the one credential that agent itself needs to talk to its model.
 */
export function scrubbedEnv(keep: readonly string[], base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue
    if (SECRET_NAME_RE.test(k) && !keep.includes(k)) continue
    out[k] = v
  }
  return out
}
