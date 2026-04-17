/**
 * FILE: packages/agents/src/sandbox/persistence.ts
 * PURPOSE: Persist sandbox runs and audit events to Supabase (V5.3 §2.10, M6).
 *          Buffered insert to avoid one round-trip per event under heavy load.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SandboxAuditEvent, SandboxConfig } from './types.js'

const FLUSH_THRESHOLD = 25

export class SandboxAuditWriter {
  private buffer: Array<{
    sandbox_run_id: string
    project_id: string
    ts: string
    event_type: SandboxAuditEvent['type']
    payload: Record<string, unknown>
  }> = []

  constructor(
    private db: SupabaseClient,
    private sandboxRunId: string,
    private projectId: string,
  ) {}

  push(event: SandboxAuditEvent): void {
    this.buffer.push({
      sandbox_run_id: this.sandboxRunId,
      project_id: this.projectId,
      ts: event.ts,
      event_type: event.type,
      payload: event.payload,
    })
    if (this.buffer.length >= FLUSH_THRESHOLD) {
      // Background flush: must never reject on its own promise. flush() throws
      // on insert failure (after re-buffering the rows for retry), and Node 22
      // defaults to --unhandled-rejections=throw, which would crash the worker
      // mid-fix. The audit subsystem is best-effort by design — log and move on.
      // The next push() (or destroy()) will retry the same rows.
      this.flush().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[sandbox-audit] background flush failed (will retry on next push): ${msg}`)
      })
    }
  }

  /**
   * Drains the buffer into `fix_sandbox_events`. Re-buffers and throws on
   * failure so callers (e.g., destroy) can decide whether to abort. Background
   * callers from `push()` MUST attach a `.catch()` — see push().
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const rows = this.buffer.splice(0, this.buffer.length)
    const { error } = await this.db.from('fix_sandbox_events').insert(rows)
    if (error) {
      this.buffer.unshift(...rows)
      throw new Error(`Failed to persist sandbox events: ${error.message}`)
    }
  }
}

export interface CreateSandboxRunRow {
  projectId: string
  fixAttemptId?: string
  reportId?: string
  provider: 'local-noop' | 'e2b' | 'modal' | 'cloudflare'
  config: SandboxConfig
}

export async function insertSandboxRun(
  db: SupabaseClient,
  row: CreateSandboxRunRow,
): Promise<string> {
  const { data, error } = await db
    .from('fix_sandbox_runs')
    .insert({
      project_id: row.projectId,
      fix_attempt_id: row.fixAttemptId,
      report_id: row.reportId,
      provider: row.provider,
      image: row.config.image,
      cpu_count: row.config.resources.cpuCount,
      memory_mb: row.config.resources.memoryMb,
      disk_mb: row.config.resources.diskMb,
      timeout_sec: row.config.resources.timeoutSec,
      network_deny_by_default: row.config.network.denyByDefault,
      network_allowed_hosts: row.config.network.allowedHosts,
      status: 'starting',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Failed to insert sandbox run: ${error?.message ?? 'unknown'}`)
  return data.id as string
}

export async function updateSandboxRun(
  db: SupabaseClient,
  id: string,
  patch: {
    status?: 'starting' | 'running' | 'completed' | 'failed' | 'killed' | 'timeout'
    providerSandboxId?: string
    error?: string
    finishedAt?: string
  },
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (patch.status) update.status = patch.status
  if (patch.providerSandboxId) update.provider_sandbox_id = patch.providerSandboxId
  if (patch.error !== undefined) update.error = patch.error
  if (patch.finishedAt) update.finished_at = patch.finishedAt
  if (Object.keys(update).length === 0) return
  const { error } = await db.from('fix_sandbox_runs').update(update).eq('id', id)
  if (error) throw new Error(`Failed to update sandbox run: ${error.message}`)
}
