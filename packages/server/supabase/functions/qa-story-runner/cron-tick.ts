/**
 * FILE: packages/server/supabase/functions/qa-story-runner/cron-tick.ts
 * PURPOSE: The minute a cron call was made for.
 *
 * qa-story-runner-tick posts only when mushi.qa_story_runner_has_work() finds
 * a story due this minute (migration 20261111091825_cron_edge_work_gates),
 * and sends that minute as `tick`. Matching schedules against the arrival
 * time instead would skip the story whenever pg_net delivers the call in the
 * next minute.
 *
 * isApprovedForSchedule is the cron path's approval gate (migration
 * 20260602000002). Manual runs do not use it.
 *
 * isEdgeScheduledProvider keeps browser_provider = 'local' off the cron
 * path. The edge runner cannot start a local browser, and recording those
 * stories as skipped every tick filled qa_story_runs. The CLI runs them.
 * Manual runs do not use this helper.
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

/**
 * Scheduled runs require approval_status = 'approved'.
 * pending_review and rejected stories stay off the cron even when enabled
 * is still true. A missing status does not run.
 */
export function isApprovedForSchedule(story: { approval_status?: string | null }): boolean {
  return story.approval_status === 'approved'
}

/**
 * Scheduled edge runs execute firecrawl and browserbase stories.
 * `local` stays on the CLI; a missing provider is not treated as local.
 */
export function isEdgeScheduledProvider(story: { browser_provider?: string | null }): boolean {
  return story.browser_provider !== 'local'
}
