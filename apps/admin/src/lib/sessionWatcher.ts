/**
 * FILE: apps/admin/src/lib/sessionWatcher.ts
 * PURPOSE: Proactively refresh nearly-expired Supabase sessions and warn
 *          before a triager loses an in-progress action.
 */

import { useEffect, useRef } from 'react'
import { useAuth } from './auth'
import { supabase } from './supabase'
import { useToast } from './toast'

const REFRESH_BEFORE_EXPIRY_MS = 60_000
const RETRY_DELAY_MS = 5_000

export function useSessionWatcher(): void {
  const { session } = useAuth()
  const toast = useToast()
  const attempts = useRef(0)

  useEffect(() => {
    if (!session?.expires_at) return

    const expiresAtMs = session.expires_at * 1000
    const delay = Math.max(0, expiresAtMs - Date.now() - REFRESH_BEFORE_EXPIRY_MS)
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const refresh = async () => {
      if (document.visibilityState === 'hidden') return
      const { error } = await supabase.auth.refreshSession()
      if (!error) {
        attempts.current = 0
        return
      }
      attempts.current += 1
      if (attempts.current < 2) {
        retryTimer = setTimeout(refresh, RETRY_DELAY_MS)
        return
      }
      toast.warn('Your session is about to end', 'Refresh failed. Save your work, then stay signed in.', {
        label: 'Stay signed in',
        onClick: () => {
          attempts.current = 0
          void supabase.auth.refreshSession()
        },
      })
    }

    const timer = setTimeout(refresh, delay)
    return () => {
      clearTimeout(timer)
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [session?.expires_at, toast])
}
