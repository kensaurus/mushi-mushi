/**
 * FILE: apps/admin/src/lib/fixFirst.ts
 * PURPOSE: "Which bug do I fix first?" (console journeys 2026-10-27, Bugs).
 *          The list sorted newest first; a solo developer wants the bug that
 *          hurts most: the worst severity, hitting the most people, with no
 *          fix on the way yet. A report whose fix is already running or open
 *          (status `fixing`) waits for that fix instead.
 */

export interface FixFirstInput {
  id: string
  status: string
  severity: string | null
  created_at: string
  unique_users?: number
  dedup_count?: number
  /** Duplicates share a group; the queue shows one row per group. */
  report_group_id?: string | null
}

const SEVERITY_WEIGHT: Record<string, number> = { critical: 8, high: 4, medium: 2, low: 1 }

/** People a report reached: distinct users, else its duplicates, at least one. */
export function peopleHit(r: Pick<FixFirstInput, 'unique_users' | 'dedup_count'>): number {
  return Math.max(1, r.unique_users ?? 0, r.dedup_count ?? 0)
}

/** Higher first: severity weight times how many people it reached (log scale, so 100 users do not drown a critical). */
function fixFirstScore(r: FixFirstInput): number {
  const weight = SEVERITY_WEIGHT[(r.severity ?? '').toLowerCase()] ?? 1
  return weight * (1 + Math.log2(peopleHit(r)))
}

/**
 * Open reports with no fix on the way, best to fix first; newest wins a tie.
 * One per duplicate group: three Sentry imports of the same timeout filled
 * the top three rows (sweep 2026-10-29).
 */
export function fixFirstOrder<T extends FixFirstInput>(reports: readonly T[], max = 5): T[] {
  const seen = new Set<string>()
  return reports
    .filter((r) => r.status !== 'fixing')
    .slice()
    .sort((a, b) => fixFirstScore(b) - fixFirstScore(a) || b.created_at.localeCompare(a.created_at))
    .filter((r) => {
      if (!r.report_group_id) return true
      if (seen.has(r.report_group_id)) return false
      seen.add(r.report_group_id)
      return true
    })
    .slice(0, max)
}

/**
 * "Where in the code does <bug> come from?" for the top open bugs: Code map's
 * suggested questions. Bugs that share a title ask once (three "DbError:
 * canceling statement…" reports made three identical chips, 2026-10-28).
 */
export function bugQuestions(reports: ReadonlyArray<FixFirstInput & { title?: string | null; summary?: string | null }>, max = 3): string[] {
  const questions = fixFirstOrder(reports, reports.length)
    .map((r) => (r.title ?? r.summary ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((t) => `Where in the code does "${t.length > 70 ? `${t.slice(0, 69)}…` : t}" come from?`)
  return [...new Set(questions)].slice(0, max)
}
