/**
 * FILE: qa-schedule.ts
 * PURPOSE: Decide which QA stories a scheduled tick actually runs.
 *
 * `local` stories run on the operator's machine (`mushi qa run`). The cloud
 * tick used to insert a `skipped` qa_story_runs row for each of them every
 * minute. Stories past the per-project cap were also recorded as skipped,
 * which consumed their cron slot, so a project whose stories share
 * `0 * * * *` only ever ran the first three.
 *
 * A story is due from its latest cron slot inside the last hour until any
 * run starts in that slot, including a skipped cloud run (Browserbase on
 * the edge finishes as skipped). The tick runs the oldest few; the rest
 * stay due and the next minute picks them up. Nothing is written for a
 * story this tick does not run.
 *
 * A new story waits for the first slot at or after `created_at`. The table
 * has no `enabled_at`, so a story turned back on still runs for a slot
 * inside the hour. Catch-up stops at one hour: a long outage replays only
 * stories whose slot is still inside that window.
 */

/** Cloud stories started per project per minute tick. */
export const QA_SCHEDULE_CAP = 3

/** Catch-up window. One hour keeps an hourly slot due until the next one. */
export const QA_SCHEDULE_LOOKBACK_MINUTES = 60

export interface QaScheduleStory {
  id: string
  project_id: string
  browser_provider: string
  schedule_cron: string | null
  /** Start of the latest run in the lookback, any status, or null when none is known. */
  last_run_at: string | null
  /** Slots that started earlier do not count. Absent callers keep the lookback rule only. */
  created_at?: string | null
}

export interface QaScheduleDecision<T extends QaScheduleStory> {
  run: T[]
  /** Due, but past this tick's cap. Leave them alone. */
  deferred: T[]
}

/** Minimal 5-field cron matcher (min hour dom month dow), UTC. */
export function cronMatches(expression: string, now: Date): boolean {
  const fields = expression.trim().split(/\s+/)
  if (fields.length < 5) return true

  function matchField(field: string, val: number): boolean {
    if (field === '*') return true
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10)
      return step > 0 && val % step === 0
    }
    return field.split(',').some((v) => parseInt(v, 10) === val)
  }

  const [min, hour, dom, mon, dow] = fields
  return (
    matchField(min, now.getUTCMinutes()) &&
    matchField(hour, now.getUTCHours()) &&
    matchField(dom, now.getUTCDate()) &&
    matchField(mon, now.getUTCMonth() + 1) &&
    matchField(dow, now.getUTCDay())
  )
}

/** Most recent UTC minute at or before `now` that the expression matches. */
export function latestCronSlot(
  expression: string,
  now: Date,
  lookbackMinutes = QA_SCHEDULE_LOOKBACK_MINUTES,
): Date | null {
  const t = new Date(now.getTime())
  t.setUTCSeconds(0, 0)
  for (let i = 0; i <= lookbackMinutes; i++) {
    if (cronMatches(expression, t)) return new Date(t.getTime())
    t.setUTCMinutes(t.getUTCMinutes() - 1)
  }
  return null
}

function isDue(story: QaScheduleStory, now: Date): boolean {
  const slot = latestCronSlot(story.schedule_cron ?? '*/15 * * * *', now)
  if (!slot) return false
  if (story.created_at) {
    const created = Date.parse(story.created_at)
    // The slot's minute started before the story existed.
    if (!Number.isNaN(created) && slot.getTime() < created) return false
  }
  if (!story.last_run_at) return true
  const last = Date.parse(story.last_run_at)
  if (Number.isNaN(last)) return true
  return last < slot.getTime()
}

function byOldestRun(a: QaScheduleStory, b: QaScheduleStory): number {
  if (a.last_run_at === null && b.last_run_at !== null) return -1
  if (a.last_run_at !== null && b.last_run_at === null) return 1
  if (a.last_run_at !== null && b.last_run_at !== null && a.last_run_at !== b.last_run_at) {
    return a.last_run_at < b.last_run_at ? -1 : 1
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Cloud stories to run this tick, oldest last run first, at most `cap` per
 * project. Local stories are omitted. Deferred stories are still due.
 */
export function selectScheduledStories<T extends QaScheduleStory>(
  stories: readonly T[],
  now: Date,
  cap = QA_SCHEDULE_CAP,
): QaScheduleDecision<T> {
  const due = stories.filter((s) => s.browser_provider !== 'local' && isDue(s, now))
  due.sort(byOldestRun)
  const counts = new Map<string, number>()
  const run: T[] = []
  const deferred: T[] = []
  for (const story of due) {
    const n = counts.get(story.project_id) ?? 0
    if (n >= cap) deferred.push(story)
    else {
      counts.set(story.project_id, n + 1)
      run.push(story)
    }
  }
  return { run, deferred }
}

/** Latest `started_at` per story. Rows may arrive in any order. */
export function indexLastRuns(rows: readonly { story_id: string; started_at: string }[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    const prev = map.get(row.story_id)
    if (!prev || row.started_at > prev) map.set(row.story_id, row.started_at)
  }
  return map
}
