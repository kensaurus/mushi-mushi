import { useEffect, useState } from 'react'

/**
 * Returns a live-ticking timestamp (ms since epoch) that updates every
 * `intervalMs`. When `enabled` is false the hook is dormant and returns
 * the time at mount — useful for conditionally ticking only while a job
 * is actively in progress (avoids a global setInterval per open tab).
 *
 * Usage:
 *   const nowMs = useNow(1000, dispatchState.status === 'running')
 *   const elapsed = formatElapsed(nowMs - new Date(startedAt).getTime())
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [enabled, intervalMs])
  return now
}
