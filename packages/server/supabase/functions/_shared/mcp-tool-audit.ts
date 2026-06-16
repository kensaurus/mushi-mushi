/**
 * FILE: mcp-tool-audit.ts
 * PURPOSE: Structured logging + DB persistence for MCP tool invocations.
 *
 * OVERVIEW:
 * - Fingerprints tool args by shape (key + typeof) — never stores values
 * - Fire-and-forget insert into mcp_tool_invocations (hosted transport)
 * - Emits audit-channel logs for grep-friendly trails
 *
 * DEPENDENCIES:
 * - getServiceClient, logAudit (optional audit_logs row)
 * - logger.ts audit channel
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { logAudit, type AuditAction } from './audit.ts'
import { getServiceClient } from './db.ts'
import { log } from './logger.ts'

const mcpToolLog = log.child('mcp:tool')

export type McpTransport = 'hosted' | 'stdio'

export interface McpToolInvocationInput {
  projectId?: string | null
  apiKeyId?: string | null
  toolName: string
  scope?: string | null
  transport: McpTransport
  status: 'ok' | 'error'
  durationMs: number
  requestId?: string | null
  args?: Record<string, unknown>
  errorCode?: string | null
  /** When set, also writes audit_logs via logAudit (hosted write tools). */
  audit?: {
    actorId: string
    action?: AuditAction
  }
}

/** SHA-256 (hex, first 16 chars) of sorted arg key:type pairs — no values. */
export async function fingerprintToolArgs(
  args: Record<string, unknown> | undefined,
): Promise<string | null> {
  if (!args || Object.keys(args).length === 0) return null
  const shape = Object.keys(args)
    .sort()
    .map((key) => {
      const value = args[key]
      const type =
        value === null ? 'null'
        : Array.isArray(value) ? 'array'
        : typeof value
      return `${key}:${type}`
    })
    .join(',')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shape))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

/**
 * Record a tool invocation — structured log always; DB row for hosted only.
 * Never throws; failures are logged and swallowed.
 */
export async function recordMcpToolInvocation(input: McpToolInvocationInput): Promise<void> {
  const argsFingerprint = await fingerprintToolArgs(input.args)
  const meta = {
    toolName: input.toolName,
    projectId: input.projectId ?? undefined,
    scope: input.scope ?? undefined,
    transport: input.transport,
    status: input.status,
    durationMs: input.durationMs,
    requestId: input.requestId ?? undefined,
    argsFingerprint: argsFingerprint ?? undefined,
    errorCode: input.errorCode ?? undefined,
  }

  if (input.status === 'ok') {
    mcpToolLog.info('tool.done', meta)
  } else {
    mcpToolLog.warn('tool.failed', meta)
  }

  if (input.transport !== 'hosted') return

  try {
    const db = getServiceClient()
    const { error } = await db.from('mcp_tool_invocations').insert({
      project_id: input.projectId ?? null,
      api_key_id: input.apiKeyId ?? null,
      tool_name: input.toolName,
      scope: input.scope ?? null,
      transport: input.transport,
      status: input.status,
      duration_ms: input.durationMs,
      request_id: input.requestId ?? null,
      args_fingerprint: argsFingerprint,
      error_code: input.errorCode ?? null,
    })
    if (error) {
      mcpToolLog.error('tool.persist_failed', { ...meta, err: error.message })
    }
  } catch (err) {
    mcpToolLog.error('tool.persist_failed', { ...meta, err: String(err) })
  }

  if (input.audit?.actorId && input.projectId && input.status === 'ok') {
    const action: AuditAction = input.audit.action ?? 'mcp.tool_called'
    await logAudit(
      getServiceClient(),
      input.projectId,
      input.audit.actorId,
      action,
      'mcp_tool',
      input.toolName,
      { argsFingerprint, requestId: input.requestId, scope: input.scope },
      { actorType: 'api_key' },
    ).catch(() => {
      /* logAudit already logs insert failures */
    })
  }
}
