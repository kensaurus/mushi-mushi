/**
 * FILE: packages/server/supabase/functions/qa-story-runner/abandoned-runs.ts
 * PURPOSE: Close manual QA runs whose runner never started.
 *
 * POST /qa-stories/:sid/run inserts a pending row and fire-and-forgets the
 * runner. A 503 BOOT_ERROR (or a dropped invoke) never updates that row, and
 * the cron path inserts its own runs instead of adopting it. `started_at`
 * is set at insert. Cron checks every minute (`qa-story-runner-tick`) and
 * calls the runner when a row like this exists (mushi.qa_story_runner_has_work
 * uses the same 10 minutes), so a manual row still pending after 10 minutes
 * did not start.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

/** Older than this, a pending manual run is an invoke that never started. */
export const ABANDONED_MANUAL_RUN_MS = 10 * 60 * 1000

export const RUNNER_DID_NOT_START = 'runner did not start'

/**
 * Mark abandoned manual runs as error. Throws on a database error so the
 * caller can keep the rest of the tick going.
 * Returns how many rows changed.
 */
export async function failAbandonedManualRuns(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_MANUAL_RUN_MS).toISOString()
  const { data, error } = await db
    .from('qa_story_runs')
    .update({
      status: 'error',
      error_message: RUNNER_DID_NOT_START,
      finished_at: now.toISOString(),
    })
    .eq('status', 'pending')
    .eq('triggered_by', 'manual')
    .lt('started_at', cutoff)
    .select('id')

  if (error) {
    const message = typeof error.message === 'string' && error.message
      ? error.message
      : 'qa_story_runs update failed'
    throw new Error(message)
  }
  return data?.length ?? 0
}

/** Same sweep, but a database error is logged and does not fail the cron tick. */
export async function sweepAbandonedManualRuns(
  db: SupabaseClient,
  now: Date = new Date(),
  warn: (message: string, fields?: Record<string, unknown>) => void = () => {},
): Promise<number> {
  try {
    return await failAbandonedManualRuns(db, now)
  } catch (err) {
    warn('abandoned manual run sweep failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    return 0
  }
}
