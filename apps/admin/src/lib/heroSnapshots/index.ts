/**
 * Build a page hero snapshot from a page's /stats payload.
 */

import { buildHeroEnrichment } from '../layoutHeroFromStats'
import type { PageHeroSnapshot } from '../pageHeroSnapshot'
import { syntheticNavCountsForRoute } from './syntheticNavCounts'

export function heroSnapshotFromPageStats(route: string, stats: unknown): PageHeroSnapshot | null {
  const counts = syntheticNavCountsForRoute(route, stats)
  if (!counts) return null
  const enrichment = buildHeroEnrichment(route, counts)
  if (Object.keys(enrichment).length === 0) return null
  return { route, ...enrichment }
}
