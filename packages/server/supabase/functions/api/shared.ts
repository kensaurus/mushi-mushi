import type { Context } from 'npm:hono@4';
import { getServiceClient } from '../_shared/db.ts';
import { reportError } from '../_shared/sentry.ts';

/**
 * capture a Supabase / Postgres error to Sentry AND return the
 * canonical 500 JSON response in one call. Most DB errors here returned
 * `c.json({ ok: false, error: { code: 'DB_ERROR', ... } }, 500)` directly
 * which sidesteps Hono's `app.onError` (no throw → no capture). That made
 * production drift like the 04-20 `nl_query_history.is_saved` 500 invisible
 * to Sentry. This helper centralises both behaviours so missing-column /
 * RLS / pool-exhaustion failures all page someone going forward.
 *
 * Postgres error codes propagate through `code` so Sentry filters can
 * single out e.g. `42703` (undefined column) vs `42501` (permission).
 */
export function dbError(
  c: Context,
  err:
    | { message?: string; code?: string; details?: string | null; hint?: string | null }
    | null
    | undefined,
): Response {
  const captured = err instanceof Error ? err : new Error(err?.message ?? 'Unknown DB error');
  reportError(captured, {
    tags: {
      path: c.req.path,
      method: c.req.method,
      db_code: err?.code ?? 'unknown',
      error_type: 'db',
    },
    extra: {
      pg_code: err?.code ?? null,
      pg_details: err?.details ?? null,
      pg_hint: err?.hint ?? null,
    },
  });
  return c.json(
    { ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'Unknown DB error' } },
    500,
  );
}

// Resolve the set of project ids visible to the authenticated user. Teams v1
// scopes new access through organizations; the legacy owner_id fallback stays
// during migration so existing unbackfilled dev databases keep working.
export async function accessibleProjectIds(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<string[]> {
  const [{ data: memberships }, { data: owned }] = await Promise.all([
    db.from('organization_members').select('organization_id').eq('user_id', userId),
    db.from('projects').select('id').eq('owner_id', userId),
  ]);

  const orgIds = (memberships ?? []).map((m) => m.organization_id).filter(Boolean);
  const ids = new Set<string>((owned ?? []).map((p) => p.id));

  if (orgIds.length > 0) {
    const { data: projects } = await db.from('projects').select('id').in('organization_id', orgIds);
    for (const p of projects ?? []) ids.add(p.id);
  }

  return Array.from(ids);
}

export const ownedProjectIds = accessibleProjectIds;

export interface OwnedProjectRef {
  id: string;
  name?: string | null;
  organization_id?: string | null;
  organization_role?: string | null;
}

export type OwnedProjectResolution =
  | { project: OwnedProjectRef; explicit: boolean }
  | { response: Response };

export interface ResolveOwnedProjectOptions {
  noProjectResponse?: () => Response;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestedProjectId(c: Context): string | null {
  return (
    c.req.query('project_id') ??
    c.req.query('projectId') ??
    c.req.header('x-mushi-project-id') ??
    c.req.header('x-project-id') ??
    null
  );
}

function requestedOrganizationId(c: Context): string | null {
  return (
    c.req.query('organization_id') ??
    c.req.query('organizationId') ??
    c.req.header('x-mushi-org-id') ??
    c.req.header('x-organization-id') ??
    null
  );
}

/**
 * Resolve the admin's active project consistently across route modules.
 *
 * New admin builds send `X-Mushi-Project-Id` based on ProjectSwitcher. Older
 * deployed builds did not, so we keep the previous "first owned project"
 * fallback for backward compatibility while validating explicit ids strictly.
 */
export async function resolveOwnedProject(
  c: Context,
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  options: ResolveOwnedProjectOptions = {},
): Promise<OwnedProjectResolution> {
  const requested = requestedProjectId(c);
  const requestedOrg = requestedOrganizationId(c);
  if (requested && !UUID_RE.test(requested)) {
    return {
      response: c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'project_id must be a UUID' } },
        400,
      ),
    };
  }
  if (requestedOrg && !UUID_RE.test(requestedOrg)) {
    return {
      response: c.json(
        {
          ok: false,
          error: { code: 'INVALID_ORGANIZATION_ID', message: 'organization_id must be a UUID' },
        },
        400,
      ),
    };
  }

  const { data: memberships } = await db
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', userId);
  const rolesByOrg = new Map<string, string>();
  for (const m of memberships ?? []) rolesByOrg.set(m.organization_id, m.role);
  const orgIds = Array.from(rolesByOrg.keys());

  let project: OwnedProjectRef | null = null;

  if (orgIds.length > 0) {
    let query = db
      .from('projects')
      .select('id, name, organization_id')
      .in('organization_id', orgIds)
      .order('created_at', { ascending: true });
    if (requested) query = query.eq('id', requested);
    if (requestedOrg) query = query.eq('organization_id', requestedOrg);
    const { data } = await query.limit(1).maybeSingle();
    if (data) {
      project = {
        ...data,
        organization_role: data.organization_id ? rolesByOrg.get(data.organization_id) ?? null : null,
      };
    }
  }

  if (!project) {
    // Legacy fallback: pre-org dev DB or account created before the backfill.
    let query = db.from('projects').select('id, name, organization_id').eq('owner_id', userId);
    if (requested) query = query.eq('id', requested);
    if (requestedOrg) query = query.eq('organization_id', requestedOrg);
    const { data } = await query.limit(1).maybeSingle();
    if (data) project = { ...data, organization_role: 'owner' };
  }

  if (!project) {
    if (!requested && options.noProjectResponse) {
      return { response: options.noProjectResponse() };
    }
    return {
      response: c.json(
        {
          ok: false,
          error: {
            code: requested ? 'PROJECT_NOT_FOUND' : 'NO_PROJECT',
            message: requested ? 'Project not found' : 'No project',
          },
        },
        404,
      ),
    };
  }

  if (project.organization_id) c.set('organizationId', project.organization_id);
  c.set('projectId', project.id);
  return { project, explicit: Boolean(requested) };
}

export const resolveAccessibleProject = resolveOwnedProject;
