/**
 * FILE: apps/admin/src/lib/realtime.ts
 * PURPOSE: Tiny wrapper around supabase.channel(...).on('postgres_changes', ...) so
 *          pages can subscribe to a table with one call. Cleans up on unmount.
 */

import { useEffect } from 'react'
import { supabase } from './supabase'

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
