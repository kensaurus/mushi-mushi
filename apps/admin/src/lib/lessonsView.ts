/**
 * FILE: apps/admin/src/lib/lessonsView.ts
 * PURPOSE: Pure helpers for Lessons → Recurring patterns. Young patterns with no name and no
 *          suggested rule all read the same ("Still growing · 1 report · Unnamed pattern"), so
 *          identical ones fold into one row ("2 patterns still growing (1 report each)") instead
 *          of repeating the card (fresh-eyes sweep 2026-11-18).
 */

interface ClusterLike {
  id: string
  status: string
  cluster_size: number
  name: string | null
  suggested_rule: string | null
  last_seen_at: string
}

export type ClusterItem<C extends ClusterLike> =
  | { kind: 'single'; cluster: C }
  | { kind: 'group'; key: string; clusters: C[]; size: number; lastSeenAt: string }

/** An unnamed candidate with no rule yet: nothing tells two of these apart but their size. */
function foldKey(c: ClusterLike): string | null {
  if (c.status !== 'candidate' || c.name || c.suggested_rule) return null
  return `unnamed|${c.cluster_size}`
}

/**
 * Keeps the given order (most reports first). Two or more identical unnamed patterns of the same
 * size become one group, placed where the first of them was.
 */
export function groupClusters<C extends ClusterLike>(clusters: readonly C[]): ClusterItem<C>[] {
  const counts = new Map<string, number>()
  for (const c of clusters) {
    const k = foldKey(c)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const groups = new Map<string, Extract<ClusterItem<C>, { kind: 'group' }>>()
  const out: ClusterItem<C>[] = []
  for (const c of clusters) {
    const k = foldKey(c)
    if (!k || (counts.get(k) ?? 0) < 2) {
      out.push({ kind: 'single', cluster: c })
      continue
    }
    const g = groups.get(k)
    if (g) {
      g.clusters.push(c)
      if (Date.parse(c.last_seen_at) > Date.parse(g.lastSeenAt)) g.lastSeenAt = c.last_seen_at
      continue
    }
    const created = { kind: 'group' as const, key: k, clusters: [c], size: c.cluster_size, lastSeenAt: c.last_seen_at }
    groups.set(k, created)
    out.push(created)
  }
  return out
}

/** "2 patterns still growing (1 report each)"; at 3+ reports a pattern is waiting on its rule, not growing. */
export function groupedClustersLabel(count: number, size: number): string {
  const each = `(${size} ${size === 1 ? 'report' : 'reports'} each)`
  return size >= 3 ? `${count} patterns with no rule suggested yet ${each}` : `${count} patterns still growing ${each}`
}
