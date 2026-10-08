/**
 * FILE: packages/server/supabase/functions/api/routes/project-groups.ts
 * PURPOSE: Named groups of projects inside one organization (Plan 021).
 *
 * GET    /v1/admin/orgs/:orgId/project-groups              — groups + the member ids the caller can see
 * POST   /v1/admin/orgs/:orgId/project-groups              — create { name, color? }       (owner/admin)
 * PATCH  /v1/admin/orgs/:orgId/project-groups/:gid         — rename / recolor / reorder    (owner/admin)
 * DELETE /v1/admin/orgs/:orgId/project-groups/:gid         — delete the group, not the projects (owner/admin)
 * PUT    /v1/admin/orgs/:orgId/project-groups/:gid/projects — replace members { project_ids } (owner/admin)
 *
 * Membership is checked by portfolioAccess (same as the portfolio). Members
 * only see the projects they can access; the composite FKs in
 * 20261006100000 make a group that spans organizations impossible.
 */

import type { Context, Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { dbError, jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { portfolioAccess } from './portfolio.ts'

type Db = ReturnType<typeof getServiceClient>

const COLORS = ['brand', 'accent', 'info', 'ok', 'warn', 'danger', 'neutral'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pure: a URL-safe slug for a group name ("Kensaurus apps" → "kensaurus-apps"). */
export function groupSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug || 'group'
}

async function requireOrgAdmin(c: Context, db: Db, orgId: string): Promise<Response | null> {
  const userId = c.get('userId') as string
  const { data, error } = await db
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return dbError(c, error)
  const role = (data as { role?: string } | null)?.role
  if (role !== 'owner' && role !== 'admin') {
    return jsonError(c, 'FORBIDDEN', 'Only owners and admins of this organization can change project groups.', 403)
  }
  return null
}

export function registerProjectGroupRoutes(app: Hono<{ Variables: Variables }>): void {
  const read = adminOrApiKey({ scope: 'mcp:read' })
  const write = adminOrApiKey({ scope: 'mcp:write' })

  app.get('/v1/admin/orgs/:orgId/project-groups', read, async (c) => {
    const db = getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const [{ data: groups, error }, { data: members, error: mErr }] = await Promise.all([
      db.from('project_groups').select('id, name, slug, color, sort, updated_at').eq('organization_id', access.orgId).order('sort').order('name'),
      db.from('project_group_members').select('group_id, project_id').eq('organization_id', access.orgId),
    ])
    if (error) return dbError(c, error)
    if (mErr) return dbError(c, mErr)
    const visible = new Set(access.projectIds)
    const byGroup = new Map<string, string[]>()
    for (const m of (members ?? []) as Array<{ group_id: string; project_id: string }>) {
      if (!visible.has(m.project_id)) continue
      byGroup.set(m.group_id, [...(byGroup.get(m.group_id) ?? []), m.project_id])
    }
    return c.json({
      ok: true,
      data: {
        groups: ((groups ?? []) as Array<{ id: string }>).map((g) => ({ ...g, project_ids: byGroup.get(g.id) ?? [] })),
      },
    })
  })

  app.post('/v1/admin/orgs/:orgId/project-groups', write, async (c) => {
    const db = getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const denied = await requireOrgAdmin(c, db, access.orgId)
    if (denied) return denied
    const body = z
      .object({ name: z.string().trim().min(1).max(60), color: z.enum(COLORS).optional() })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return jsonError(c, 'VALIDATION_ERROR', 'Send { name, color? } with a name of 1–60 characters.')
    const { data, error } = await db
      .from('project_groups')
      .insert({
        organization_id: access.orgId,
        name: body.data.name,
        slug: groupSlug(body.data.name),
        color: body.data.color ?? null,
        created_by: c.get('userId') as string,
      })
      .select('id, name, slug, color, sort')
      .single()
    if (error) {
      if (error.code === '23505') return jsonError(c, 'CONFLICT', 'A group with that name already exists.', 409)
      return dbError(c, error)
    }
    return c.json({ ok: true, data: { group: { ...data, project_ids: [] } } }, 201)
  })

  app.patch('/v1/admin/orgs/:orgId/project-groups/:gid', write, async (c) => {
    const gid = c.req.param('gid') ?? ''
    if (!UUID_RE.test(gid)) return jsonError(c, 'NOT_FOUND', 'Group not found', 404)
    const db = getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const denied = await requireOrgAdmin(c, db, access.orgId)
    if (denied) return denied
    const body = z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        color: z.enum(COLORS).nullable().optional(),
        sort: z.number().int().min(0).max(10_000).optional(),
      })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return jsonError(c, 'VALIDATION_ERROR', 'Send any of { name, color, sort }.')
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.data.name !== undefined) {
      patch.name = body.data.name
      patch.slug = groupSlug(body.data.name)
    }
    if (body.data.color !== undefined) patch.color = body.data.color
    if (body.data.sort !== undefined) patch.sort = body.data.sort
    const { data, error } = await db
      .from('project_groups')
      .update(patch)
      .eq('id', gid)
      .eq('organization_id', access.orgId)
      .select('id, name, slug, color, sort')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') return jsonError(c, 'CONFLICT', 'A group with that name already exists.', 409)
      return dbError(c, error)
    }
    if (!data) return jsonError(c, 'NOT_FOUND', 'Group not found', 404)
    return c.json({ ok: true, data: { group: data } })
  })

  app.delete('/v1/admin/orgs/:orgId/project-groups/:gid', write, async (c) => {
    const gid = c.req.param('gid') ?? ''
    if (!UUID_RE.test(gid)) return jsonError(c, 'NOT_FOUND', 'Group not found', 404)
    const db = getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const denied = await requireOrgAdmin(c, db, access.orgId)
    if (denied) return denied
    const { data, error } = await db
      .from('project_groups')
      .delete()
      .eq('id', gid)
      .eq('organization_id', access.orgId)
      .select('id')
    if (error) return dbError(c, error)
    if (!data?.length) return jsonError(c, 'NOT_FOUND', 'Group not found', 404)
    return c.json({ ok: true, data: { deleted: gid } })
  })

  app.put('/v1/admin/orgs/:orgId/project-groups/:gid/projects', write, async (c) => {
    const gid = c.req.param('gid') ?? ''
    if (!UUID_RE.test(gid)) return jsonError(c, 'NOT_FOUND', 'Group not found', 404)
    const db = getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const denied = await requireOrgAdmin(c, db, access.orgId)
    if (denied) return denied
    const body = z
      .object({ project_ids: z.array(z.string().regex(UUID_RE)).max(500) })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return jsonError(c, 'VALIDATION_ERROR', 'Send { project_ids: [uuid, …] }.')
    const wanted = [...new Set(body.data.project_ids)]
    const visible = new Set(access.projectIds)
    const outside = wanted.filter((p) => !visible.has(p))
    if (outside.length) return jsonError(c, 'VALIDATION_ERROR', `${outside.length} project(s) are not in this organization or not visible to you.`)

    const { data: group, error: gErr } = await db
      .from('project_groups')
      .select('id')
      .eq('id', gid)
      .eq('organization_id', access.orgId)
      .maybeSingle()
    if (gErr) return dbError(c, gErr)
    if (!group) return jsonError(c, 'NOT_FOUND', 'Group not found', 404)

    const { data: current, error: cErr } = await db.from('project_group_members').select('project_id').eq('group_id', gid)
    if (cErr) return dbError(c, cErr)
    const have = new Set(((current ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))
    const toAdd = wanted.filter((p) => !have.has(p))
    // Only remove members the caller can see; never drop a project hidden from them.
    const toRemove = [...have].filter((p) => !wanted.includes(p) && visible.has(p))
    if (toRemove.length) {
      const { error } = await db.from('project_group_members').delete().eq('group_id', gid).in('project_id', toRemove)
      if (error) return dbError(c, error)
    }
    if (toAdd.length) {
      const { error } = await db
        .from('project_group_members')
        .insert(toAdd.map((project_id) => ({ group_id: gid, project_id, organization_id: access.orgId })))
      if (error) return dbError(c, error)
    }
    return c.json({ ok: true, data: { group_id: gid, added: toAdd.length, removed: toRemove.length } })
  })
}
