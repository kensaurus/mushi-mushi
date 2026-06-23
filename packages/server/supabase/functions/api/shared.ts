import type { Context } from 'npm:hono@4';
import type { ContentfulStatusCode } from 'npm:hono@4/utils/http-status';
// `getServiceClient` is only referenced in `ReturnType<typeof
// getServiceClient>` annotations on `userCanAccessProject` /
// `resolveOwnedProject` — pull it in as a type-only import so `db.ts`
// stays out of the module graph until a caller actually needs the
// live client.
import type { getServiceClient } from '../_shared/db.ts';
import { reportError } from '../_shared/sentry.ts';
import {
  accessibleProjectIds as _accessibleProjectIds,
  accessibleProjectIdsInOrganization as _accessibleProjectIdsInOrganization,
  ownedProjectIds as _ownedProjectIds,
} from '../_shared/project-access.ts';
import { isUuid } from './ids.ts';

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

/** Canonical success envelope for admin routes. */
export function jsonOk(
  c: Context,
  data: Record<string, unknown> | unknown[],
  status: ContentfulStatusCode = 200,
): Response {
  return c.json({ ok: true, data }, status);
}

/** Canonical error envelope for admin routes. */
export function jsonError(
  c: Context,
  code: string,
  message: string,
  status: ContentfulStatusCode = 400,
  extra?: Record<string, unknown>,
): Response {
  return c.json({ ok: false, error: { code, message, ...extra } }, status);
}

export function jsonValidationError(c: Context, message: string): Response {
  return jsonError(c, 'VALIDATION_ERROR', message, 400);
}

/**
 * Validate a path param is a UUID before hitting Postgres.
 * Prevents 22P02 → 500 noise in Sentry when smoke tools pass slug ids like `rep_smoke`.
 */
export function parseUuidParam(
  c: Context,
  paramName = 'id',
): { ok: true; value: string } | { ok: false; error: Response } {
  const raw = c.req.param(paramName);
  if (!raw || !isUuid(raw)) {
    return {
      ok: false,
      error: jsonValidationError(c, `${paramName} must be a valid UUID`),
    };
  }
  return { ok: true, value: raw };
}

export function jsonNotFound(c: Context, message = 'Not found'): Response {
  return jsonError(c, 'NOT_FOUND', message, 404);
}

export function jsonForbidden(c: Context, message = 'Forbidden'): Response {
  return jsonError(c, 'FORBIDDEN', message, 403);
}

// `accessibleProjectIds` lives in `_shared/project-access.ts` so Edge
// Functions outside `api/` (e.g. `inventory-crawler`) can reuse it
// without forcing the deploy bundler to reach into `../api/` (it can't —
// see scripts/deploy-edge-function.mjs and the 2026-05-05 inventory-
// crawler / synthetic-monitor deploy regression). The aliases here keep
// existing callers in `api/routes/*` working without churn.
export const accessibleProjectIds = _accessibleProjectIds;
export const ownedProjectIds = _ownedProjectIds;

/**
 * Full accessible project set for enumeration endpoints (project list,
 * setup/switcher, org-wide stats).
 *
 * Scoping contract (mirrors Supabase / Vercel team dashboards):
 *   - **Never** honours `X-Mushi-Project-Id` — the picker must always list
 *     every project the user can reach in the active team context.
 *   - **Optionally** honours `X-Mushi-Org-Id` when the admin console has a
 *     team selected — narrows the list to that org's projects only.
 *   - Returns `[]` when the org header names an org the caller does not
 *     belong to (fail closed).
 *
 * Data pages (reports, fixes, …) continue to use {@link callerProjectIds}
 * which applies the pinned project header on top of this set.
 */
export async function enumerateAccessibleProjectIds(
  c: Context,
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<string[]> {
  const requestedOrg = requestedOrganizationId(c);
  if (!requestedOrg) return ownedProjectIds(db, userId);
  if (!UUID_RE.test(requestedOrg)) return [];
  return _accessibleProjectIdsInOrganization(db, userId, requestedOrg);
}

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
  project_name?: string | null;
  organization_id?: string | null;
  organization_role?: string | null;
}

export type OwnedProjectResolution =
  | { project: OwnedProjectRef; explicit: boolean }
  | { response: Response };

