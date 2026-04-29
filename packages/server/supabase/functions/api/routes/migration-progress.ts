import type { Hono, Context } from 'npm:hono@4';

import { jwtAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { dbError, accessibleProjectIds, userCanAccessProject } from '../shared.ts';
import {
  KNOWN_GUIDE_SLUGS,
  isKnownGuideSlug,
  isUuid,
  normalizeProgressUpsert,
  type ProgressSource,
} from '../migration-progress-helpers.ts';

interface MigrationProgressRow {
  id: string;
  user_id: string;
  project_id: string | null;
  guide_slug: string;
  completed_step_ids: string[];
  required_step_count: number | null;
  completed_required_count: number;
  source: ProgressSource;
  client_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SerializedRow {
  id: string;
  guide_slug: string;
  project_id: string | null;
  completed_step_ids: string[];
  required_step_count: number | null;
  completed_required_count: number;
  source: ProgressSource;
  client_updated_at: string | null;
  created_at: string;
  updated_at: string;
  is_self: boolean;
}

function serialize(row: MigrationProgressRow, callerUserId: string): SerializedRow {
  return {
    id: row.id,
    guide_slug: row.guide_slug,
    project_id: row.project_id,
    completed_step_ids: row.completed_step_ids ?? [],
    required_step_count: row.required_step_count,
    completed_required_count: row.completed_required_count,
    source: row.source,
    client_updated_at: row.client_updated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // The admin card shows "you" vs "Alice" — distinguishing self rows
    // matters for the UI label without leaking other team members' user_id
    // (we deliberately do NOT serialize user_id back to the browser).
    is_self: row.user_id === callerUserId,
  };
}

function parseProjectIdFilter(c: Context): { projectId: string | null; error?: Response } {
  const raw = c.req.query('project_id');
  if (!raw || raw === 'null') return { projectId: null };
  if (!isUuid(raw)) {
    return {
      projectId: null,
      error: c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'project_id must be a UUID' } },
        400,
      ),
    };
  }
  return { projectId: raw };
}

