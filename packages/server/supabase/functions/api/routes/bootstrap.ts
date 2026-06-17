/**
 * FILE: packages/server/supabase/functions/api/routes/bootstrap.ts
 * PURPOSE: Headless bootstrap endpoint for self-hosters and IaC deployments.
 *          Mirrors Langfuse's LANGFUSE_INIT_* pattern.
 *
 * POST /v1/admin/bootstrap
 *   Auth: service-role JWT (SUPABASE_SERVICE_ROLE_KEY)
 *   Reads MUSHI_INIT_* env vars and creates an org, project, and/or API key
 *   if they don't exist. Fully idempotent.
 *
 * Env vars consumed:
 *   MUSHI_INIT_ORG_NAME       — org display name
 *   MUSHI_INIT_ORG_ID         — org UUID (optional; random UUID if omitted)
 *   MUSHI_INIT_PROJECT_NAME   — project display name
 *   MUSHI_INIT_PROJECT_ID     — project UUID (optional; random UUID if omitted)
 *   MUSHI_INIT_REPORTER_KEY   — pre-defined API key value (mushi_... format)
 */

import { Hono } from 'npm:hono@4'
import { requireServiceRoleAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import type { Variables } from '../types.ts'

export function registerBootstrapRoutes(app: Hono<{ Variables: Variables }>) {
  app.post('/v1/admin/bootstrap', async (c) => {
    const authError = requireServiceRoleAuth(c.req.raw)
    if (authError) return authError

    const db = getServiceClient()

    const orgName = Deno.env.get('MUSHI_INIT_ORG_NAME')
    const orgId = Deno.env.get('MUSHI_INIT_ORG_ID')
    const projectName = Deno.env.get('MUSHI_INIT_PROJECT_NAME')
    const projectId = Deno.env.get('MUSHI_INIT_PROJECT_ID')
    const reporterKey = Deno.env.get('MUSHI_INIT_REPORTER_KEY')

    const result: Record<string, string> = {}
    const skipped: string[] = []

    // Org
    if (orgName) {
      const { data: existingOrg } = orgId
        ? await db.from('organizations').select('id').eq('id', orgId).maybeSingle()
        : await db.from('organizations').select('id').eq('name', orgName).maybeSingle()

      if (existingOrg) {
        skipped.push('org')
      } else {
        const newId = orgId ?? crypto.randomUUID()
        const { error } = await db.from('organizations').insert({
          id: newId,
          name: orgName,
        })
        if (error) {
          return c.json({ ok: false, error: { code: 'ORG_CREATE_FAILED', message: error.message } }, 500)
        }
        result.org_id = newId
      }
    }

    // Project
    const resolvedOrgId = result.org_id ?? orgId
    if (projectName && resolvedOrgId) {
      const { data: existingProject } = projectId
        ? await db.from('projects').select('id').eq('id', projectId).maybeSingle()
        : await db.from('projects').select('id').eq('name', projectName).eq('org_id', resolvedOrgId).maybeSingle()

      if (existingProject) {
        skipped.push('project')
      } else {
        const newId = projectId ?? crypto.randomUUID()
        const { error } = await db.from('projects').insert({
          id: newId,
          org_id: resolvedOrgId,
          name: projectName,
        })
        if (error) {
          return c.json({ ok: false, error: { code: 'PROJECT_CREATE_FAILED', message: error.message } }, 500)
        }
        result.project_id = newId
      }
    }

    // Reporter API key
    const resolvedProjectId = result.project_id ?? projectId
    if (reporterKey && resolvedProjectId) {
      const keyPrefix = reporterKey.slice(0, 12)
      const { data: existingKey } = await db
        .from('project_api_keys')
        .select('id')
        .eq('project_id', resolvedProjectId)
        .eq('key_prefix', keyPrefix)
        .maybeSingle()

      if (existingKey) {
        skipped.push('reporter_key')
      } else {
        const keyHash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(reporterKey))),
        ).map((b) => b.toString(16).padStart(2, '0')).join('')

        const { error } = await db.from('project_api_keys').insert({
          project_id: resolvedProjectId,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          label: 'bootstrap-reporter-key',
          scopes: ['report:write'],
          is_active: true,
        })
        if (error) {
          return c.json({ ok: false, error: { code: 'KEY_CREATE_FAILED', message: error.message } }, 500)
        }
        result.reporter_key_prefix = keyPrefix
      }
    }

    return c.json({
      ok: true,
      created: result,
      skipped,
      message: Object.keys(result).length === 0
        ? 'Nothing to bootstrap — set MUSHI_INIT_* env vars to enable.'
        : `Bootstrap complete. Created: ${Object.keys(result).join(', ')}`,
    })
  })
}
