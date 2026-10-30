/**
 * FILE: apps/admin/src/lib/useTimeToFirstDiagnosis.ts
 * PURPOSE: One read of GET /v1/admin/onboarding/time-to-first-diagnosis for
 *          the Set up rail and the Test it card.
 *
 *          The card used to fetch once on mount. A test report is classified
 *          after that, so the card stayed on "Waiting…" (report 9b7624e6).
 *          invalidateTimeToFirstDiagnosis() drops the short-lived GET cache
 *          and asks every mounted reader to reload. Send-test and the Set up
 *          page's report listener both call it.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { usePageData, type PageDataState } from './usePageData'
import { invalidateApiCache } from './supabase'
import type { TimeToFirstDiagnosis } from './setupRail'

export const TIME_TO_FIRST_DIAGNOSIS_PATH = '/v1/admin/onboarding/time-to-first-diagnosis'

let generation = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Refetch every mounted time-to-first-diagnosis reader. */
export function invalidateTimeToFirstDiagnosis(): void {
  invalidateApiCache(TIME_TO_FIRST_DIAGNOSIS_PATH)
  generation += 1
  for (const listener of listeners) listener()
}

export function useTimeToFirstDiagnosis(projectId: string | null): PageDataState<TimeToFirstDiagnosis> {
  const version = useSyncExternalStore(subscribe, () => generation, () => 0)
  const page = usePageData<TimeToFirstDiagnosis>(projectId ? TIME_TO_FIRST_DIAGNOSIS_PATH : null, {
    deps: [projectId],
  })
  // The first run is the hook's own fetch. Later invalidations reload with
  // cache: 'no-store' so a response from before the test report cannot win.
  const seen = useRef<number | null>(null)
  useEffect(() => {
    if (seen.current === null) {
      seen.current = version
      return
    }
    if (seen.current === version) return
    seen.current = version
    page.reload()
  }, [version, page.reload])
  return page
}