export function registerMigrationProgressRoutes(app: Hono): void {
  // ─────────────────────────────────────────────────────────────────────
  // GET /v1/admin/migrations/progress
  //
  // Query params:
  //   - guide_slug   (optional) — filter to one guide
  //   - project_id   (optional) — when present, list project-scoped progress
  //                               for that project (subject to access check).
  //                               When omitted, returns the caller's own
  //                               account-scoped + project-scoped rows for
  //                               every project they can access.
  //   - scope        'all' | 'mine' (default 'mine') — 'all' returns rows
  //                  from every project member (admin card uses this on
  //                  ProjectsPage to surface teammates' in-progress work).
  // ─────────────────────────────────────────────────────────────────────
  app.get('/v1/admin/migrations/progress', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const slug = c.req.query('guide_slug');
    if (slug !== undefined && !isKnownGuideSlug(slug)) {
      return c.json(
        { ok: false, error: { code: 'UNKNOWN_GUIDE_SLUG', message: 'guide_slug is not a published migration guide' } },
        400,
      );
    }

    const projectFilter = parseProjectIdFilter(c);
    if (projectFilter.error) return projectFilter.error;

    const scope = c.req.query('scope') === 'all' ? 'all' : 'mine';

    // Decide the access surface:
    //   * project_id explicit → must be a project the caller can access.
    //     scope=all returns everyone's rows (RLS already enforces project
    //     membership read), scope=mine returns only the caller's rows.
    //   * project_id omitted → caller's own rows (account + every project
    //     they're in). We never expose other users' rows in this branch.
    let query = db
      .from('migration_progress')
      .select(
        'id, user_id, project_id, guide_slug, completed_step_ids, required_step_count, completed_required_count, source, client_updated_at, created_at, updated_at',
      )
      .order('updated_at', { ascending: false })
      .limit(200);

    if (slug) query = query.eq('guide_slug', slug);

    if (projectFilter.projectId) {
      const access = await userCanAccessProject(db, userId, projectFilter.projectId);
      if (!access.allowed) {
        return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
      }
      query = query.eq('project_id', projectFilter.projectId);
      if (scope === 'mine') query = query.eq('user_id', userId);
    } else {
      const projectIds = await accessibleProjectIds(db, userId);
      // own account-scoped rows OR project-scoped rows on accessible projects
      // (when scope=mine, only own; when scope=all, anyone on those projects)
      if (scope === 'mine') {
        query = query.eq('user_id', userId);
      } else {
        // OR clause: own account-scoped (project_id IS NULL AND user_id=me)
        // OR any row on a project I can access.
        const inList =
          projectIds.length > 0
            ? `(${projectIds.map((id) => `"${id}"`).join(',')})`
            : null;
        if (inList) {
          query = query.or(`user_id.eq.${userId},project_id.in.${inList}`);
        } else {
          query = query.eq('user_id', userId);
        }
      }
    }

    const { data, error } = await query;
    if (error) return dbError(c, error);

    const rows = (data ?? []) as MigrationProgressRow[];
    return c.json({
      ok: true,
      data: {
        progress: rows.map((r) => serialize(r, userId)),
        // Echo the slug allowlist so a stale docs build can warn the user
        // when a guide they have local progress for is no longer published.
        knownGuideSlugs: KNOWN_GUIDE_SLUGS,
      },
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /v1/admin/migrations/progress/:guide_slug
  //
  // Body:
  //   {
  //     project_id?: string | null,        // null = account-scoped
  //     completed_step_ids: string[],
  //     required_step_count?: number,
  //     completed_required_count?: number,
  //     source?: 'docs' | 'admin' | 'cli',
  //     client_updated_at?: string         // ISO timestamp
  //   }
  //
  // Always self-scoped to the caller (RLS enforces, but we also set
  // user_id = caller server-side so the body can never spoof it).
  // ─────────────────────────────────────────────────────────────────────
  app.put('/v1/admin/migrations/progress/:guide_slug', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const slug = c.req.param('guide_slug');
    if (!isKnownGuideSlug(slug)) {
      return c.json(
        { ok: false, error: { code: 'UNKNOWN_GUIDE_SLUG', message: 'guide_slug is not a published migration guide' } },
        400,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const normalized = normalizeProgressUpsert(body);
    if (!normalized.ok) {
      return c.json({ ok: false, error: { code: normalized.code, message: normalized.message } }, 400);
    }

    const {
      projectId,
      completedStepIds,
      requiredStepCount,
      completedRequiredCount,
      source,
      clientUpdatedAt,
    } = normalized.value;

    const db = getServiceClient();

    // If a project_id is provided, the caller MUST be a member of that
    // project. RLS would also block this, but checking here lets us return
    // a precise 403 instead of a generic policy-denied DB error.
    if (projectId) {
      const access = await userCanAccessProject(db, userId, projectId);
      if (!access.allowed) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
      }
    }

    // Upsert by (user_id, guide_slug, project_id-scope). The two partial
    // unique indexes guarantee one row per scope; we resolve the existing
    // row first and either UPDATE it or INSERT a fresh one. Doing the
    // SELECT then INSERT/UPDATE in two steps (rather than .upsert with
    // onConflict) is necessary because PostgREST cannot target a partial
    // unique index for ON CONFLICT — supabase-js's onConflict only accepts
    // unconstrained unique columns.
    const findQuery = db
      .from('migration_progress')
      .select('id')
      .eq('user_id', userId)
      .eq('guide_slug', slug)
      .limit(1);
    const existingQuery = projectId
      ? findQuery.eq('project_id', projectId)
      : findQuery.is('project_id', null);
    const { data: existing, error: findError } = await existingQuery.maybeSingle();
    if (findError) return dbError(c, findError);

    const payload = {
      user_id: userId,
      project_id: projectId,
      guide_slug: slug,
      completed_step_ids: completedStepIds,
      required_step_count: requiredStepCount,
      completed_required_count: completedRequiredCount,
      source,
      client_updated_at: clientUpdatedAt,
    };

    let row: MigrationProgressRow | null = null;
    if (existing?.id) {
      const { data, error } = await db
        .from('migration_progress')
        .update(payload)
        .eq('id', existing.id)
        .select(
          'id, user_id, project_id, guide_slug, completed_step_ids, required_step_count, completed_required_count, source, client_updated_at, created_at, updated_at',
        )
        .single();
      if (error) return dbError(c, error);
      row = data as MigrationProgressRow;
    } else {
      const { data, error } = await db
        .from('migration_progress')
        .insert(payload)
        .select(
          'id, user_id, project_id, guide_slug, completed_step_ids, required_step_count, completed_required_count, source, client_updated_at, created_at, updated_at',
        )
        .single();
      if (error) return dbError(c, error);
      row = data as MigrationProgressRow;
    }

    return c.json({ ok: true, data: { progress: serialize(row!, userId) } });
  });

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /v1/admin/migrations/progress/:guide_slug?project_id=...
  //
  // Clears the caller's remote progress for one guide in one scope. The
  // localStorage copy in the docs is intentionally NOT touched — the
  // user can re-sync later if they want to.
  // ─────────────────────────────────────────────────────────────────────
  app.delete('/v1/admin/migrations/progress/:guide_slug', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const slug = c.req.param('guide_slug');
    if (!isKnownGuideSlug(slug)) {
      return c.json(
        { ok: false, error: { code: 'UNKNOWN_GUIDE_SLUG', message: 'guide_slug is not a published migration guide' } },
        400,
      );
    }

    const projectFilter = parseProjectIdFilter(c);
    if (projectFilter.error) return projectFilter.error;

    const db = getServiceClient();

    let q = db
      .from('migration_progress')
      .delete()
      .eq('user_id', userId)
      .eq('guide_slug', slug);
    q = projectFilter.projectId
      ? q.eq('project_id', projectFilter.projectId)
      : q.is('project_id', null);

    const { error } = await q;
    if (error) return dbError(c, error);
    return c.json({ ok: true });
  });
}
