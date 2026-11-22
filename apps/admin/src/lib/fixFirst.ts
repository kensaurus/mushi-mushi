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

function severityWeight(r: FixFirstInput): number {
  return SEVERITY_WEIGHT[(r.severity ?? '').toLowerCase()] ?? 0
}

/**
 * Worst severity first, then the most people reached. A weighted score put
 * two Mediums that reached 12 and 9 people above two Criticals (fresh-eyes
 * sweep 2026-11-18): a critical always goes before a medium.
 */
function compareFixFirst(a: FixFirstInput, b: FixFirstInput): number {
  return severityWeight(b) - severityWeight(a) || peopleHit(b) - peopleHit(a) || b.created_at.localeCompare(a.created_at)
}

/**
 * Open reports with no fix on the way, best to fix first; newest wins a tie.
 * One per duplicate group: three Sentry imports of the same timeout filled
 * the top three rows (sweep 2026-10-29).
 * @internal Exported for tests.
 */
export function fixFirstOrder<T extends FixFirstInput>(reports: readonly T[], max = 5): T[] {
  const seen = new Set<string>()
  return reports
    .filter((r) => r.status !== 'fixing')
    .slice()
    .sort(compareFixFirst)
    .filter((r) => {
      if (!r.report_group_id) return true
      if (seen.has(r.report_group_id)) return false
      seen.add(r.report_group_id)
      return true
    })
    .slice(0, max)
}

export interface FixFirstGroup<T> {
  /** The best report of the group (opened by its row). */
  lead: T
  /** Every open report with this title, the lead included. */
  members: T[]
  /** Distinct apps among the members (1 outside All apps). */
  apps: number
}

/**
 * Fix-first rows with one row per title: "Known security hole in next 16.4.2"
 * from three apps was three identical rows (fresh-eyes sweep 2026-11-18); it
 * is one row that says "3 apps".
 */
export function fixFirstGroups<T extends FixFirstInput & { title?: string | null; summary?: string | null; project_id?: string | null }>(
  reports: readonly T[],
  max = 5,
): FixFirstGroup<T>[] {
  const byTitle = new Map<string, FixFirstGroup<T>>()
  const out: FixFirstGroup<T>[] = []
  for (const r of fixFirstOrder(reports, reports.length)) {
    const key = (r.title ?? r.summary ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    const existing = key ? byTitle.get(key) : undefined
    if (existing) {
      existing.members.push(r)
      continue
    }
    const group: FixFirstGroup<T> = { lead: r, members: [r], apps: 1 }
    if (key) byTitle.set(key, group)
    out.push(group)
  }
  for (const g of out) g.apps = new Set(g.members.map((m) => m.project_id ?? '')).size
  return out.slice(0, max)
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
