/**
 * FILE: packages/server/supabase/functions/_shared/project-groups.ts
 * PURPOSE: Narrow a list of project ids to one project group (Plan 021), for
 *          the portfolio's `?group=` filter. Accepts the group id or slug.
 */

import type { getServiceClient } from './db.ts'

type Db = ReturnType<typeof getServiceClient>
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Narrow a project-id list to one group's members (portfolio `?group=`). */
export async function filterToGroup(
  db: Db,
  orgId: string,
  projectIds: string[],
  group: string,
): Promise<{ ok: true; projectIds: string[] } | { ok: false; error: string }> {
  const q = db.from('project_groups').select('id').eq('organization_id', orgId)
  const { data, error } = await (UUID_RE.test(group) ? q.eq('id', group) : q.eq('slug', group)).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'not_found' }
  const { data: members, error: mErr } = await db.from('project_group_members').select('project_id').eq('group_id', (data as { id: string }).id)
  if (mErr) return { ok: false, error: mErr.message }
  const inGroup = new Set(((members ?? []) as Array<{ project_id: string }>).map((m) => m.project_id))
  return { ok: true, projectIds: projectIds.filter((p) => inGroup.has(p)) }
}
