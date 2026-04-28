/**
 * FILE: apps/admin/src/lib/onlineStatus.ts
 * PURPOSE: Browser online/offline signal for the admin resilience layer.
 */

import { useEffect, useState } from 'react'

export interface OnlineStatus {
  online: boolean
  lastOfflineAt: number | null
}

export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>(() => ({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    lastOfflineAt: null,
  }))

  useEffect(() => {
    const onOffline = () => setStatus({ online: false, lastOfflineAt: Date.now() })
    const onOnline = () => setStatus((prev) => ({ online: true, lastOfflineAt: prev.lastOfflineAt }))
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  return status
}
