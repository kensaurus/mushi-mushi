/**
 * Report-group merge (/graph?tab=backend "Merge groups").
 *
 * The route used to ignore every write error and answer `{ ok: true }`, so a
 * failed move still deleted the source group and reported success. Each step
 * is now checked, and the source group is only deleted after its reports
 * moved and the target's count was written.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type MergeGroupsResult =
  | { ok: true; moved: number; reportCount: number }
  | { ok: false; step: 'move' | 'count' | 'update' | 'delete'; message: string }

/** Roles that may merge (and so delete) report groups. Viewers only read. */
export function canMergeReportGroups(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'member'
}

export async function mergeReportGroups(
  db: SupabaseClient,
  sourceGroupId: string,
  targetGroupId: string,
  /** Both groups' project: the move never touches another project's reports. */
  projectId?: string,
): Promise<MergeGroupsResult> {
  let move = db
    .from('reports')
    .update({ report_group_id: targetGroupId })
    .eq('report_group_id', sourceGroupId)
  if (projectId) move = move.eq('project_id', projectId)
  const { data: moved, error: moveErr } = await move.select('id')
  if (moveErr) return { ok: false, step: 'move', message: moveErr.message }

  const { count, error: countErr } = await db
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('report_group_id', targetGroupId)
  if (countErr || count == null) return { ok: false, step: 'count', message: countErr?.message ?? 'count unavailable' }

  const { error: updateErr } = await db
    .from('report_groups')
    .update({ report_count: count, updated_at: new Date().toISOString() })
    .eq('id', targetGroupId)
  if (updateErr) return { ok: false, step: 'update', message: updateErr.message }

  const { error: deleteErr } = await db.from('report_groups').delete().eq('id', sourceGroupId)
  if (deleteErr) return { ok: false, step: 'delete', message: deleteErr.message }

  return { ok: true, moved: (moved ?? []).length, reportCount: count }
}
