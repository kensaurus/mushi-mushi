/**
 * FILE: apps/admin/src/components/portfolio/TimedLoading.tsx
 * PURPOSE: Never an endless spinner on /portfolio (2026-11-18 sweep: "Adding up what each app
 *          costs…", "Reading the register…", "Reading CI…" spun for minutes). While `waiting`
 *          it shows the card's loading line; after 20 s with no answer (lib/ciReadTimeout.ts) it
 *          shows the hatched "not checked" row with one Retry (components/ci/CiNotChecked.tsx).
 *          An answer that lands later still renders: the caller stops passing `waiting`.
 */

import { Loading } from '../ui'
import { useReadTimedOut } from '../../lib/ciReadTimeout'
import { CiNotChecked } from '../ci/CiNotChecked'

export function TimedLoading({
  waiting,
  text,
  what,
  onRetry,
  testId,
  ms,
}: {
  /** The read is still out and nothing (data or error) has come back. */
  waiting: boolean
  /** The loading line, e.g. "Reading CI…". */
  text: string
  /** What was not checked, e.g. "CI runners". */
  what: string
  onRetry: () => void
  testId?: string
  ms?: number
}) {
  const wait = useReadTimedOut(waiting, ms)
  if (!waiting) return null
  if (wait.timedOut) {
    return (
      <CiNotChecked
        what={what}
        testId={testId}
        onRetry={() => {
          wait.restart()
          onRetry()
        }}
      />
    )
  }
  return <Loading text={text} />
}
