/**
 * db-advisors.ts — Admin route that proxies Supabase MCP advisor results
 *
 * GET /v1/admin/projects/:id/db-advisors
 *   Returns database performance and security advisors fetched from the
 *   Supabase MCP (read-only) for the given project. Requires the org to have
 *   a `supabase` BYOK key configured (slug: `supabase`).
 *
 * Response shape:
 *   { ok: true, data: { advisors: AdvisorResult[]; projectRef: string } }
 *   { ok: true, data: null; reason: 'no_supabase_pat' }  — if key not set
 */

import { Hono } from 'npm:hono@4'
import { jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { resolveSupabasePat, getSupabaseAdvisors } from '../../_shared/supabase-mcp-client.ts'
import { resolveOwnedProject } from '../shared.ts'
import type { Variables } from '../types.ts'

export function registerDbAdvisorsRoutes(parent: Hono<{ Variables: Variables }>) {
  parent.get('/v1/admin/projects/:id/db-advisors', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('id')
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
        data: null,
        reason: 'no_supabase_pat',
        hint:
          'Add your Supabase Personal Access Token in Admin → Settings → API Keys ' +
          '(slug: supabase) to enable live schema advisor data.',
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
        data: null,
        reason: 'no_project_ref',
        hint: 'Set `supabase_project_ref` in your project settings to enable advisor data.',
      })
    }

    try {
      const advisors = await getSupabaseAdvisors({ projectRef, pat })
      return c.json({ ok: true, data: { advisors, projectRef } })
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
