/**
 * FILE: packages/server/supabase/functions/_shared/setup-funnel.ts
 * PURPOSE: Fire-and-forget idempotent emits to setup_funnel_events.
 *
 * OVERVIEW:
 *   Centralises all writes to the setup_funnel_events table so every edge
 *   function can call a single typed helper rather than writing raw SQL.
 *   All emits are fire-and-forget — a failed write never blocks the caller.
 *   Idempotency is enforced by the table's UNIQUE (event_name, dedup_key)
 *   constraint; callers can retry freely.
 *
 * USAGE:
 *   import { emitFunnelEvent } from '../../_shared/setup-funnel.ts'
 *   await emitFunnelEvent(db, {
 *     userId: null,           // null OK for cli_auth_started
 *     eventName: 'cli_auth_started',
 *     dedupKey: deviceCode,
 *     source: 'api',
 *   })
 *
 * TECHNICAL DETAILS:
 *   Uses the `upsert_setup_funnel_event` DB function (migration 20260622100000)
 *   which wraps the INSERT … ON CONFLICT DO NOTHING in a SECURITY DEFINER
 *   function, keeping the call simple and RLS-safe.
 *
 * NOTES:
 *   - Every call is wrapped in try/catch; errors are logged but never re-thrown.
 *   - Callers MUST NOT await this function when it would block a user-facing
 *     response — fire-and-forget with `void`. Every emit registers itself with
 *     EdgeRuntime.waitUntil (_shared/background.ts keepAlive), so the write
 *     survives the response being sent.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { keepAlive } from './background.ts'

export type FunnelEventName =
  | 'cli_auth_started'
  | 'cli_auth_approved'
  | 'cli_auth_denied'
  | 'cli_auth_expired'
  | 'cli_auth_token_claimed'
  | 'cli_project_created'
  | 'cli_key_minted'
  | 'wizard_env_written'
  | 'sdk_first_heartbeat'
  // Console onboarding steps (CHECK widened in 20260921000002_company_funnel_rpc.sql).
  | 'console_project_created'
  | 'console_key_minted'
  | 'test_report_sent'
  // Written by POST /v1/admin/projects/:id/setup-funnel/diagnosis-viewed when
  // the console's first diagnosis renders; one row per project.
  | 'diagnosis_viewed'
  | 'mcp_setup_done'
  | 'mcp_first_tool_call'

export interface FunnelEventPayload {
  /** The user performing setup. NULL only for cli_auth_started (public endpoint). */
  userId: string | null
  /** The project being set up. NULL before a project is created. */
  projectId?: string | null
  eventName: FunnelEventName
  /** Natural dedup identifier for this (event, attempt). */
  dedupKey: string
  source?: 'cli' | 'console' | 'api'
  metadata?: Record<string, unknown>
}

/**
 * Emit an idempotent setup-funnel event. Never throws — errors are logged
 * and swallowed so callers can fire-and-forget safely; the write is kept
 * alive past the response even when the caller drops the promise.
 */
export function emitFunnelEvent(
  db: SupabaseClient,
  payload: FunnelEventPayload,
): Promise<void> {
  return keepAlive(writeFunnelEvent(db, payload))
}

async function writeFunnelEvent(
  db: SupabaseClient,
  payload: FunnelEventPayload,
): Promise<void> {
  try {
    const { error } = await db.rpc('upsert_setup_funnel_event', {
      p_user_id: payload.userId,
      p_project_id: payload.projectId ?? null,
      p_event_name: payload.eventName,
      p_dedup_key: payload.dedupKey,
      p_source: payload.source ?? 'api',
      p_metadata: payload.metadata ?? {},
    })
    if (error) {
      log.warn('setup-funnel: emit failed', { event: payload.eventName, error: error.message })
    }
  } catch (err) {
    log.warn('setup-funnel: unexpected error', {
      event: payload.eventName,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
