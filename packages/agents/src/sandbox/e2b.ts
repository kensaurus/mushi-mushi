/**
 * FILE: packages/agents/src/sandbox/e2b.ts
 * PURPOSE: E2B managed sandbox adapter (V5.3 §2.10, M6).
 *          Uses dynamic import so the @e2b/code-interpreter SDK is an OPTIONAL
 *          peer dep — consumers only pay the install cost if they actually pick
 *          the e2b provider via project_settings.sandbox_provider = 'e2b'.
 *
 * SECURITY:
 *   - Network egress: E2B Sandbox v2 supports per-sandbox firewall via
 *     `firewall: { allow: [...] }` (https://e2b.dev/docs/sandbox/networking).
 *   - Lifecycle: every sandbox MUST be destroyed in finally{}; we also set a
 *     hard timeout via sandbox.setTimeout for defense-in-depth.
 *   - Secrets: gitToken is passed via env, never echoed to stdout. We redact
 *     it from any captured logs before persisting.
 */

import { SandboxError, type Sandbox, type SandboxAuditEvent, type SandboxConfig, type SandboxExecOptions, type SandboxExecResult, type SandboxFileWrite, type SandboxProvider } from './types.js'

interface E2BSandboxV2 {
  sandboxId: string
  setTimeout(ms: number): Promise<void>
  commands: {
    run(cmd: string, opts?: { cwd?: string; envs?: Record<string, string>; timeoutMs?: number; onStdout?: (line: string) => void; onStderr?: (line: string) => void }): Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
  files: {
    write(path: string, content: string | Uint8Array): Promise<void>
    read(path: string): Promise<string>
    list(path: string): Promise<Array<{ name: string }>>
  }
  kill(): Promise<void>
}

interface E2BSandboxClass {
  create(template: string, opts?: { apiKey?: string; envs?: Record<string, string>; timeoutMs?: number; firewall?: { allow?: string[]; denyByDefault?: boolean } }): Promise<E2BSandboxV2>
}

class E2BSandbox implements Sandbox {
  readonly id: string
  readonly config: SandboxConfig
  private inner: E2BSandboxV2
  private onAudit: (e: SandboxAuditEvent) => void
  private destroyed = false

  constructor(inner: E2BSandboxV2, config: SandboxConfig, onAudit: (e: SandboxAuditEvent) => void) {
    this.inner = inner
    this.config = config
    this.id = inner.sandboxId
    this.onAudit = onAudit
  }

  async exec(cmd: string, opts: SandboxExecOptions = {}): Promise<SandboxExecResult> {
    this.assertAlive()
    const start = Date.now()
    this.audit('exec', { cmd: redact(cmd), cwd: opts.cwd })
    try {
      const env = { ...(this.config.credentials?.env ?? {}), ...(opts.env ?? {}) }
      const r = await this.inner.commands.run(cmd, {
        cwd: opts.cwd,
        envs: env,
        timeoutMs: (opts.timeoutSec ?? this.config.resources.timeoutSec) * 1000,
        onStdout: opts.onStdout,
        onStderr: opts.onStderr,
      })
      return {
        exitCode: r.exitCode,
        stdout: redact(r.stdout),
        stderr: redact(r.stderr),
        durationMs: Date.now() - start,
      }
    } catch (err) {
      this.audit('error', { phase: 'exec', message: String(err).slice(0, 500) })
      throw new SandboxError('E2B exec failed', mapErrorCode(err), err)
    }
  }

  async writeFile(file: SandboxFileWrite): Promise<void> {
    this.assertAlive()
    if (!isWritable(file.path, this.config)) {
      this.audit('error', { phase: 'write', reason: 'POLICY_VIOLATION', path: file.path })
      throw new SandboxError(`Write outside writable scope: ${file.path}`, 'POLICY_VIOLATION')
    }
    await this.inner.files.write(file.path, file.content)
    this.audit('file_write', {
      path: file.path,
      bytes: typeof file.content === 'string' ? file.content.length : file.content.byteLength,
    })
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.assertAlive()
    if (!isReadable(path, this.config)) {
      this.audit('error', { phase: 'read', reason: 'POLICY_VIOLATION', path })
      throw new SandboxError(`Read outside readable scope: ${path}`, 'POLICY_VIOLATION')
    }
    const content = await this.inner.files.read(path)
    const bytes = new TextEncoder().encode(content)
    this.audit('file_read', { path, bytes: bytes.byteLength })
    return bytes
  }

  async listFiles(path: string): Promise<string[]> {
    this.assertAlive()
    const entries = await this.inner.files.list(path)
    return entries.map(e => e.name)
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.audit('destroy', { id: this.id })
    try {
      await this.inner.kill()
    } catch {
      // tolerate already-killed
    }
  }

