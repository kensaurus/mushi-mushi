/**
 * FILE: packages/agents/src/sandbox/local-noop.ts
 * PURPOSE: A non-isolated, in-process implementation used for tests and local
 *          dev only. MUST NOT be selected in production — the orchestrator
 *          refuses to use this provider when NODE_ENV === 'production' unless
 *          MUSHI_ALLOW_LOCAL_SANDBOX=1 is set.
 */

import type {
  Sandbox,
  SandboxAuditEvent,
  SandboxConfig,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFileWrite,
  SandboxProvider,
} from './types.js'

class LocalNoopSandbox implements Sandbox {
  readonly id: string
  readonly config: SandboxConfig
  private files = new Map<string, Uint8Array>()
  private destroyed = false
  private onAudit: (e: SandboxAuditEvent) => void

  constructor(config: SandboxConfig, onAudit: (e: SandboxAuditEvent) => void) {
    this.id = `local-${config.reportId.slice(0, 8)}-${Date.now()}`
    this.config = config
    this.onAudit = onAudit
    this.audit('spawn', { id: this.id, image: config.image })
  }

  async exec(cmd: string, _opts?: SandboxExecOptions): Promise<SandboxExecResult> {
    this.assertAlive()
    const start = Date.now()
    this.audit('exec', { cmd: redactCommand(cmd) })
    return {
      exitCode: 0,
      stdout: `[local-noop] would execute: ${redactCommand(cmd)}\n`,
      stderr: '',
      durationMs: Date.now() - start,
    }
  }

  async writeFile(file: SandboxFileWrite): Promise<void> {
    this.assertAlive()
    const bytes =
      typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content
    this.files.set(file.path, bytes)
    this.audit('file_write', { path: file.path, bytes: bytes.byteLength })
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.assertAlive()
    const bytes = this.files.get(path)
    if (!bytes) throw new Error(`local-noop: file not found: ${path}`)
    this.audit('file_read', { path, bytes: bytes.byteLength })
    return bytes
  }

  async listFiles(prefix: string): Promise<string[]> {
    this.assertAlive()
    return [...this.files.keys()].filter(p => p.startsWith(prefix))
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.audit('destroy', { id: this.id })
    this.files.clear()
  }

  private audit(type: SandboxAuditEvent['type'], payload: Record<string, unknown>) {
    this.onAudit({ ts: new Date().toISOString(), type, payload })
  }

  private assertAlive() {
    if (this.destroyed) throw new Error('local-noop sandbox already destroyed')
  }
}

function redactCommand(cmd: string): string {
  return cmd
    .replace(/(MUSHI_GIT_TOKEN=)[^\s]+/g, '$1[REDACTED]')
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(ghp_|github_pat_|sk-)[A-Za-z0-9_]{16,}/g, '[REDACTED]')
}

export const LocalNoopSandboxProvider: SandboxProvider = {
  name: 'local-noop',
  async createSandbox(config, onAudit) {
    return new LocalNoopSandbox(config, onAudit)
  },
}
