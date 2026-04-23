/**
 * FILE: apps/admin/src/lib/useStagedRealtime.ts
 * PURPOSE: Wave T.3.6 — stage realtime INSERT events instead of
 *          auto-applying them so a triager mid-review doesn't have rows
 *          shift under their cursor. Still auto-applies UPDATE / DELETE
 *          events the same way `useRealtimeReload` does, since those are
 *          mutations on rows the user is already looking at.
 *
 * WHY THIS EXISTS:
 *   `useRealtimeReload` is eager: every postgres_changes event fires a
 *   reload. That's fine on KPIs / sparklines but terrible on Reports,
 *   where a keyboard user triaging at row 17 gets bumped to row 20
 *   whenever a new critical lands. This hook decouples the event from
 *   the reload — counts INSERTs, hands over a manual `apply`, and
 *   surfaces the same `channelState` as `useRealtimeReload` so the
 *   `<FreshnessPill>` keeps working.
 *
 * KEYBOARD-CURSOR HEURISTIC:
 *   If `shouldAutoApply` returns true (the caller's "user isn't mid-
 *   triage" signal — typically `cursor === 0 && selected.size === 0 &&
 *   scrollTop < 10`), the hook auto-applies instead of staging.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { RealtimeChannelState } from './realtime'

interface UseStagedRealtimeOptions {
  /** Tables to subscribe to. INSERT events stage; UPDATE / DELETE events
   *  auto-reload. */
  tables: string[]
  /** Called when the user applies staged inserts, and also on every
   *  UPDATE / DELETE event (debounced). */
  onApply: () => void
  /** Return true to bypass staging and auto-apply. Called on every new
   *  INSERT. Gate on things like "user is at top of list with no selection". */
  shouldAutoApply?: () => boolean
  enabled?: boolean
  /** Collapse UPDATE/DELETE bursts into one reload. */
  debounceMs?: number
}

export interface StagedRealtime {
  stagedCount: number
  apply: () => void
  discard: () => void
  channelState: RealtimeChannelState
}

export function useStagedRealtime({
  tables,
  onApply,
  shouldAutoApply,
  enabled = true,
  debounceMs = 500,
}: UseStagedRealtimeOptions): StagedRealtime {
  const [stagedCount, setStagedCount] = useState(0)
  const [channelState, setChannelState] = useState<RealtimeChannelState>('idle')

  // Keep callbacks fresh without resubscribing on every render.
  const applyRef = useRef(onApply)
  applyRef.current = onApply
  const gateRef = useRef(shouldAutoApply)
  gateRef.current = shouldAutoApply

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fireDebounced = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (typeof document !== 'undefined' && document.hidden) return
      applyRef.current()
    }, debounceMs)
  }, [debounceMs])

  const apply = useCallback(() => {
    setStagedCount(0)
    applyRef.current()
  }, [])

  const discard = useCallback(() => {
    setStagedCount(0)
  }, [])

  const tablesKey = tables.join(',')

  useEffect(() => {
    if (!enabled) {
      setChannelState('idle')
      return
    }
    const tableList = tablesKey ? tablesKey.split(',') : []
    const statuses = new Map<string, string>()
    const recompute = () => {
      const arr = Array.from(statuses.values())
      if (arr.length === 0) return setChannelState('idle')
      if (arr.some((s) => s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED')) {
        return setChannelState('dropped')
      }
      if (arr.every((s) => s === 'SUBSCRIBED')) return setChannelState('live')
      setChannelState('idle')
    }

    const channels = tableList.map((table) => {
      const uid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const channelName = `mushi-staged:${table}:${uid}`
      const ch = supabase
        .channel(channelName)
        // INSERTs → stage unless the page says "user is not mid-triage".
        .on(
          'postgres_changes' as never,
          { event: 'INSERT', schema: 'public', table } as never,
          () => {
            if (gateRef.current?.() === true) {
              applyRef.current()
              return
            }
            setStagedCount((n) => n + 1)
          },
        )
        // UPDATE / DELETE → auto-reload (debounced).
        .on(
          'postgres_changes' as never,
          { event: 'UPDATE', schema: 'public', table } as never,
          () => fireDebounced(),
        )
        .on(
          'postgres_changes' as never,
          { event: 'DELETE', schema: 'public', table } as never,
          () => fireDebounced(),
        )
        .subscribe((status) => {
          statuses.set(channelName, String(status))
          recompute()
        })
      statuses.set(channelName, 'PENDING')
      return ch
    })
    recompute()

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fireDebounced()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (timerRef.current) clearTimeout(timerRef.current)
      for (const ch of channels) supabase.removeChannel(ch)
      setChannelState('idle')
    }
  }, [enabled, tablesKey, fireDebounced])

  return { stagedCount, apply, discard, channelState }
}