export interface ResolveOwnedProjectOptions {
  noProjectResponse?: () => Response;
  /**
   * When set, use this project ID instead of reading from request
   * headers/query-params. Useful for named-resource routes like
   * `GET /v1/admin/projects/:id/…` where the project is identified
   * by the URL segment rather than the conventional headers.
   */
  overrideProjectId?: string;
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
  // API-key callers are pinned to the key's project — never elevated via owner_id.
  if (c.get('authMethod') === 'apiKey') {
    const bound = c.get('projectId') as string | undefined;
    if (!bound) {
      return { response: jsonForbidden(c, 'API key missing project binding') };
    }
    const requested = options.overrideProjectId ?? requestedProjectId(c);
    if (requested && requested !== bound) {
      return { response: jsonForbidden(c, 'Project scope mismatch for API key') };
    }
    const { data: row } = await db
      .from('projects')
      .select('id, name, organization_id')
      .eq('id', bound)
      .maybeSingle();
    if (!row) {
      return {
        response: c.json(
          { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } },
          404,
        ),
      };
    }
    if (row.organization_id) c.set('organizationId', row.organization_id);
    c.set('projectId', row.id);
    return { project: { ...row, organization_role: 'owner' }, explicit: Boolean(requested) };
  }

  // Named-resource routes (e.g. GET /projects/:id/…) pass the URL segment
  // directly rather than relying on headers/query-params.
  const requested = options.overrideProjectId ?? requestedProjectId(c);
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

/**
 * Fail-closed project scope for list/search endpoints.
 *
 * - API-key auth (MCP / SDK): always `[key.project_id]`; mismatched
 *   `project_id` query/header returns `[]` so list routes never leak rows.
 * - JWT admin: honours `X-Mushi-Project-Id` when set; otherwise all owned.
 */
