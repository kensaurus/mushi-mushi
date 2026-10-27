/**
 * FILE: packages/server/supabase/functions/api/routes/review-followup-stats.ts
 * PURPOSE: The review follow-up scoreboard (ADR 0032) over the apps the
 *          caller can access. GET /v1/admin/byok/spend-down (MCP
 *          get_spend_down_status) returns it as `reviewFollowups`; GET
 *          /v1/admin/byok/review-followups returns it as `scoreboard`.
 *          Read-only, and kept apart from the spend-down key rows.
 */

import type { Context } from 'npm:hono@4'
import type { getServiceClient } from '../../_shared/db.ts'
import { accessibleProjectIds } from '../../_shared/project-access.ts'
import { FOLLOWUP_SCOREBOARD_DAYS, followupScoreboard, type FollowupScoreboard } from '../../_shared/review-followup.ts'
import { followupScoreRows } from '../../_shared/review-followup-db.ts'

type Db = ReturnType<typeof getServiceClient>

/**
 * The apps of this project's organization the caller can access. A
 * project-bound API key sees its own app only; a person or an account key
 * sees what accessibleProjectIds allows (ADR 0026 limits included).
 */
export async function followupScopeProjectIds(c: Context, db: Db, project: { id: string; organization_id?: unknown }): Promise<string[]> {
  const orgId = (project.organization_id as string | null) ?? null
  if (c.get('authMethod') === 'apiKey' && !c.get('isOrgScopedKey')) return [project.id]
  const userId = c.get('userId') as string | undefined
  if (!userId || !orgId) return [project.id]
  const accessible = new Set(await accessibleProjectIds(db, userId, { strict: true }))
  const { data, error } = await db.from('projects').select('id').eq('organization_id', orgId)
  if (error) throw new Error(`organization projects read failed: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((p) => p.id).filter((id) => accessible.has(id))
}

export interface ReviewFollowupStats extends FollowupScoreboard {
  since: string
  /** How many apps the numbers cover (the ones the caller can access). */
  apps: number
}

/** The last 7 days of follow-ups over `projectIds` (already scoped to the caller). */
export async function reviewFollowupStatsFor(db: Db, projectIds: string[], now = new Date()): Promise<ReviewFollowupStats> {
  const board = followupScoreboard(await followupScoreRows(db, projectIds, now), FOLLOWUP_SCOREBOARD_DAYS)
  return { ...board, since: new Date(now.getTime() - FOLLOWUP_SCOREBOARD_DAYS * 86_400_000).toISOString(), apps: projectIds.length }
}

/** The last 7 days of follow-ups over the apps the caller can access. */
export async function reviewFollowupStats(c: Context, db: Db, project: { id: string; organization_id?: unknown }, now = new Date()): Promise<ReviewFollowupStats> {
  return reviewFollowupStatsFor(db, await followupScopeProjectIds(c, db, project), now)
}
