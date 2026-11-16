/**
 * FILE: apps/admin/src/lib/useTimeToFirstDiagnosis.ts
 * PURPOSE: Shared read of GET /v1/admin/onboarding/time-to-first-diagnosis for
 *          the Set up rail and the Verify card.
 *
 * OVERVIEW:
 * - Both surfaces used to fetch this route once on mount.
 * - A console test report is classified before the send request returns, but
 *   the card kept the first payload, so Verify stayed on "Waiting on the first
 *   report from your app" after that diagnosis (report 9b7624e6).
 * - invalidateTimeToFirstDiagnosis() drops the short-lived GET cache and bumps
 *   a generation every mounted reader passes to usePageData, so they share one
 *   refetch. Same shape as invalidateSetupStatus.
 *
 * DEPENDENCIES:
 * - usePageData, invalidateApiCache
 *
 * USAGE:
 * - TimeToFirstDiagnosisCard and SetupProgressRail call the hook.
 * - useSendTestReport and OnboardingPage's reload (realtime report changes,
 *   first-diagnosis screen) call invalidateTimeToFirstDiagnosis.
 */

import { useSyncExternalStore } from 'react'
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

/** Drop the cached answer and refetch every mounted reader. */
export function invalidateTimeToFirstDiagnosis(): void {
  invalidateApiCache(TIME_TO_FIRST_DIAGNOSIS_PATH)
  generation += 1
  for (const listener of listeners) listener()
}

export function useTimeToFirstDiagnosis(
  enabled = true,
  /** Changes the read when the app changes without a new active-project signal. */
  refreshKey: string | null = null,
): PageDataState<TimeToFirstDiagnosis> {
  const gen = useSyncExternalStore(subscribe, () => generation, () => 0)
  return usePageData<TimeToFirstDiagnosis>(enabled ? TIME_TO_FIRST_DIAGNOSIS_PATH : null, {
    deps: [gen, refreshKey],
  })
}
