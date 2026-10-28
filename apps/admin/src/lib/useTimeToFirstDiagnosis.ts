/**
 * FILE: apps/admin/src/lib/useTimeToFirstDiagnosis.ts
 * PURPOSE: Shared read of GET /v1/admin/onboarding/time-to-first-diagnosis.
 *
 * OVERVIEW:
 * The Set up rail and the Test it card both render this route. The route
 * already returns testDiagnosisAt once a test report is classified, but each
 * view fetched it once, so the card stayed on "Waiting on the first report…"
 * after the diagnosis was stored (report 9b7624e6).
 *
 * DEPENDENCIES:
 * - usePageData, invalidateApiCache
 *
 * USAGE:
 * - useTimeToFirstDiagnosis(projectId) in the rail and the card
 * - invalidateTimeToFirstDiagnosis() after a test report is sent, and when
 *   the Set up page hears a reports change
 *
 * NOTES:
 * The diagnosis is written before the test-report POST returns. Bumping a
 * shared generation (the same shape as useSetupStatus) makes every mounted
 * reader share one fresh GET. Calling each reader's reload() would skip the
 * request cache and fire one GET per view.
 */

import { useSyncExternalStore } from 'react'
import { invalidateApiCache } from './supabase'
import { usePageData, type PageDataState } from './usePageData'
import type { TimeToFirstDiagnosis } from './setupRail'

export const TIME_TO_FIRST_DIAGNOSIS_PATH = '/v1/admin/onboarding/time-to-first-diagnosis'

let generation = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Drop the short GET cache and refetch every mounted reader. */
export function invalidateTimeToFirstDiagnosis(): void {
  invalidateApiCache(TIME_TO_FIRST_DIAGNOSIS_PATH)
  generation += 1
  for (const listener of listeners) listener()
}

/**
 * @param projectId Pass null when there is no app yet (no request). Omit it
 * when the caller is already on the active app; a project switch still
 * refetches through usePageData's project signal, and an explicit id is an
 * extra dep for the rail's project prop.
 */
export function useTimeToFirstDiagnosis(projectId?: string | null): PageDataState<TimeToFirstDiagnosis> {
  const gen = useSyncExternalStore(subscribe, () => generation, () => 0)
  return usePageData<TimeToFirstDiagnosis>(projectId === null ? null : TIME_TO_FIRST_DIAGNOSIS_PATH, {
    deps: [projectId ?? '', gen],
  })
}
