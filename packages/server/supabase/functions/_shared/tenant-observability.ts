/**
 * FILE: packages/server/supabase/functions/_shared/tenant-observability.ts
 * PURPOSE: Tenant-aware logging context, audit helpers, and scoped rate limits.
 *
 * OVERVIEW:
 * - Attaches org/project ids to structured logs for admin API requests
 * - Wraps scoped_rate_limit_claim for per-tenant throttling
 * - Provides org-anchored audit events that survive project deletion
 *
 * DEPENDENCIES:
 * - logger.ts, audit.ts, db.ts (Supabase service client)
 *
 * USAGE:
 * - Import from route handlers after auth resolves org/project context
 */

import type { Context } from 'npm:hono@4';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log } from './logger.ts';
import type { AuditAction } from './audit.ts';
import { logAudit } from './audit.ts';

const tenantLog = log.child('tenant');

export interface TenantLogContext {
  organizationId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  authMethod?: string | null;
  path?: string;
  method?: string;
}

/** Stamp tenant context on structured logs for support filtering. */
export function logTenantContext(ctx: TenantLogContext): void {
  tenantLog.info('request.context', {
    organizationId: ctx.organizationId ?? null,
    projectId: ctx.projectId ?? null,
    userId: ctx.userId ?? null,
    authMethod: ctx.authMethod ?? null,
    path: ctx.path ?? null,
    method: ctx.method ?? null,
  });
}

/** Read org/project from Hono context after scope helpers run. */
export function tenantContextFromHono(c: Context): TenantLogContext {
  return {
    organizationId: (c.get('organizationId') as string | undefined) ?? null,
    projectId: (c.get('projectId') as string | undefined) ?? null,
    userId: (c.get('userId') as string | undefined) ?? null,
    authMethod: (c.get('authMethod') as string | undefined) ?? null,
    path: c.req.path,
    method: c.req.method,
  };
}

export interface ScopedRateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

/**
 * Fold an opaque scope key into the 8-4-4-4-12 hex shape Postgres's `uuid`
 * type accepts. `scoped_rate_limits.user_id` is an opaque actor bucket, not a
 * real `auth.users` id — see 20260702035407_scoped_rate_limits_generalize_actor.sql
 * — so a SHA-256 of the scope key is a valid actor. Mirrors
 * `ipRateLimitActorId()` in api/routes/cli-auth.ts.
 */
export async function rateLimitActorId(scopeKey: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scopeKey));
  const hex = Array.from(new Uint8Array(hash).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Per-tenant rate limit via the `scoped_rate_limit_claim` RPC.
 * scopeKey examples: `org:{id}:invite`, `project:{id}:sdk_upgrade`.
 *
 * The RPC signature is
 * `(p_user_id uuid, p_scope text, p_max_per_window integer, p_window interval)`.
 * This helper previously called it as `(p_scope_key, p_limit, p_window_sec)`,
 * which does not exist: PostgREST answered "Could not find the function ... in
 * the schema cache" on every call, the error fell through to the fail-open
 * branch, and every limit routed through here — voice intake burst, skill
 * pipeline starts, push self-test — was silently disabled. That is the same
 * failure the generalize-actor migration was written to fix, so the unexpected
 * -error branch now logs at error level to keep a future signature drift loud.
 */
export async function claimTenantRateLimit(
  db: SupabaseClient,
  scopeKey: string,
  limit: number,
  windowSec: number,
): Promise<ScopedRateLimitResult> {
  const { error } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: await rateLimitActorId(scopeKey),
    p_scope: scopeKey,
    p_max_per_window: limit,
    p_window: `${windowSec} seconds`,
  });
  if (!error) return { allowed: true };
  const msg = error.message ?? '';
  if (msg.includes('rate_limit_exceeded')) {
    const match = msg.match(/retry_after=(\d+)/);
    return { allowed: false, retryAfterSec: match ? parseInt(match[1]!, 10) : windowSec };
  }
  // Fail open on genuine infra errors so a database blip cannot lock out
  // legitimate traffic — but log loudly, because a silent fail-open here is
  // indistinguishable from having no rate limit at all.
  tenantLog.error('scoped_rate_limit_claim failed — allowing request', { scopeKey, err: msg });
  return { allowed: true };
}

export interface OrgAuditInput {
  organizationId: string;
  projectId?: string | null;
  actorId: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write org-anchored audit row. Uses project_id when available; org_id column
 * preserves the event if the project is later deleted.
 */
export async function logOrgAudit(db: SupabaseClient, input: OrgAuditInput): Promise<void> {
  const {
    organizationId,
    projectId,
    actorId,
    action,
    resourceType,
    resourceId,
    metadata,
  } = input;

  tenantLog.audit(action, {
    organizationId,
    projectId: projectId ?? null,
    actorId,
    resourceType,
    resourceId,
  });

  if (projectId) {
    await logAudit(db, projectId, actorId, action, resourceType, resourceId, {
      ...metadata,
      organization_id: organizationId,
    });
  }

  await db.from('org_audit_events').insert({
    organization_id: organizationId,
    project_id: projectId ?? null,
    actor_id: actorId,
    action,
    resource_type: resourceType,
    resource_id: resourceId ?? null,
    metadata: metadata ?? {},
  }).then(({ error }) => {
    if (error) tenantLog.error('org_audit_events insert failed', { action, err: error.message });
  });
}

/** Queue fairness: count pending/running jobs for a project. */
export async function countActiveJobsForProject(
  db: SupabaseClient,
  table: string,
  projectId: string,
  activeStatuses: string[],
): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .in('status', activeStatuses);
  if (error) {
    tenantLog.warn('countActiveJobsForProject failed', { table, projectId, err: error.message });
    return 0;
  }
  return count ?? 0;
}
