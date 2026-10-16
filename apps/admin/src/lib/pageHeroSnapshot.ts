/**
 * Page hero snapshot shape and metric-chip helper. The publish/subscribe store
 * pages once wrote into had no reader left and was removed on 2026-10-16.
 */

import type { PageHeroDecide, PageHeroVerify } from '../components/PageHero'
import type { PageAction } from '../components/PageActionBar'
import type { HeroActIdle } from './layoutHeroFromStats'

export interface PageHeroSnapshot {
  route: string
  decide?: Partial<PageHeroDecide>
  verify?: Partial<PageHeroVerify>
  act?: PageAction | null
  actIdle?: HeroActIdle
}

/** Split "3 members · 2 inactive" into display chips. */
export function heroMetricChips(metric?: string): string[] {
  if (!metric?.trim()) return []
  return metric
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean)
}
