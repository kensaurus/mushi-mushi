/**
 * FILE: apps/admin/src/components/graph/graphSnapshot.ts
 * PURPOSE: Which GRAPH SNAPSHOT tiles to draw. Four tiles of 0 with a green
 *          "Hotspots 0" (fresh-eyes 2026-11-18) said "all clear" for a map that
 *          had no links to judge. A tile is drawn only for a count above zero;
 *          the zeros collapse into one plain line, and hotspots read "not
 *          enough links to tell" until a link exists, never a calm 0.
 */

import type { GraphStats } from './GraphStatsTypes'

type GraphSnapshotKey = 'clusters' | 'links' | 'fragile' | 'inventory'

export interface GraphSnapshotPlan {
  /** Tiles worth drawing, in display order. */
  tiles: GraphSnapshotKey[]
  /** One line for every count that is zero or unknown; null when none. */
  zeroLine: string | null
}

export function planGraphSnapshot(
  stats: Pick<GraphStats, 'reportNodes' | 'edgeCount' | 'fragileComponents' | 'inventoryNodes'>,
  labels: { fragile: string } = { fragile: 'Hotspots' },
): GraphSnapshotPlan {
  const tiles: GraphSnapshotKey[] = []
  const quiet: string[] = []
  // Round 3 (2026-11-19): the status line above already says "N bug groups, no links between them
  // yet", so the zero line no longer repeats no clusters, no links or "hotspots: not enough links".
  if (stats.reportNodes > 0) tiles.push('clusters')
  if (stats.edgeCount > 0) tiles.push('links')
  if (stats.fragileComponents > 0) tiles.push('fragile')
  else if (stats.edgeCount > 0) quiet.push(`no ${labels.fragile.toLowerCase()}`)
  if (stats.inventoryNodes > 0) tiles.push('inventory')
  else quiet.push('no inventory items')
  if (quiet.length === 0) return { tiles, zeroLine: null }
  const line = quiet.join(' · ')
  return { tiles, zeroLine: line.charAt(0).toUpperCase() + line.slice(1) }
}
