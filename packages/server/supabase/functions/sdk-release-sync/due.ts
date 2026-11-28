/**
 * FILE: packages/server/supabase/functions/sdk-release-sync/due.ts
 * PURPOSE: Which upgrade jobs the 5-minute cron still reads from GitHub.
 *
 * A merged upgrade PR is followed until its deployment reports success or
 * failure. A repo without GitHub deployments never reports either, so the job
 * stayed "merged" / "deploying" and was read every 5 minutes for good: on
 * 2026-11-28, 19 jobs merged 2 to 8 weeks earlier cost 288 runs × 19 of a
 * token lookup, a Vault read, three GitHub calls and a row update each day
 * (about 5.5k PostgREST calls and 16k GitHub calls).
 *
 * A deploy follows its merge within hours, so a job merged more than
 * RELEASE_SYNC_MERGED_WINDOW_DAYS ago is no longer polled. It keeps its last
 * state; "Check CI status" in the console (POST /sdk-upgrade/:id/sync) still
 * reads it on demand. A job not merged yet is always polled.
 */

export const RELEASE_SYNC_MERGED_WINDOW_DAYS = 7

export function isDueForReleaseSync(job: { merged_at: string | null }, nowMs: number): boolean {
  if (!job.merged_at) return true
  const merged = Date.parse(job.merged_at)
  if (!Number.isFinite(merged)) return true
  return nowMs - merged <= RELEASE_SYNC_MERGED_WINDOW_DAYS * 86_400_000
}
