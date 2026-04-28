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

// Resolve the set of project ids visible to the authenticated user. There
// are three concurrent sources of "I can see this project" the api has to
// honour:
//
//   1. `projects.owner_id == userId` — legacy / pre-Teams-v1 ownership
//      (also still the source of truth for projects created without an org).
//   2. `organization_members.user_id == userId` — Teams v1 grants access to
//      every project under the joined org. Pro+ feature.
//   3. `project_members.user_id == userId` — per-project membership rows
//      (predates Teams v1; still used by /v1/admin/fixes & dispatch gates,
//      and seeded when a user creates a project).
//
// All three union together. Without this every team member would silently
// see "0 projects" on the relevant page even though /v1/admin/projects
// correctly enumerates the org-scoped set (the bug I fixed in PR #69 only
// addressed the projects-list endpoint; this one fixes the rest).
export async function accessibleProjectIds(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<string[]> {
  const [
    { data: orgMemberships },
    { data: projectMemberships },
    { data: owned },
  ] = await Promise.all([
    db.from('organization_members').select('organization_id').eq('user_id', userId),
    db.from('project_members').select('project_id').eq('user_id', userId),
    db.from('projects').select('id').eq('owner_id', userId),
  ]);

  const ids = new Set<string>();
  for (const p of owned ?? []) ids.add(p.id);
  for (const m of projectMemberships ?? []) ids.add(m.project_id);

  const orgIds = (orgMemberships ?? []).map((m) => m.organization_id).filter(Boolean);
  if (orgIds.length > 0) {
    const { data: projects } = await db.from('projects').select('id').in('organization_id', orgIds);
    for (const p of projects ?? []) ids.add(p.id);
  }

  return Array.from(ids);
}

export const ownedProjectIds = accessibleProjectIds;

/**
 * Single-project authorization check used by detail/mutation endpoints.
 *
 * Returns whether the caller can act on a specific project plus the
 * caller's effective role. Three paths to "allowed", in priority order:
 *
 *   1. `projects.owner_id == userId` — role is reported as 'owner'.
 *   2. The project belongs to an organization the caller is a member of —
 *      role is the org membership role ('owner' | 'admin' | 'member' |
 *      'viewer'). This is the Teams v1 path.
 *   3. The caller has an explicit `project_members` row — role is
 *      whatever project_members.role says.
 *
 * Endpoints that need write semantics should additionally check that the
 * returned role is in {'owner','admin'}; this helper deliberately does
 * NOT enforce that so the same primitive serves read/list/dispatch/etc.
 *
 * Returns `{ allowed: false, role: null }` when the project doesn't exist
 * or the caller has no relationship to it. Callers translate that to a
 * 403 (or 404 if they want to hide existence — keep the shape consistent
 * with the rest of the api).
 */
export async function userCanAccessProject(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  projectId: string,
): Promise<{ allowed: boolean; role: 'owner' | 'admin' | 'member' | 'viewer' | null }> {
  const { data: project } = await db
    .from('projects')
    .select('id, owner_id, organization_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return { allowed: false, role: null };

  // 1. Direct ownership wins immediately — owner has full rights regardless
  //    of org membership rows (legacy projects with no org still work).
  if (project.owner_id === userId) return { allowed: true, role: 'owner' };

  // 2. Org-scoped membership (Teams v1).
  if (project.organization_id) {
    const { data: orgMembership } = await db
      .from('organization_members')
      .select('role')
      .eq('organization_id', project.organization_id)
      .eq('user_id', userId)
      .maybeSingle();
    const role = (orgMembership?.role as 'owner' | 'admin' | 'member' | 'viewer' | undefined) ?? null;
    if (role) return { allowed: true, role };
  }

  // 3. Per-project membership (older system; still seeded for project
  //    creators and used by some dispatch gates).
  const { data: projectMembership } = await db
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  const projRole = (projectMembership?.role as 'owner' | 'admin' | 'member' | 'viewer' | undefined) ?? null;
  if (projRole) return { allowed: true, role: projRole };

  return { allowed: false, role: null };
}

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
