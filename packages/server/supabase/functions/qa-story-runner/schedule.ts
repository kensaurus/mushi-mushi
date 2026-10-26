/**
 * FILE: packages/server/supabase/functions/qa-story-runner/schedule.ts
 * PURPOSE: Choose which qa_stories a scheduled tick may run.
 *
 * The cron used to load every enabled row. A generated story stays
 * `pending_review` until someone approves it (migration 20260602000002).
 * Manual runs do not use this helper — the API route keeps that gate.
 */

/** The only approval_status a scheduled tick may execute. */
export const SCHEDULED_APPROVAL_STATUS = 'approved'

/** Used when a story row has no schedule_cron. Same default the runner used inline. */
export const DEFAULT_STORY_CRON = '*/15 * * * *'

export interface ScheduledStoryCandidate {
  approval_status?: string | null
  schedule_cron?: string | null
}

/**
 * Stories whose cron is due and whose approval_status is `approved`.
 * `pending_review` and `rejected` stay out even when the cron matches.
 * The query already restricts to `enabled = true`; this is the approval gate.
 */
export function selectStoriesForScheduledTick<T extends ScheduledStoryCandidate>(
  stories: readonly T[],
  now: Date,
  cronMatches: (expression: string, now: Date) => boolean,
): T[] {
  return stories.filter(
    (story) =>
      story.approval_status === SCHEDULED_APPROVAL_STATUS &&
      cronMatches(story.schedule_cron ?? DEFAULT_STORY_CRON, now),
  )
}
