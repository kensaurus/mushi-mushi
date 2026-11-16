/**
 * FILE: packages/server/supabase/functions/qa-story-runner/schedule.ts
 * PURPOSE: Decide which QA stories the cron path actually starts.
 *
 * Local stories (`browser_provider = 'local'`) run only through
 * `mushi qa run`. A missing provider stays eligible: SQL `<>` / PostgREST
 * `neq` would drop those rows. Stories past the per-project cap are left
 * out of the result with no run row, so they stay due. The next tick
 * (and any later minute in DUE_CARRY_MINUTES) picks them up, oldest
 * last_run_at first, instead of writing `skipped` and starving the tail.
 *
 * mushi.qa_story_runner_has_work (migration 20261117010000) uses the same
 * carry window, local exclusion, and "non-skipped run covers the slot" rule.
 */

/** How long a matched minute stays due when that slot has not run. */
export const DUE_CARRY_MINUTES = 60

/** Null or blank schedule_cron, matching the runner's historical fallback. */
export const DEFAULT_SCHEDULE_CRON = '*/15 * * * *'

export function isEdgeSchedulable(story: { browser_provider?: string | null }): boolean {
  return story.browser_provider !== 'local'
}

/** Minimal 5-field cron matcher (min, hour, dom, month, dow), UTC. */
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
    matchField(min!, now.getUTCMinutes()) &&
    matchField(hour!, now.getUTCHours()) &&
    matchField(dom!, now.getUTCDate()) &&
    matchField(mon!, now.getUTCMonth() + 1) &&
    matchField(dow!, now.getUTCDay())
  )
}

function minuteStart(at: Date): number {
  return Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    at.getUTCHours(),
    at.getUTCMinutes(),
  )
}

/**
 * True when `expression` matched `matchAt` or an earlier minute inside the
 * carry window, and no non-skipped run has started at or after that minute.
 * A null last run has never completed a slot.
 */
export function storyIsDue(
  expression: string | null | undefined,
  matchAt: Date,
  lastRunAt: string | null,
  carryMinutes: number,
): boolean {
  const expr = expression?.trim() ? expression : DEFAULT_SCHEDULE_CRON
  const origin = minuteStart(matchAt)
  const steps = Math.max(0, carryMinutes)
  const lastMs = lastRunAt ? Date.parse(lastRunAt) : Number.NaN
  for (let i = 0; i <= steps; i++) {
    const slot = new Date(origin - i * 60_000)
    if (!cronMatches(expr, slot)) continue
    if (!Number.isFinite(lastMs) || lastMs < slot.getTime()) return true
  }
  return false
}

export interface ScheduledStory {
  id: string
  project_id: string
  schedule_cron?: string | null
  browser_provider?: string | null
  last_run_at?: string | null
}

/**
 * Stories to start this tick. Overflow is omitted (not returned as skipped).
 * Never-run stories sort first, then the oldest last_run_at.
 */
export function selectDueStories<T extends ScheduledStory>(
  stories: T[],
  matchAt: Date,
  maxPerProject: number,
  carryMinutes: number,
): T[] {
  const due = stories.filter((s) =>
    isEdgeSchedulable(s) &&
    storyIsDue(s.schedule_cron, matchAt, s.last_run_at ?? null, carryMinutes),
  )
  due.sort((a, b) => {
    const rank = (s: ScheduledStory) => {
      if (s.last_run_at == null || s.last_run_at === '') return Number.NEGATIVE_INFINITY
      const t = Date.parse(s.last_run_at)
      return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
    }
    const delta = rank(a) - rank(b)
    if (delta !== 0) return delta
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  const counts = new Map<string, number>()
  const run: T[] = []
  for (const s of due) {
    const n = (counts.get(s.project_id) ?? 0) + 1
    counts.set(s.project_id, n)
    if (n <= maxPerProject) run.push(s)
  }
  return run
}
