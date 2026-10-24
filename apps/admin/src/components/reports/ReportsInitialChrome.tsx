/**
 * FILE: apps/admin/src/components/reports/ReportsInitialChrome.tsx
 * PURPOSE: Keep the reports queue from painting until the late chrome
 *          (status banner, fragile-area line, triage banner) has decided
 *          whether it exists, so that chrome cannot push the queue down.
 *
 * USAGE: ReportsPage passes `ready` once list stats, the report list, and
 *        DogfoodNarrativeBanner have settled. The first ready paint sticks:
 *        a later filter fetch must not swap the page back to the skeleton.
 */

import { useLayoutEffect, useState, type ReactNode } from 'react'
import { PAGE_CONTENT_STACK } from '../../lib/pageLayout'

export interface ReportsChromeReadyInput {
  listLoading: boolean
  hasListData: boolean
  statsLoading: boolean
  hasStatsData: boolean
  narrativeSettled: boolean
}

/**
 * True once every block above the queue can render at its final height.
 * A cached payload counts as settled even while a background refetch runs.
 */
export function reportsInitialChromeReady(input: ReportsChromeReadyInput): boolean {
  const listSettled = !input.listLoading || input.hasListData
  const statsSettled = !input.statsLoading || input.hasStatsData
  return listSettled && statsSettled && input.narrativeSettled
}

export interface DogfoodNarrativeSettledInput {
  isAdvanced: boolean
  setupLoading: boolean
  hasProject: boolean
  reportCount: number
  dashboardLoading: boolean
}

/**
 * The fragile-area line is omitted for advanced mode, no project, or a
 * project with no reports. Otherwise it waits on the dashboard payload so
 * the sentence is in the first paint instead of arriving under the queue.
 */
export function dogfoodNarrativeSettled(input: DogfoodNarrativeSettledInput): boolean {
  if (input.isAdvanced) return true
  if (input.setupLoading) return false
  if (!input.hasProject || input.reportCount === 0) return true
  return !input.dashboardLoading
}

interface Props {
  ready: boolean
  skeleton: ReactNode
  children: ReactNode
}

export function ReportsInitialChrome({ ready, skeleton, children }: Props) {
  const [revealed, setRevealed] = useState(false)
  useLayoutEffect(() => {
    if (ready) setRevealed(true)
  }, [ready])

  return (
    <div
      className={revealed ? undefined : PAGE_CONTENT_STACK}
      data-testid="mushi-page-reports"
      aria-busy={revealed ? undefined : true}
    >
      {!revealed && skeleton}
      <div className={PAGE_CONTENT_STACK} hidden={!revealed}>
        {children}
      </div>
    </div>
  )
}
