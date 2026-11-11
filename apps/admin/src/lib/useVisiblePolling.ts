/**
 * FILE: apps/admin/src/lib/useVisiblePolling.ts
 * PURPOSE: Reload every `ms` while the tab is visible, and once on coming back.
 *
 * For pages whose data changes too often for a Realtime subscription to be
 * worth its cost: every write to a table in the `supabase_realtime`
 * publication is decoded from the WAL whether or not anyone listens
 * (2026-11-11 cost audit: cron_runs, about 14k writes a day, fed only the
 * Health page). A hidden tab does no work.
 */

import { useEffect, useRef } from 'react'

export function useVisiblePolling(reload: () => void, ms: number): void {
  // Latest callback without restarting the timer: a page whose reload
  // callback changes on every render would otherwise reset the interval each
  // time and could never reach `ms` (same reason as realtime.ts's handlerRef).
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    let id: number | null = null
    const tick = () => reloadRef.current()
    const start = () => {
      if (id == null) id = window.setInterval(tick, ms)
    }
    const stop = () => {
      if (id != null) window.clearInterval(id)
      id = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick()
        start()
      } else stop()
    }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms])
}
