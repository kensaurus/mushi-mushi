/**
 * FILE: packages/server/supabase/functions/api/routes/work-fresh-eyes-wake.ts
 * PURPOSE: Which of a heartbeat's lanes should ask for work now because their
 *          app has a first-time user test waiting (ADR 0053 amendment
 *          2026-10-28). Split from work-fresh-eyes.ts so the heartbeat route,
 *          which `api` serves, imports only this read and not the claim's
 *          account, persona and budget code (api's upload budget,
 *          scripts/deploy-edge-function.test.mjs).
 */

import type { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'

type Db = ReturnType<typeof getServiceClient>

const flog = log.child('work-fresh-eyes')

/** A queued run nobody took in this long stops (fresh-eyes-queue.ts FRESH_EYES_QUEUED_TTL_MS). */
const QUEUED_TTL_MS = 24 * 3_600_000

/** Lane ids among `lanes` whose app has a first-time user test waiting; only for a daemon that runs them. */
export async function lanesToWake(db: Db, lanes: ReadonlyArray<{ id: string; projectId: string }>, takesFreshEyes: boolean, now: Date): Promise<string[]> {
  if (!takesFreshEyes || lanes.length === 0) return []
  const projectIds = [...new Set(lanes.map((l) => l.projectId))]
  const { data, error } = await db
    .from('ux_runs')
    .select('project_id')
    .in('project_id', projectIds)
    .eq('kind', 'fresh_eyes')
    .eq('status', 'queued')
    .gt('started_at', new Date(now.getTime() - QUEUED_TTL_MS).toISOString())
    .limit(50)
  if (error) {
    flog.warn('queued tests unreadable; no lane woken', { err: error.message })
    return []
  }
  const waiting = new Set(((data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))
  return lanes.filter((l) => waiting.has(l.projectId)).map((l) => l.id)
}
