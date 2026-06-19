/**
 * Publish authoritative page /stats into the layout hero lane.
 */

import { useMemo } from 'react'
import { buildHeroEnrichment } from '../layoutHeroFromStats'
import { usePublishHeroSnapshot, type PageHeroSnapshot } from '../pageHeroSnapshot'
import { syntheticNavCountsForRoute } from './syntheticNavCounts'

export function heroSnapshotFromPageStats(route: string, stats: unknown): PageHeroSnapshot | null {
  const counts = syntheticNavCountsForRoute(route, stats)
  if (!counts) return null
  const enrichment = buildHeroEnrichment(route, counts)
  if (Object.keys(enrichment).length === 0) return null
  return { route, ...enrichment }
}

/** Call on any page that loads `/stats` — overrides stale layout nav-meta zeros. */
export function usePublishPageHeroStats(route: string, stats: unknown | null | undefined): void {
  const snapshot = useMemo(
    () => (stats != null ? heroSnapshotFromPageStats(route, stats) : null),
    [route, stats],
  )
  usePublishHeroSnapshot(snapshot)
}

export { syntheticNavCountsForRoute, READY_NAV_COUNTS_SEED } from './syntheticNavCounts'
