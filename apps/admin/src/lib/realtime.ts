/**
 * FILE: apps/admin/src/lib/realtime.ts
 * PURPOSE: Tiny wrapper around supabase.channel(...).on('postgres_changes', ...) so
 *          pages can subscribe to a table with one call. Cleans up on unmount.
 *
 *          Exports:
 *            - useRealtime: single-table subscription, fires immediately.
 *            - useRealtimeReload: multi-table subscription with built-in
 *              debounce — intended for list pages where a burst of webhooks
 *              (e.g. push + pull_request + check_run landing within a
 *              second of each other for the same fix) should collapse into
 *              a single refresh instead of three.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

/**
 * Realtime channel state surfaced to the UI via `useRealtimeReload` so the
 * `<FreshnessPill>` can render a red ring when the websocket has dropped
 * (and the page is therefore showing potentially stale data despite the
 * "live" affordance). Mirrors the strings supabase-js gives the
 * `.subscribe()` status callback.
 */
export type RealtimeChannelState = 'idle' | 'live' | 'dropped'

type Event = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface UseRealtimeOptions {
  table: string
  schema?: string
  event?: Event
  filter?: string
  enabled?: boolean
}

export function useRealtime(opts: UseRealtimeOptions, onChange: () => void): void {
  const { table, schema = 'public', event = '*', filter, enabled = true } = opts

  useEffect(() => {
    if (!enabled) return
    const uid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const channelName = `mushi:${schema}:${table}:${filter ?? 'all'}:${uid}`
    const channel = supabase
      .channel(channelName)
      .on(
        // postgres_changes is supported but not in the public TS types of supabase-js v2
        'postgres_changes' as never,
        { event, schema, table, ...(filter ? { filter } : {}) } as never,
        () => onChange(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, schema, event, filter, enabled, onChange])
}

/* ── useRealtimeReload ─────────────────────────────────────────────────── */

type TableSpec = string | { table: string; schema?: string; event?: Event; filter?: string }

interface UseRealtimeReloadOptions {
  /** Collapse bursts of table events into a single reload. 500ms matches
   *  the latency between a push webhook arriving and the downstream
   *  pull_request / check_run webhooks for the same fix. */
  debounceMs?: number
  enabled?: boolean
}

/**
 * Subscribe to many tables at once and trigger `onChange` (debounced) any
 * time one of them emits a postgres_changes event. Use on list pages where
 * the server-truth can shift under any of several tables — e.g. the Fixes
 * page reacts to both `fix_attempts` and `fix_events`.
 *
 * This deliberately does NOT expose per-table detail. If a page needs to
 * do different things per table, call `useRealtime` per table instead.
 */
export function useRealtimeReload(
  tables: TableSpec[],
  onChange: () => void,
  opts: UseRealtimeReloadOptions = {},
): { channelState: RealtimeChannelState } {
  const { debounceMs = 500, enabled = true } = opts
  const [channelState, setChannelState] = useState<RealtimeChannelState>('idle')

  // Keep the callback fresh across renders without re-subscribing every
  // time the parent re-renders with a new closure.
  const handlerRef = useRef(onChange)
  handlerRef.current = onChange

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fire = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      // Pause when the tab is hidden — the user can't see the list, and
      // waking fetchers only wastes quota. The existing subscription
      // buffers on Supabase's side until we reload on visibility change.
      if (typeof document !== 'undefined' && document.hidden) return
      handlerRef.current()
    }, debounceMs)
  }, [debounceMs])

  // Serialise the tables array for a stable effect dep — avoids
  // re-subscribing every render just because the caller passed an inline
  // array.
  const tablesKey = JSON.stringify(tables)

  useEffect(() => {
    if (!enabled) {
      setChannelState('idle')
      return
    }
    const specs: TableSpec[] = JSON.parse(tablesKey)
    // Track per-channel status. We surface the *worst* status across all
    // subscribed channels so a single dropped channel turns the pill red
    // (data on the page may now be stale).
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
    const channels = specs.map((t) => {
      const cfg = typeof t === 'string' ? { table: t } : t
      const schema = cfg.schema ?? 'public'
      const event = cfg.event ?? '*'
      const uid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const channelName = `mushi-rr:${schema}:${cfg.table}:${cfg.filter ?? 'all'}:${uid}`
      const ch = supabase
        .channel(channelName)
        .on(
          'postgres_changes' as never,
          { event, schema, table: cfg.table, ...(cfg.filter ? { filter: cfg.filter } : {}) } as never,
          () => fire(),
        )
        .subscribe((status) => {
          statuses.set(channelName, String(status))
          recompute()
        })
      statuses.set(channelName, 'PENDING')
      return ch
    })
    recompute()

    // When the tab becomes visible again after being hidden, fire a
    // single reload so the user sees the most recent snapshot without
    // having to hit refresh.
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fire()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (timerRef.current) clearTimeout(timerRef.current)
      for (const ch of channels) supabase.removeChannel(ch)
      setChannelState('idle')
    }
  }, [enabled, fire, tablesKey])

  return { channelState }
}
