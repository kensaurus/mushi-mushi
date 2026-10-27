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

/** Open reports with no fix on the way, best to fix first; newest wins a tie. */
export function fixFirstOrder<T extends FixFirstInput>(reports: readonly T[], max = 5): T[] {
  return reports
    .filter((r) => r.status !== 'fixing')
    .slice()
    .sort((a, b) => fixFirstScore(b) - fixFirstScore(a) || b.created_at.localeCompare(a.created_at))
    .slice(0, max)
}

/** "Where in the code does <bug> come from?" for the top open bugs: Code map's suggested questions. */
export function bugQuestions(reports: ReadonlyArray<FixFirstInput & { title?: string | null; summary?: string | null }>, max = 3): string[] {
  return fixFirstOrder(reports, max)
    .map((r) => (r.title ?? r.summary ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((t) => `Where in the code does "${t.length > 70 ? `${t.slice(0, 69)}…` : t}" come from?`)
}
