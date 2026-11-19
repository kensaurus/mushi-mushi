/**
 * FILE: apps/admin/src/lib/ciReadTimeout.ts
 * PURPOSE: Never an endless spinner on /ci (2026-11-18: "Cost and speed" sat on "Reading your
 *          GitHub bill…" at both widths). A read that has not answered after `ms` (10 s) reports
 *          `timedOut`, so the panel shows "Not checked" with a retry instead of spinning on.
 *          `restart` clears it and starts the clock again (call it with the page's reload).
 *          An answer that lands later still renders: callers check their data first.
 */

import { useCallback, useEffect, useState } from 'react'

/**
 * How long a read may take before its panel says "Not checked". 10 s, not 20 s (round 3,
 * 2026-11-19): a reader waited a few seconds and saw only the spinner. Nothing waits on 20 s.
 * @internal Exported for tests.
 */
export const CI_READ_TIMEOUT_MS = 10_000

export function useReadTimedOut(loading: boolean, ms = CI_READ_TIMEOUT_MS): { timedOut: boolean; restart: () => void } {
  const [timedOut, setTimedOut] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!loading) {
      setTimedOut(false)
      return
    }
    const t = setTimeout(() => setTimedOut(true), ms)
    return () => clearTimeout(t)
  }, [loading, ms, attempt])
  const restart = useCallback(() => {
    setTimedOut(false)
    setAttempt((a) => a + 1)
  }, [])
  return { timedOut, restart }
}