  private audit(type: SandboxAuditEvent['type'], payload: Record<string, unknown>) {
    this.onAudit({ ts: new Date().toISOString(), type, payload })
  }

  private assertAlive() {
    if (this.destroyed) throw new SandboxError('sandbox already destroyed', 'INTERNAL')
  }
}

export interface E2BProviderOptions {
  apiKey?: string
}

/**
 * Creates an E2B-backed SandboxProvider. The SDK is loaded dynamically so this
 * file imports cleanly even when @e2b/code-interpreter is not installed.
 */
export function createE2BProvider(opts: E2BProviderOptions = {}): SandboxProvider {
  const apiKey = opts.apiKey ?? process.env.E2B_API_KEY
  return {
    name: 'e2b',
    async createSandbox(config, onAudit) {
      if (!apiKey) {
        throw new SandboxError(
          'E2B_API_KEY not set; add it to project_settings or env to use the e2b sandbox provider',
          'PROVIDER_UNAVAILABLE',
        )
      }
      let mod: { Sandbox: E2BSandboxClass }
      try {
        // @e2b/code-interpreter is an optional, worker-installed dep; not pinned
        // here so the package can build without the heavy native binary.
        // @ts-expect-error -- optional peer-style dep loaded at runtime
        mod = (await import('@e2b/code-interpreter')) as unknown as { Sandbox: E2BSandboxClass }
      } catch (err) {
        throw new SandboxError(
          '@e2b/code-interpreter is not installed. Run `pnpm add @e2b/code-interpreter` in the worker process.',
          'PROVIDER_UNAVAILABLE',
          err,
        )
      }
      onAudit({ ts: new Date().toISOString(), type: 'spawn', payload: { provider: 'e2b', image: config.image } })
      const inner = await mod.Sandbox.create(config.image, {
        apiKey,
        envs: config.credentials?.env,
        timeoutMs: config.resources.timeoutSec * 1000,
        firewall: {
          denyByDefault: config.network.denyByDefault,
          allow: config.network.allowedHosts,
        },
      })
      await inner.setTimeout(config.resources.timeoutSec * 1000)
      return new E2BSandbox(inner, config, onAudit)
    },
  }
}

function isWritable(path: string, config: SandboxConfig): boolean {
  if (config.filesystem.blocked.some(p => isWithinScope(path, p))) return false
  return config.filesystem.writable.some(p => isWithinScope(path, p))
}

function isReadable(path: string, config: SandboxConfig): boolean {
  if (config.filesystem.blocked.some(p => isWithinScope(path, p))) return false
  return config.filesystem.readable.some(p => isWithinScope(path, p))
}

/**
 * Returns true iff `target` is exactly `scope` or sits strictly underneath it.
 *
 * Both inputs are normalized as POSIX paths (collapsing `.`, `..`, and
 * duplicate slashes) so that:
 *
 *   - sibling directories sharing a prefix do not match (`/workspace` must NOT
 *     allow `/workspace-evil/secrets`); the check requires `scope + '/'` rather
 *     than a raw `startsWith`.
 *   - `..` traversal cannot escape the scope or evade a blocked path
 *     (`/workspace/../etc/passwd` resolves to `/etc/passwd` and is then
 *     correctly blocked).
 *
 * We intentionally avoid `node:path` here so the module stays portable across
 * Node, Deno, and bundler targets that don't ship a `path` polyfill.
 */
function isWithinScope(target: string, scope: string): boolean {
  const t = normalizePosixPath(target)
  const s = normalizePosixPath(scope)
  if (t === s) return true
  const boundary = s.endsWith('/') ? s : s + '/'
  return t.startsWith(boundary)
}

function normalizePosixPath(input: string): string {
  if (!input) return input
  const isAbsolute = input.startsWith('/')
  const stack: string[] = []
  for (const part of input.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') stack.pop()
      else if (!isAbsolute) stack.push('..')
      continue
    }
    stack.push(part)
  }
  const joined = stack.join('/')
  return isAbsolute ? '/' + joined : joined || '.'
}

function redact(s: string): string {
  if (!s) return s
  return s
    .replace(/(MUSHI_GIT_TOKEN=)[^\s]+/g, '$1[REDACTED]')
    .replace(/(ghp_|github_pat_|sk-)[A-Za-z0-9_]{16,}/g, '[REDACTED]')
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
}

function mapErrorCode(err: unknown): SandboxError['code'] {
  const m = String(err).toLowerCase()
  if (m.includes('timeout')) return 'TIMEOUT'
  if (m.includes('memory') || m.includes('oom')) return 'OOM'
  if (m.includes('network') || m.includes('blocked') || m.includes('denied')) return 'NETWORK_BLOCKED'
  return 'INTERNAL'
}
