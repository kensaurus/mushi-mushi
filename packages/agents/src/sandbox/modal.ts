/**
 * FILE: packages/agents/src/sandbox/modal.ts
 * PURPOSE: Modal Sandboxes adapter (V5.3 §2.10, M6+).
 *
 * Modal exposes a remote sandbox API via REST + JSON. We don't pull modal-py
 * — instead we hit the documented HTTPS endpoints directly so this provider
 * can run in any worker (Node, Edge, Deno) without a Python runtime.
 *
 * Endpoints we use:
 *   POST   /v1/sandboxes              create
 *   POST   /v1/sandboxes/:id/exec     run a command, returns {exit_code, stdout, stderr}
 *   POST   /v1/sandboxes/:id/files    write file
 *   GET    /v1/sandboxes/:id/files    read / list
 *   DELETE /v1/sandboxes/:id          terminate
 *
 * Auth: Bearer token from Modal account (per-team, scoped to "sandbox.write").
 *
 * Network policy: Modal supports per-sandbox egress allowlists via
 * `network: { allowed_hosts: [...] }`. We set deny_by_default = true.
 */

import {
  SandboxError,
  type Sandbox,
  type SandboxAuditEvent,
  type SandboxConfig,
  type SandboxExecOptions,
  type SandboxExecResult,
  type SandboxFileWrite,
  type SandboxProvider,
} from './types.js'

const DEFAULT_ENDPOINT = 'https://api.modal.com'

export interface ModalProviderOptions {
  apiKey?: string
  endpoint?: string
  fetchImpl?: typeof fetch
}

interface ModalCreateResponse {
  sandbox_id: string
}

interface ModalExecResponse {
  exit_code: number
  stdout: string
  stderr: string
}

interface ModalListEntry {
  name: string
  type: 'file' | 'dir'
}

class ModalSandbox implements Sandbox {
  readonly id: string
  readonly config: SandboxConfig
  private destroyed = false

  constructor(
    sandboxId: string,
    config: SandboxConfig,
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
    private readonly onAudit: (e: SandboxAuditEvent) => void,
  ) {
    this.id = sandboxId
    this.config = config
  }

  async exec(cmd: string, opts: SandboxExecOptions = {}): Promise<SandboxExecResult> {
    this.assertAlive()
    const start = Date.now()
    this.audit('exec', { cmd: redact(cmd), cwd: opts.cwd })
    const env = { ...(this.config.credentials?.env ?? {}), ...(opts.env ?? {}) }
    const timeoutSec = opts.timeoutSec ?? this.config.resources.timeoutSec
    try {
      const res = await this.req(`/v1/sandboxes/${encodeURIComponent(this.id)}/exec`, {
        method: 'POST',
        body: JSON.stringify({
          command: cmd,
          cwd: opts.cwd,
          env,
          timeout_sec: timeoutSec,
        }),
      })
      const body = await parseJson<ModalExecResponse>(res)
      return {
        exitCode: body.exit_code,
        stdout: redact(body.stdout ?? ''),
        stderr: redact(body.stderr ?? ''),
        durationMs: Date.now() - start,
      }
    } catch (err) {
      this.audit('error', { phase: 'exec', message: String(err).slice(0, 500) })
      throw new SandboxError('Modal exec failed', mapErrorCode(err), err)
    }
  }

  async writeFile(file: SandboxFileWrite): Promise<void> {
    this.assertAlive()
    if (!isWritable(file.path, this.config)) {
      this.audit('error', { phase: 'write', reason: 'POLICY_VIOLATION', path: file.path })
      throw new SandboxError(`Write outside writable scope: ${file.path}`, 'POLICY_VIOLATION')
    }
    const content = typeof file.content === 'string'
      ? file.content
      : encodeBase64(file.content)
    const encoding = typeof file.content === 'string' ? 'utf-8' : 'base64'
    await this.req(`/v1/sandboxes/${encodeURIComponent(this.id)}/files`, {
      method: 'POST',
      body: JSON.stringify({ path: file.path, content, encoding, mode: file.mode }),
    })
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
    const res = await this.req(
      `/v1/sandboxes/${encodeURIComponent(this.id)}/files?path=${encodeURIComponent(path)}`,
      { method: 'GET' },
    )
    const body = await parseJson<{ content: string; encoding: 'utf-8' | 'base64' }>(res)
    const bytes = body.encoding === 'base64'
      ? decodeBase64(body.content)
      : new TextEncoder().encode(body.content)
    this.audit('file_read', { path, bytes: bytes.byteLength })
    return bytes
  }

