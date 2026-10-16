/**
 * Pages publish fresher hero metrics than layout nav-meta (which loads once
 * and may lag). Layout merges page snapshots over nav-count patches.
 */

import { useEffect, useMemo } from 'react'
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

type Listener = () => void

let current: PageHeroSnapshot | null = null
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

export function usePublishHeroSnapshot(snapshot: PageHeroSnapshot | null): void {
  const stableKey = useMemo(
    () => (snapshot ? JSON.stringify({ ...snapshot, act: snapshot.act ? { ...snapshot.act, primary: snapshot.act.primary, secondary: snapshot.act.secondary } : null }) : ''),
    [snapshot],
  )

  useEffect(() => {
    current = snapshot
    emit()
    return () => {
      if (current === snapshot) {
        current = null
        emit()
      }
    }
  }, [stableKey, snapshot])
}

/** Split "3 members · 2 inactive" into display chips. */
export function heroMetricChips(metric?: string): string[] {
  if (!metric?.trim()) return []
  return metric
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean)
}
