/**
 * FILE: packages/server/supabase/functions/qa-story-runner/cron-tick.ts
 * PURPOSE: The minute a cron call was made for.
 *
 * qa-story-runner-tick posts only when mushi.qa_story_runner_has_work() finds
 * a story due this minute (migration 20261111091825_cron_edge_work_gates),
 * and sends that minute as `tick`. Matching schedules against the arrival
 * time instead would skip the story whenever pg_net delivers the call in the
 * next minute.
 */

/** A tick older than this is ignored (the call runs as of its arrival). */
export const MAX_TICK_LAG_MS = 10 * 60_000
/** Clock skew allowed between the database and the edge runtime. */
export const MAX_TICK_LEAD_MS = 60_000

/**
 * The `tick` time when it is readable, at most a minute ahead of `now` and at
 * most 10 minutes behind it; otherwise `now`.
 */
export function cronTickTime(tick: string | undefined, now: Date): Date {
  if (!tick) return now
  const t = Date.parse(tick)
  if (!Number.isFinite(t)) return now
  if (t - now.getTime() > MAX_TICK_LEAD_MS || now.getTime() - t > MAX_TICK_LAG_MS) return now
  return new Date(t)
}
