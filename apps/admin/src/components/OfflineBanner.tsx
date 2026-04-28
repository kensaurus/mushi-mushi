/**
 * FILE: apps/admin/src/components/OfflineBanner.tsx
 * PURPOSE: Global network-state banner for recoverable offline moments.
 */

import { useEffect, useRef } from 'react'
import { invalidateApiCache } from '../lib/supabase'
import { useOnlineStatus } from '../lib/onlineStatus'
import { useToast } from '../lib/toast'

export function OfflineBanner() {
  const { online, lastOfflineAt } = useOnlineStatus()
  const toast = useToast()
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      return
    }
    if (!wasOffline.current || !lastOfflineAt) return
    wasOffline.current = false
    invalidateApiCache()
    toast.success('Back online', 'Refreshing cached admin data on the next render.')
  }, [lastOfflineAt, online, toast])

  if (online) return null

  return (
    <div className="fixed left-1/2 top-3 z-[70] w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-lg border border-warn/40 bg-surface-raised/95 px-4 py-3 text-sm text-fg shadow-raised backdrop-blur motion-safe:animate-mushi-toast-in">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warn shadow-[0_0_18px_var(--color-warn)]" aria-hidden="true" />
        <div>
          <p className="font-semibold">You appear to be offline.</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            Keep working carefully. New requests may fail until the connection returns, then Mushi will refresh cached data.
          </p>
        </div>
      </div>
    </div>
  )
}
