/**
 * FILE: packages/agents/src/sandbox/types.ts
 * PURPOSE: Provider-agnostic interface for managed sandboxes used by agentic
 *          fix workers (V5.3 §2.10, M6). Adapters MUST implement this contract
 *          so the orchestrator can swap E2B / Modal / Cloudflare Sandbox SDK
 *          / local-noop without changing call sites.
 */

export interface SandboxResourceLimits {
  cpuCount: number
  memoryMb: number
  diskMb: number
  timeoutSec: number
}

export interface SandboxNetworkPolicy {
  /** Allowlist of FQDNs the sandbox may reach. Anything else MUST be denied. */
  allowedHosts: string[]
  /** When true, the adapter must enforce a deny-by-default egress firewall. */
  denyByDefault: boolean
}

export interface SandboxFsPolicy {
  /** Paths the agent may write to. Outside paths are read-only or denied. */
  writable: string[]
  /** Paths the agent may read. */
  readable: string[]
  /** Paths the adapter MUST block (e.g. /etc, host secrets). */
  blocked: string[]
}

export interface SandboxCredentials {
  /** Short-lived git token, scoped to push to mushi/fix-* refs only. */
  gitToken?: string
  /** Map of env vars to inject. The adapter MUST scrub these from logs. */
  env?: Record<string, string>
}

export interface SandboxExecOptions {
  cwd?: string
  /** Hard wall-clock timeout in seconds for this single command. */
  timeoutSec?: number
  /** Extra env on top of SandboxCredentials.env. */
  env?: Record<string, string>
  /** When true, the adapter SHOULD stream output to onStdout/onStderr. */
  stream?: boolean
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface SandboxExecResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface SandboxFileWrite {
  path: string
  content: string | Uint8Array
  mode?: number
}

export interface SandboxAuditEvent {
  ts: string
  /** Category of action; used for filtering in the audit table. */
  type: 'spawn' | 'exec' | 'network' | 'file_read' | 'file_write' | 'destroy' | 'error'
  /** Free-form payload describing the action. MUST NOT contain secrets. */
  payload: Record<string, unknown>
}

export interface SandboxConfig {
  /** Project-stable id; adapter MAY tag the underlying VM with it. */
  projectId: string
  /** Report id this sandbox is created for. */
  reportId: string
  /** Container image / template name (adapter-specific). */
  image: string
  resources: SandboxResourceLimits
  network: SandboxNetworkPolicy
  filesystem: SandboxFsPolicy
  credentials?: SandboxCredentials
}

/**
 * The minimum surface area an agent worker needs from a sandbox provider.
 * Implementations MUST emit audit events to onAudit (passed via createSandbox)
 * for every exec/network/file event so the orchestrator can persist them
 * to fix_sandbox_events.
 */
export interface Sandbox {
  /** Provider-assigned id (e.g. E2B sandboxId). */
  readonly id: string
  /** Original config the sandbox was launched with. */
  readonly config: SandboxConfig
  exec(cmd: string, opts?: SandboxExecOptions): Promise<SandboxExecResult>
  writeFile(file: SandboxFileWrite): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  listFiles(path: string): Promise<string[]>
  /** Force-terminate and free all resources. MUST be safe to call multiple times. */
  destroy(): Promise<void>
}

export interface SandboxProvider {
  /** Stable identifier — persisted in fix_sandbox_runs.provider for observability. */
  readonly name: 'e2b' | 'modal' | 'cloudflare' | 'local-noop'
  createSandbox(config: SandboxConfig, onAudit: (e: SandboxAuditEvent) => void): Promise<Sandbox>
}

export class SandboxError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PROVIDER_UNAVAILABLE'
      | 'POLICY_VIOLATION'
      | 'TIMEOUT'
      | 'OOM'
      | 'NETWORK_BLOCKED'
      | 'INTERNAL',
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SandboxError'
  }
}
