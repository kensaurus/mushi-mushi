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
 *   MUSHI_INIT_OWNER_EMAIL    — required: an account that signed up in the console (owner of the org/project)
 *   MUSHI_INIT_ORG_NAME       — org display name (optional: the owner's personal org otherwise)
 *   MUSHI_INIT_ORG_ID         — org UUID (optional; random UUID if omitted)
 *   MUSHI_INIT_PROJECT_NAME   — project display name
 *   MUSHI_INIT_PROJECT_ID     — project UUID (optional; random UUID if omitted)
 *   MUSHI_INIT_REPORTER_KEY   — pre-defined API key value (mushi_... format)
 */

import { Hono } from 'npm:hono@4'
import { requireServiceRoleAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { insertProjectWithFreeSlug } from '../../_shared/project-slug.ts'
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

    // Owner: organizations.owner_id and projects.owner_id are required, so bootstrap acts for
    // a real account. The owner signs up once in the console first (BL-172, 2026-11-19).
    const ownerEmail = Deno.env.get('MUSHI_INIT_OWNER_EMAIL')?.trim().toLowerCase()
    if ((orgName || projectName) && !ownerEmail) {
      return c.json({
        ok: false,
        error: {
          code: 'OWNER_REQUIRED',
          message: 'Set MUSHI_INIT_OWNER_EMAIL to the email of an account that has signed up in the console.',
        },
      }, 400)
    }
    let ownerId: string | null = null
    if (ownerEmail) {
      for (let page = 1; page <= 20 && !ownerId; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) return c.json({ ok: false, error: { code: 'OWNER_LOOKUP_FAILED', message: error.message } }, 500)
        ownerId = data.users.find((u) => u.email?.toLowerCase() === ownerEmail)?.id ?? null
        if (data.users.length < 1000) break
      }
      if (!ownerId) {
        return c.json({
          ok: false,
          error: { code: 'OWNER_NOT_FOUND', message: `No account for ${ownerEmail}. Sign up in the console first, then call bootstrap again.` },
        }, 400)
      }
    }

    // Org: a named team org (slug rules as in routes/organizations.ts), else the owner's
    // personal org.
    let resolvedOrgId = orgId ?? null
    if (ownerId && orgName) {
      const { data: existingOrg } = orgId
        ? await db.from('organizations').select('id').eq('id', orgId).maybeSingle()
        : await db.from('organizations').select('id').eq('name', orgName).eq('owner_id', ownerId).maybeSingle()

      if (existingOrg) {
        skipped.push('org')
        resolvedOrgId = existingOrg.id as string
      } else {
        const base = orgName.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'team'
        const padded = base.length < 3 ? `${base}-team` : base
        const tail = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')
        const candidates = [padded, `${padded.slice(0, 50)}-${tail()}`, `${padded.slice(0, 50)}-${tail()}`]
        let created: { id: string } | null = null
        let lastError: { message?: string; code?: string } | null = null
        for (const slug of candidates) {
          const { data, error } = await db
            .from('organizations')
            .insert({ ...(orgId ? { id: orgId } : {}), name: orgName, slug, owner_id: ownerId, is_personal: false })
            .select('id')
            .single()
          if (data) { created = data as { id: string }; break }
          lastError = error
          if (!(error?.code === '23505' || /duplicate key|unique constraint/i.test(error?.message ?? ''))) break
        }
        if (!created) {
          return c.json({ ok: false, error: { code: 'ORG_CREATE_FAILED', message: lastError?.message ?? 'no free slug' } }, 500)
        }
        const { error: memberErr } = await db.from('organization_members').insert({
          organization_id: created.id,
          user_id: ownerId,
          role: 'owner',
          joined_via: 'founding_owner',
          last_active_at: new Date().toISOString(),
        })
        if (memberErr) {
          await db.from('organizations').delete().eq('id', created.id)
          return c.json({ ok: false, error: { code: 'ORG_CREATE_FAILED', message: memberErr.message } }, 500)
        }
        result.org_id = created.id
        resolvedOrgId = created.id
      }
    } else if (ownerId && projectName && !resolvedOrgId) {
      const { data: personalOrgId, error } = await db.rpc('bootstrap_personal_org', { p_user_id: ownerId })
      if (error || !personalOrgId) {
        return c.json({ ok: false, error: { code: 'ORG_CREATE_FAILED', message: error?.message ?? 'no personal org' } }, 500)
      }
      resolvedOrgId = personalOrgId as string
    }

    // Project: the console's own insert (free slug; the owner becomes a member by trigger).
    let resolvedProjectId = projectId ?? null
    if (ownerId && projectName && resolvedOrgId) {
      const { data: existingProject } = projectId
        ? await db.from('projects').select('id').eq('id', projectId).maybeSingle()
        : await db.from('projects').select('id').eq('name', projectName).eq('organization_id', resolvedOrgId).maybeSingle()

      if (existingProject) {
        skipped.push('project')
        resolvedProjectId = existingProject.id as string
      } else {
        const { data, error } = await insertProjectWithFreeSlug(db, {
          name: projectName,
          owner_id: ownerId,
          organization_id: resolvedOrgId,
        })
        if (error || !data) {
          return c.json({ ok: false, error: { code: 'PROJECT_CREATE_FAILED', message: error?.message ?? 'insert failed' } }, 500)
        }
        result.project_id = data.id
        resolvedProjectId = data.id
      }
    }

    // Reporter API key
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