  async listFiles(path: string): Promise<string[]> {
    this.assertAlive()
    const res = await this.req(
      `/v1/sandboxes/${encodeURIComponent(this.id)}/files?path=${encodeURIComponent(path)}&list=1`,
      { method: 'GET' },
    )
    const body = await parseJson<{ entries: ModalListEntry[] }>(res)
    return (body.entries ?? []).map(e => e.name)
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.audit('destroy', { id: this.id })
    try {
      await this.req(`/v1/sandboxes/${encodeURIComponent(this.id)}`, { method: 'DELETE' })
    } catch {
      // tolerate already-terminated
    }
  }

  private async req(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(`${this.endpoint}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.headers ?? {}),
      },
    })
  }

  private audit(type: SandboxAuditEvent['type'], payload: Record<string, unknown>) {
    this.onAudit({ ts: new Date().toISOString(), type, payload })
  }

  private assertAlive() {
    if (this.destroyed) throw new SandboxError('sandbox already destroyed', 'INTERNAL')
  }
}

export function createModalProvider(opts: ModalProviderOptions = {}): SandboxProvider {
  const apiKey = opts.apiKey ?? process.env.MODAL_API_TOKEN
  const endpoint = (opts.endpoint ?? process.env.MODAL_API_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, '')
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    name: 'modal',
    async createSandbox(config, onAudit) {
      if (!apiKey) {
        throw new SandboxError(
          'MODAL_API_TOKEN not set; add it to project_settings or env to use the modal sandbox provider',
          'PROVIDER_UNAVAILABLE',
        )
      }
      onAudit({ ts: new Date().toISOString(), type: 'spawn', payload: { provider: 'modal', image: config.image } })
      const res = await fetchImpl(`${endpoint}/v1/sandboxes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          image: config.image,
          cpu: config.resources.cpuCount,
          memory_mb: config.resources.memoryMb,
          disk_mb: config.resources.diskMb,
          timeout_sec: config.resources.timeoutSec,
          env: config.credentials?.env ?? {},
          network: {
            deny_by_default: config.network.denyByDefault,
            allowed_hosts: config.network.allowedHosts,
          },
          tags: { project_id: config.projectId, report_id: config.reportId },
        }),
      })
      if (!res.ok) {
        const body = await safeText(res)
        throw new SandboxError(
          `Modal sandbox create failed (${res.status}): ${body.slice(0, 200)}`,
          res.status === 401 || res.status === 403 ? 'PROVIDER_UNAVAILABLE' : 'INTERNAL',
        )
      }
      const body = await parseJson<ModalCreateResponse>(res)
      return new ModalSandbox(body.sandbox_id, config, endpoint, apiKey, fetchImpl, onAudit)
    },
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await safeText(res)
    throw new SandboxError(
      `Modal API ${res.status}: ${body.slice(0, 200)}`,
      mapStatusToCode(res.status),
    )
  }
  return res.json() as Promise<T>
}

function safeText(res: Response): Promise<string> {
  return res.text().catch(() => '')
}

function mapStatusToCode(status: number): SandboxError['code'] {
  if (status === 401 || status === 403) return 'PROVIDER_UNAVAILABLE'
  if (status === 408 || status === 504) return 'TIMEOUT'
  if (status === 451) return 'NETWORK_BLOCKED'
  return 'INTERNAL'
}

function isWritable(path: string, config: SandboxConfig): boolean {
  if (config.filesystem.blocked.some(p => isWithinScope(path, p))) return false
  return config.filesystem.writable.some(p => isWithinScope(path, p))
}

function isReadable(path: string, config: SandboxConfig): boolean {
  if (config.filesystem.blocked.some(p => isWithinScope(path, p))) return false
  return config.filesystem.readable.some(p => isWithinScope(path, p))
}

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
    .replace(/(ghp_|github_pat_|sk-|modal_)[A-Za-z0-9_]{16,}/g, '[REDACTED]')
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
}

function mapErrorCode(err: unknown): SandboxError['code'] {
  if (err instanceof SandboxError) return err.code
  const m = String(err).toLowerCase()
  if (m.includes('timeout')) return 'TIMEOUT'
  if (m.includes('memory') || m.includes('oom')) return 'OOM'
  if (m.includes('network') || m.includes('blocked') || m.includes('denied')) return 'NETWORK_BLOCKED'
  return 'INTERNAL'
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64')
}

function decodeBase64(input: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(input)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(input, 'base64'))
}
