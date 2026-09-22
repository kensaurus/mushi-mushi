/**
 * FILE: packages/server/supabase/functions/_shared/product-events.ts
 * PURPOSE: Fire-and-forget server-side emits into product_events — the
 *          milestones only the backend can see (project_created, key_minted,
 *          first_report_received, fix_merged, upgrade_completed) plus MCP
 *          tool calls that count as "diagnosis consumed" (fix_context_pulled).
 *
 * Mirrors _shared/setup-funnel.ts: never throws, never awaited on a
 * user-facing path. Every emit registers itself with EdgeRuntime.waitUntil
 * (_shared/background.ts keepAlive), so `void emitProductEvent(...)` is safe
 * at any call site: the isolate is not shut down under a pending insert.
 * Until 2026-09-21 the nine `void` call sites relied on the isolate outliving
 * the response, which low-traffic functions (stripe-webhooks, mcp) do not.
 *
 * Company-funnel rows default to the mushi-self project
 * (secret MUSHI_SELF_PROJECT_ID). A console user id is resolved to an
 * end_users row under the self project's organization so identify() from the
 * console (mushi-self.ts) and server emits stitch to the same person.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { keepAlive } from './background.ts'
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
  if (_selfOrgId) void warnIfSelfOrgShared(db, _selfOrgId)
  return _selfOrgId
}

/**
 * end_users are organization-scoped: console users resolved here share a
 * namespace with every other project in the self organization. The self
 * project was moved into its own org on 2026-09-22 (migration
 * 20260922000018); a second project landing there silently re-mixes them.
 */
async function warnIfSelfOrgShared(db: SupabaseClient, orgId: string): Promise<void> {
  const { count, error } = await db
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
  if (!error && (count ?? 0) > 1) {
    log.error('product-events: self organization holds more than one project', { orgId, projects: count })
  }
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

let _demoProjectId: string | null | undefined

/**
 * True when this event is about the public /connect demo project
 * (mushi_runtime_config key 'demo_project_id'). Demo traffic is real people
 * trying the product, but it is one shared key and no account, so it must
 * not land on anyone's person row or count toward habit.
 */
async function isDemoProject(db: SupabaseClient, projectId: unknown): Promise<boolean> {
  if (typeof projectId !== 'string' || !projectId) return false
  if (_demoProjectId === undefined) {
    try {
      const { data } = await db
        .from('mushi_runtime_config')
        .select('value')
        .eq('key', 'demo_project_id')
        .maybeSingle()
      _demoProjectId = (data?.value as string | undefined) || null
    } catch (err) {
      // Never let a config read decide whether an event is recorded: the
      // worst case here is one demo row attributed, not a lost funnel.
      log.warn('product-events: demo project lookup failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }
  return _demoProjectId !== null && projectId === _demoProjectId
}

/** True when the mushi-self project is configured (company funnel enabled). */
export function isSelfFunnelConfigured(): boolean {
  return Boolean(SELF_PROJECT_ID)
}

/**
 * Emit one product event. Never throws. Returns true when a row was written.
 * The write is kept alive past the response even when the caller drops the
 * returned promise.
 */
export function emitProductEvent(db: SupabaseClient, payload: ProductEventPayload): Promise<boolean> {
  return keepAlive(writeProductEvent(db, payload))
}

async function writeProductEvent(db: SupabaseClient, payload: ProductEventPayload): Promise<boolean> {
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
    // The /connect demo runs on one shared read-only key, so a stranger's
    // tool call would otherwise land on the demo project owner's person row
    // and count as their habit. Tag it and attribute it to nobody.
    const onDemoProject = await isDemoProject(db, properties.project_id)
    let endUserId: string | null = null
    if (payload.userId && !onDemoProject && projectId === SELF_PROJECT_ID) {
      endUserId = await resolveSelfEndUser(db, payload.userId)
    }
    const { error } = await db.from('product_events').insert({
      project_id: projectId,
      event_name: payload.eventName,
      ts: payload.ts ?? new Date().toISOString(),
      session_id: payload.sessionId ?? null,
      anon_id: onDemoProject ? null : (payload.anonId ?? null),
      end_user_id: endUserId,
      surface: payload.surface,
      sdk_version: null,
      dedup_key: payload.dedupKey ?? null,
      properties: { ...properties, $surface: payload.surface, ...(onDemoProject ? { demo: true } : {}) },
      written_by: 'server',
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
