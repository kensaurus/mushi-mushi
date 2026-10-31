/**
 * db-advisors.ts — Admin route that proxies Supabase MCP advisor results
 *
 * GET /v1/admin/projects/:id/db-advisors
 *   Returns database performance and security advisors fetched from the
 *   Supabase MCP (read-only) for the given project. Requires the org to have
 *   a `supabase` BYOK key configured (slug: `supabase`).
 *
 * Response shape:
 *   { ok: true, data: { advisors: AdvisorResult[]; projectRef: string;
 *     health: DbHealth; sharedWith: string[] } }
 *   `health` is the console's Database health card (_shared/db-health.ts):
 *   advisors plus one read-only stats query (size, connections, cache hit).
 *   A failed stats read leaves those fields null, never the advisors.
 *   `sharedWith` names the other apps of the organization on the same
 *   Supabase project, so one project's health is not mistaken for one app's.
 *   { ok: true, data: { projectRef: null, reason }; reason } — no token or no ref
 */

import { Hono } from 'npm:hono@4'
import { jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { resolveSupabasePat, getSupabaseAdvisors, executeReadOnlySql } from '../../_shared/supabase-mcp-client.ts'
import { DB_STATS_SQL, parseDbStats, summarizeDbHealth } from '../../_shared/db-health.ts'
import { resolveOwnedProject } from '../shared.ts'
import type { Variables } from '../types.ts'

export function registerDbAdvisorsRoutes(parent: Hono<{ Variables: Variables }>) {
  parent.get('/v1/admin/projects/:id/db-advisors', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('id')!
    const db = getServiceClient()

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404),
      overrideProjectId: projectId,
    })
    // OwnedProjectResolution is always a truthy object — check the union discriminant.
    if ('response' in resolvedProject) return resolvedProject.response

    const { project } = resolvedProject

    // Resolve the Supabase PAT from BYOK keys (slug: `supabase`).
    const pat = await resolveSupabasePat(db, project.id)
    if (!pat) {
      return c.json({
        ok: true,
        // The reason rides inside data too: the console reads `data` only.
        data: { projectRef: null, reason: 'no_supabase_pat' },
        reason: 'no_supabase_pat',
        hint:
          'Add a scoped, read-only Supabase access token in Settings → AI keys → Supabase ' +
          'to enable live schema advisor data.',
      })
    }

    // Resolve the Supabase project ref. Stored in project_settings or derived
    // from the API endpoint URL.
    const { data: settings } = await db
      .from('project_settings')
      .select('supabase_project_ref')
      .eq('project_id', project.id)
      .single()
    const projectRef = (settings as { supabase_project_ref?: string } | null)?.supabase_project_ref

    if (!projectRef) {
      return c.json({
        ok: true,
        data: { projectRef: null, reason: 'no_project_ref' },
        reason: 'no_project_ref',
        hint: 'Set the Supabase project ref in Settings → General → Supabase project to enable advisor data.',
      })
    }

    try {
      const opts = { projectRef, pat }
      const [advisors, stats, shared] = await Promise.all([
        getSupabaseAdvisors(opts),
        executeReadOnlySql(opts, DB_STATS_SQL).then(parseDbStats).catch(() => null),
        project.organization_id
          ? db
              .from('project_settings')
              .select('project_id, projects!inner(name, organization_id)')
              .eq('supabase_project_ref', projectRef)
              .eq('projects.organization_id', project.organization_id)
              .neq('project_id', project.id)
          : Promise.resolve({ data: [] }),
      ])
      const sharedWith = ((shared.data ?? []) as Array<{ projects?: { name?: string } | Array<{ name?: string }> }>)
        .map((r) => (Array.isArray(r.projects) ? r.projects[0]?.name : r.projects?.name))
        .filter((n): n is string => Boolean(n))
        .sort()
      return c.json({ ok: true, data: { advisors, projectRef, health: summarizeDbHealth(advisors, stats), sharedWith } })
    } catch (err) {
      return c.json({
        ok: false,
        error: {
          code: 'SUPABASE_MCP_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      }, 502)
    }
  })
}
