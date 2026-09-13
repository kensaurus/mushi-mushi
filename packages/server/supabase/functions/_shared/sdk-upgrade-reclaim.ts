/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-reclaim.ts
 * PURPOSE: Pure claim/reclaim rules for sdk_upgrade_jobs.
 *
 * OVERVIEW:
 * - queued → claim (CAS queued → running)
 * - running + started_at older than 20 min (or missing) → reclaim the same row
 * - running + recent started_at → skip (another worker is live)
 *
 * The unique index sdk_upgrade_jobs_one_active_per_project blocks a second
 * enqueue while status is queued/running. A crashed worker that never
 * finalizes would otherwise deadlock the project forever. Reclaim + the
 * SQL reaper (failed after 30 min) unblock it.
 */

export const SDK_UPGRADE_STALE_MS = 20 * 60 * 1000

export type SdkUpgradeClaimAction = 'claim' | 'reclaim' | 'skip'

export interface SdkUpgradeClaimJob {
  status: string
  started_at?: string | null
}

export function shouldClaimSdkUpgradeJob(
  job: SdkUpgradeClaimJob,
  nowMs = Date.now(),
  staleMs = SDK_UPGRADE_STALE_MS,
): SdkUpgradeClaimAction {
  if (job.status === 'queued') return 'claim'
  if (job.status !== 'running') return 'skip'

  const started = job.started_at ? Date.parse(job.started_at) : NaN
  if (!Number.isFinite(started) || nowMs - started >= staleMs) return 'reclaim'
  return 'skip'
}