export async function callerProjectIds(
  c: Context,
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<string[]> {
  if (c.get('authMethod') === 'apiKey') {
    const bound = c.get('projectId') as string | undefined;
    const isOrgScoped = Boolean(c.get('isOrgScopedKey'));
    const requested = requestedProjectId(c);

    // Org-scoped keys (project_id NULL on the key row) enumerate every
    // project the key owner can reach — same set JWT callers see.
    if (isOrgScoped && !bound) {
      const all = await accessibleProjectIds(db, userId);
      if (!requested) return all;
      if (!UUID_RE.test(requested)) return [];
      return all.includes(requested) ? [requested] : [];
    }

    if (!bound) return [];
    if (requested && requested !== bound) return [];
    return [bound];
  }
  return scopedOwnedProjectIds(c, db, userId);
}

/**
 * Authorize read access to a report's owning project on detail endpoints.
 *
 * List routes stay pinned via {@link callerProjectIds}; detail routes fetch
 * by UUID first, then gate with this helper so a JWT user (or org-scoped
 * MCP key) can open a report in project B while the console header pins A.
 */
export async function canAccessReportProject(
  c: Context,
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  reportProjectId: string,
): Promise<boolean> {
  if (c.get('authMethod') === 'apiKey') {
    const bound = c.get('projectId') as string | undefined;
    const isOrgScoped = Boolean(c.get('isOrgScopedKey'));
    if (isOrgScoped && !bound) {
      const allowed = await accessibleProjectIds(db, userId);
      return allowed.includes(reportProjectId);
    }
    return bound === reportProjectId;
  }
  const access = await userCanAccessProject(db, userId, reportProjectId);
  return access.allowed;
}

/** Explicit 403 when a named-resource route targets a project outside API-key scope. */
export function assertCallerProjectScope(c: Context, projectId: string): Response | null {
  if (c.get('authMethod') !== 'apiKey') return null;
  const bound = c.get('projectId') as string | undefined;
  if (!bound || projectId !== bound) {
    return jsonForbidden(c, 'Project scope mismatch for API key');
  }
  return null;
}

/**
 * List endpoints honour `X-Mushi-Project-Id` when the admin console sends it
 * (ProjectSwitcher). Without a header, returns all owned projects — legacy
 * behaviour for JWT callers that don't scope. If the header names a project the
 * caller doesn't own, returns [] so the UI renders an empty state instead of
 * leaking cross-project rows.
 *
 * Prefer {@link callerProjectIds} in routes behind `adminOrApiKey`.
 */
export async function scopedOwnedProjectIds(
  c: Context,
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<string[]> {
  if (c.get('authMethod') === 'apiKey') {
    return callerProjectIds(c, db, userId);
  }
  const all = await ownedProjectIds(db, userId);
  const requested = requestedProjectId(c);
  if (!requested) return all;
  if (!UUID_RE.test(requested)) return [];
  return all.includes(requested) ? [requested] : [];
}

export const resolveAccessibleProject = resolveOwnedProject;

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

export type AccessibleOrgResolution =
  | { ok: true; organizationId: string; role: OrgRole }
  | { ok: false; response: Response };

/**
 * Validates `X-Mushi-Org-Id` for JWT callers (membership gate, fail closed).
 * API-key callers resolve org from the bound project and reject header mismatches.
 */
export async function resolveAccessibleOrg(
  c: Context,
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<AccessibleOrgResolution> {
  const requested = requestedOrganizationId(c);

  if (c.get('authMethod') === 'apiKey') {
    const boundProjectId = c.get('projectId') as string | undefined;
    if (!boundProjectId) {
      return { ok: false, response: jsonForbidden(c, 'API key missing project binding') };
    }
    const { data: project } = await db
      .from('projects')
      .select('organization_id')
      .eq('id', boundProjectId)
      .maybeSingle();
    const orgFromProject = (project?.organization_id as string | null) ?? null;
    if (!orgFromProject) {
      return {
        ok: false,
        response: jsonError(c, 'PROJECT_NO_ORG', 'Project has no organization', 422),
      };
    }
    if (requested && requested !== orgFromProject) {
      return { ok: false, response: jsonForbidden(c, 'Organization scope mismatch for API key') };
    }
    c.set('organizationId', orgFromProject);
    return { ok: true, organizationId: orgFromProject, role: 'owner' };
  }

  if (!requested) {
    return { ok: false, response: jsonError(c, 'ORG_REQUIRED', 'X-Mushi-Org-Id required', 400) };
  }
  if (!UUID_RE.test(requested)) {
    return { ok: false, response: jsonValidationError(c, 'organization_id must be a UUID') };
  }

  const { data: membership } = await db
    .from('organization_members')
    .select('role')
    .eq('organization_id', requested)
    .eq('user_id', userId)
    .maybeSingle();
  const role = (membership?.role as OrgRole | undefined) ?? null;
  if (!role) {
    return { ok: false, response: jsonForbidden(c, 'Access to this organization is not allowed') };
  }

  c.set('organizationId', requested);
  return { ok: true, organizationId: requested, role };
}

export type TargetProjectAccessResult =
  | {
      ok: true;
      projectId: string;
      organizationId: string | null;
      role: OrgRole;
    }
  | { ok: false; response: Response };

/**
 * Fail-closed access check for a specific project id (body, query, header, or URL).
 * API-key callers stay bound to the key project; JWT callers use org/project membership.
 */
export async function assertTargetProjectAccess(
  c: Context,
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  projectId: string,
): Promise<TargetProjectAccessResult> {
  if (!UUID_RE.test(projectId)) {
    return {
      ok: false,
      response: jsonValidationError(c, 'project_id must be a UUID'),
    };
  }

  const scopeErr = assertCallerProjectScope(c, projectId);
  if (scopeErr) return { ok: false, response: scopeErr };

  if (c.get('authMethod') === 'apiKey') {
    const { data: row } = await db
      .from('projects')
      .select('id, organization_id')
      .eq('id', projectId)
      .maybeSingle();
    if (!row) return { ok: false, response: jsonNotFound(c, 'Project not found') };
    c.set('projectId', row.id);
    if (row.organization_id) c.set('organizationId', row.organization_id);
    return {
      ok: true,
      projectId: row.id,
      organizationId: (row.organization_id as string | null) ?? null,
      role: 'owner',
    };
  }

  const access = await userCanAccessProject(db, userId, projectId);
  if (!access.allowed || !access.role) {
    return { ok: false, response: jsonForbidden(c, 'Access to this project is not allowed') };
  }

  const requestedOrg = requestedOrganizationId(c);
  const { data: row } = await db
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .maybeSingle();
  if (requestedOrg && row?.organization_id && requestedOrg !== row.organization_id) {
    return { ok: false, response: jsonForbidden(c, 'Project is not in the active organization') };
  }

  c.set('projectId', projectId);
  if (row?.organization_id) c.set('organizationId', row.organization_id);
  return {
    ok: true,
    projectId,
    organizationId: (row?.organization_id as string | null) ?? null,
    role: access.role,
  };
}

/**
 * Project-data list scope: intersect optional org + project headers with accessible ids.
 * Returns `[]` on mismatch (empty state, not cross-tenant leak).
 */
export async function intersectOrgAndProjectScope(
  c: Context,
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<string[]> {
  if (c.get('authMethod') === 'apiKey') {
    return callerProjectIds(c, db, userId);
  }

  const requestedOrg = requestedOrganizationId(c);
  const requestedProject = requestedProjectId(c);

  let projectIds = await ownedProjectIds(db, userId);

  if (requestedOrg) {
    if (!UUID_RE.test(requestedOrg)) return [];
    projectIds = await _accessibleProjectIdsInOrganization(db, userId, requestedOrg);
  }

  if (requestedProject) {
    if (!UUID_RE.test(requestedProject)) return [];
    return projectIds.includes(requestedProject) ? [requestedProject] : [];
  }

  return projectIds;
}
