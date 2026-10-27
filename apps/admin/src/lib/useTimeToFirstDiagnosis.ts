/**
 * FILE: apps/admin/src/lib/useTimeToFirstDiagnosis.ts
 * PURPOSE: One read of GET /v1/admin/onboarding/time-to-first-diagnosis for
 *          the Set up rail and the Verify card.
 *
 *          Both used to fetch once on mount. Sending the test report the
 *          Verify tab asks for classifies it, then the card kept its first
 *          answer — waiting on the first classified report — because nothing
 *          refetched this route (report 9b7624e6).
 *
 * DEPENDENCIES: usePageData, apiFetch cache (invalidateApiCache)
 * USAGE: useTimeToFirstDiagnosis() in the card and the rail;
 *        invalidateTimeToFirstDiagnosis() after a test report and from the
 *        Set up page's report realtime reload.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { invalidateApiCache } from './supabase'
import { usePageData, type PageDataState } from './usePageData'
import type { TimeToFirstDiagnosis } from './setupRail'

const PATH = '/v1/admin/onboarding/time-to-first-diagnosis'

let epoch = 0
const listeners = new Set<() => void>()

/** Drop the cached answer and tell every mounted reader to reload. */
export function invalidateTimeToFirstDiagnosis(): void {
  invalidateApiCache(PATH)
  epoch += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTimeToFirstDiagnosis(
  enabled = true,
  deps: ReadonlyArray<string | number | boolean | null | undefined> = [],
): PageDataState<TimeToFirstDiagnosis> {
  const refreshEpoch = useSyncExternalStore(subscribe, () => epoch, () => 0)
  const page = usePageData<TimeToFirstDiagnosis>(enabled ? PATH : null, { deps })
  const reload = page.reload
  // The mount fetch is usePageData's. A later invalidate must bypass the
  // micro-cache (reload → cache: 'no-store'); a dep change would not.
  const seen = useRef(refreshEpoch)
  useEffect(() => {
    if (seen.current === refreshEpoch) return
    seen.current = refreshEpoch
    reload()
  }, [refreshEpoch, reload])
  return page
}
