/**
 * FILE: packages/server/supabase/functions/_shared/product-events.ts
 * PURPOSE: Fire-and-forget server-side emits into product_events — the
 *          milestones only the backend can see (project_created, key_minted,
 *          first_report_received, fix_merged, upgrade_completed) plus MCP
 *          tool calls that count as "diagnosis consumed" (fix_context_pulled).
 *
 * Mirrors _shared/setup-funnel.ts: never throws, never awaited on a
 * user-facing path (use `void` or `c.executionCtx.waitUntil`).
 *
 * Company-funnel rows default to the mushi-self project
 * (secret MUSHI_SELF_PROJECT_ID). A console user id is resolved to an
 * end_users row under the self project's organization so identify() from the
 * console (mushi-self.ts) and server emits stitch to the same person.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import {
  EVENT_PROPERTY_LIMITS,
  isValidEventName,
  type MushiEventName,
  type MushiSurface,
} from './analytics-taxonomy.generated.ts'

export interface ProductEventPayload {
  /** Defaults to MUSHI_SELF_PROJECT_ID (Mushi's own funnel). */
  projectId?: string | null
  /** Console (auth.users) id — resolved to end_users under the self org. */
  userId?: string | null
  /** Opaque per-project reporter token when known (docs/console browser). */
  anonId?: string | null
  sessionId?: string | null
  eventName: MushiEventName | string
  properties?: Record<string, string | number | boolean | null>
  surface: MushiSurface
  /** Idempotency key — unique per (project_id, dedup_key). */
  dedupKey?: string | null
  ts?: string
}

const SELF_PROJECT_ID = Deno.env.get('MUSHI_SELF_PROJECT_ID') ?? null
let _selfOrgId: string | null | undefined

async function selfOrganizationId(db: SupabaseClient): Promise<string | null> {
  if (_selfOrgId !== undefined) return _selfOrgId
  if (!SELF_PROJECT_ID) { _selfOrgId = null; return null }
  const { data } = await db
    .from('projects')
    .select('organization_id')
    .eq('id', SELF_PROJECT_ID)
    .maybeSingle()
  _selfOrgId = (data?.organization_id as string | undefined) ?? null
  return _selfOrgId
}

/**
 * Resolve a console user to an end_users row under the self organization.
 * external_user_id = auth.users.id so the console's identify(user.id) and
 * server emits agree on the person key.
 */
export async function resolveSelfEndUser(db: SupabaseClient, userId: string): Promise<string | null> {
  const orgId = await selfOrganizationId(db)
  if (!orgId) return null
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('end_users')
    .upsert(
      {
        organization_id: orgId,
        external_user_id: userId,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'organization_id,external_user_id' },
    )
    .select('id')
    .maybeSingle()
  if (error) {
    log.warn('product-events: self end_user upsert failed', { error: error.message })
    return null
  }
  return (data?.id as string | undefined) ?? null
}

/** True when the mushi-self project is configured (company funnel enabled). */
export function isSelfFunnelConfigured(): boolean {
  return Boolean(SELF_PROJECT_ID)
}

/**
 * Emit one product event. Never throws. Returns true when a row was written.
 */
export async function emitProductEvent(db: SupabaseClient, payload: ProductEventPayload): Promise<boolean> {
  try {
    const projectId = payload.projectId ?? SELF_PROJECT_ID
    if (!projectId) return false
    if (!isValidEventName(payload.eventName)) {
      log.warn('product-events: invalid event name', { event: payload.eventName })
      return false
    }
    const properties = payload.properties ?? {}
    if (JSON.stringify(properties).length > EVENT_PROPERTY_LIMITS.maxBytes) {
      log.warn('product-events: properties too large', { event: payload.eventName })
      return false
    }
    let endUserId: string | null = null
    if (payload.userId && projectId === SELF_PROJECT_ID) {
      endUserId = await resolveSelfEndUser(db, payload.userId)
    }
    const { error } = await db.from('product_events').insert({
      project_id: projectId,
      event_name: payload.eventName,
      ts: payload.ts ?? new Date().toISOString(),
      session_id: payload.sessionId ?? null,
      anon_id: payload.anonId ?? null,
      end_user_id: endUserId,
      surface: payload.surface,
      sdk_version: null,
      dedup_key: payload.dedupKey ?? null,
      properties: { ...properties, $surface: payload.surface },
    })
    if (error) {
      // 23505 = unique violation on (project_id, dedup_key): idempotent replay, not a failure.
      if (error.code === '23505') return false
      log.warn('product-events: insert failed', { event: payload.eventName, error: error.message })
      return false
    }
    return true
  } catch (err) {
    log.warn('product-events: unexpected error', {
      event: payload.eventName,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
