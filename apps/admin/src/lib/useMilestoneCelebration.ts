/**
 * FILE: apps/admin/src/lib/useMilestoneCelebration.ts
 * PURPOSE: Watch a numeric milestone counter and fire a one-shot celebration
 *          when it crosses a threshold (default 0 → 1). Designed for the
 *          first-fix-merged confetti burst per the Round 2 polish plan.
 *
 *          The hook returns a stable `triggerKey` you can pass to
 *          `<Confetti triggerKey={key} />`. It also persists a "seen" flag
 *          per milestone in localStorage so the celebration fires exactly
 *          once per browser even if the user refreshes mid-burst.
 */

import { useEffect, useRef, useState } from 'react'

const SEEN_PREFIX = 'mushi:milestone:'

interface Options {
  /** Count value at which to fire (default 1). */
  threshold?: number
  /** Optional toast hook so callers can also trigger a toast. */
  onFire?: () => void
}

export function useMilestoneCelebration(
  /** Stable key for this milestone (e.g. 'first-merged-fix'). */
  milestone: string,
  /** Current count value. Pass `null` while loading. */
  value: number | null | undefined,
  options: Options = {},
): { triggerKey: string | null } {
  const { threshold = 1, onFire } = options
  const [triggerKey, setTriggerKey] = useState<string | null>(null)
  const previousValueRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (value == null) return

    const storageKey = `${SEEN_PREFIX}${milestone}`
    // localStorage access throws in some private-browsing contexts (Safari
    // under restrictive ITP, Firefox in strict mode). Falling through with
    // `seen=false` would make the celebration fire on every page mount in
    // those browsers — better to no-op than spam the user. The write is
    // wrapped for the same reason.
    let seen = false
    try {
      seen = window.localStorage.getItem(storageKey) === '1'
    } catch {
      previousValueRef.current = value
      return
    }

    // Two firing paths so the celebration is robust:
    //  1. Live transition: previous value < threshold and current >= threshold
    //     during the same session (the typical first-merge case).
    //  2. Cold start: the page mounts with value already >= threshold but
    //     localStorage shows the user hasn't seen this milestone yet.
    const previous = previousValueRef.current
    const liveTransition = previous != null && previous < threshold && value >= threshold
    const coldHit = previous == null && value >= threshold && !seen

    if ((liveTransition || coldHit) && !seen) {
      try {
        window.localStorage.setItem(storageKey, '1')
      } catch {
        /* non-fatal: see comment above. The triggerKey still fires once per
           mount which is the same UX a successful set would produce. */
      }
      setTriggerKey(`${milestone}:${Date.now()}`)
      onFire?.()
    }

    previousValueRef.current = value
  }, [milestone, value, threshold, onFire])

  return { triggerKey }
}
