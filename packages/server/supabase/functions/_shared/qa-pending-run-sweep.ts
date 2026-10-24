/**
 * FILE: packages/server/supabase/functions/_shared/qa-pending-run-sweep.ts
 * PURPOSE: Expire manual QA runs whose runner never started.
 *
 * POST …/qa-stories/:sid/run inserts a pending qa_story_runs row and
 * fire-and-forgets qa-story-runner. A 503 BOOT_ERROR (or a dropped invoke)
 * leaves that row pending, and the console treats pending as in flight.
 * The runner's own cron tick calls this and marks those rows error.
 */

/** How long a manual run may stay pending before we treat the invoke as lost. */
export const MANUAL_RUN_START_TIMEOUT_MS = 10 * 60 * 1000

/** Stored on qa_story_runs.error_message when the sweep expires a row. */
export const RUNNER_DID_NOT_START = 'runner did not start'

interface PendingRunUpdate {
  eq(column: string, value: unknown): PendingRunUpdate
  lt(column: string, value: string): PendingRunUpdate
  select(columns: string): PromiseLike<{
    data: Array<{ id: string }> | null
    error: { message: string } | null
  }>
}

/** The slice of the Supabase client this needs (kept narrow for tests). */
export interface QaPendingSweepDb {
  from(table: 'qa_story_runs'): {
    update(patch: {
      status: 'error'
      error_message: string
      summary: string
      finished_at: string
      latency_ms: number
    }): PendingRunUpdate
  }
}

/**
 * Marks pending manual runs older than MANUAL_RUN_START_TIMEOUT_MS as error.
 * The clock is started_at: the manual route leaves the column default
 * (insert time) and never overwrites it when the runner fails to boot.
 * A run that reached `running` is left alone — this only covers "never started".
 */
export async function sweepStalePendingManualRuns(
  db: QaPendingSweepDb,
  now: Date = new Date(),
  timeoutMs: number = MANUAL_RUN_START_TIMEOUT_MS,
): Promise<{ expired: number; error: string | null }> {
  const cutoff = new Date(now.getTime() - timeoutMs).toISOString()
  const { data, error } = await db
    .from('qa_story_runs')
    .update({
      status: 'error',
      error_message: RUNNER_DID_NOT_START,
      summary: RUNNER_DID_NOT_START,
      finished_at: now.toISOString(),
      latency_ms: 0,
    })
    .eq('status', 'pending')
    .eq('triggered_by', 'manual')
    .lt('started_at', cutoff)
    .select('id')
  if (error) return { expired: 0, error: error.message }
  return { expired: data?.length ?? 0, error: null }
}
