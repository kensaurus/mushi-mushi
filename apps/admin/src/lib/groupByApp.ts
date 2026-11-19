/**
 * FILE: apps/admin/src/lib/groupByApp.ts
 * PURPOSE: One way to group rows by app (project) on every page that shows
 *          more than one app at a time (owner, 2026-11-19: "grouping data of
 *          project and app so it's easier to read — all metadata and data").
 *
 *          Pages build rows as before, then:
 *
 *            const groups = groupByApp(rows, (r) => ({ id: r.project_id, name: r.project_name }), {
 *              rank: (r) => (r.status === 'failed' ? 0 : 1),   // worst first, inside and across groups
 *            })
 *            groups.map((g) => <AppGroupSection key={g.id} app={g} …>{g.items.map(renderRow)}</AppGroupSection>)
 *
 *          Order: the group holding the lowest-ranked (worst) row first, then
 *          the bigger group, then the name. Rows keep their input order
 *          unless `rank` is given. Rows with no app id land in one
 *          "Unassigned" group at the end. Pure: no React, no fetching.
 */

export interface AppRef {
  id: string | null | undefined
  name?: string | null
}

export interface AppGroup<T> {
  /** Project id, or UNASSIGNED_APP_ID. */
  id: string
  name: string
  items: T[]
  /** Lowest rank in the group (Infinity when no rank function). */
  worstRank: number
}

export const UNASSIGNED_APP_ID = '__unassigned__'

export interface GroupByAppOptions<T> {
  /** Lower = more urgent. Sorts rows inside a group and groups against each other. */
  rank?: (item: T) => number
  /** Name for rows whose app has no name (defaults to a short id). */
  fallbackName?: (id: string) => string
}

export function groupByApp<T>(items: readonly T[], appOf: (item: T) => AppRef, opts: GroupByAppOptions<T> = {}): AppGroup<T>[] {
  const { rank, fallbackName = (id) => `App ${id.slice(0, 8)}` } = opts
  const byId = new Map<string, AppGroup<T>>()
  const order: string[] = []
  for (const item of items) {
    const ref = appOf(item)
    const id = ref.id && ref.id.trim() ? ref.id : UNASSIGNED_APP_ID
    let g = byId.get(id)
    if (!g) {
      g = {
        id,
        name: id === UNASSIGNED_APP_ID ? 'Unassigned' : (ref.name?.trim() || fallbackName(id)),
        items: [],
        worstRank: Number.POSITIVE_INFINITY,
      }
      byId.set(id, g)
      order.push(id)
    } else if (g.name.startsWith('App ') && ref.name?.trim()) {
      // A later row knew the name the first one did not.
      g.name = ref.name.trim()
    }
    g.items.push(item)
    if (rank) g.worstRank = Math.min(g.worstRank, rank(item))
  }
  const groups = order.map((id) => byId.get(id)!)
  if (rank) {
    for (const g of groups) {
      // Stable sort: equal ranks keep input order.
      g.items = g.items.map((it, i) => ({ it, i, r: rank(it) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.it)
    }
  }
  return groups.sort((a, b) => {
    if (a.id === UNASSIGNED_APP_ID) return 1
    if (b.id === UNASSIGNED_APP_ID) return -1
    return a.worstRank - b.worstRank || b.items.length - a.items.length || a.name.localeCompare(b.name)
  })
}

/** Counts per key inside one group, e.g. { failed: 2, passed: 5 }, for the header's chips. @internal Exported for tests. */
export function countBy<T, K extends string>(items: readonly T[], keyOf: (item: T) => K | null | undefined): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {}
  for (const it of items) {
    const k = keyOf(it)
    if (k == null) continue
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}
