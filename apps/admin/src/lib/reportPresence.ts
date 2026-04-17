import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { debugWarn } from './debug'

export interface ReportPresenceRow {
  id: number
  report_id: string
  project_id: string
  user_id: string
  display_name: string | null
  avatar_url: string | null
  intent: 'viewing' | 'editing' | 'commenting'
  last_seen_at: string
  expires_at: string
}

export interface UseReportPresenceOptions {
  reportId: string | undefined
  projectId: string | undefined
  intent?: 'viewing' | 'editing' | 'commenting'
  heartbeatMs?: number
  ttlSeconds?: number
}

const DEFAULT_HEARTBEAT_MS = 20_000
const DEFAULT_TTL_SECONDS = 60

export function useReportPresence(opts: UseReportPresenceOptions): {
  others: ReportPresenceRow[]
  setIntent: (intent: 'viewing' | 'editing' | 'commenting') => Promise<void>
} {
  const { reportId, projectId, intent = 'viewing', heartbeatMs = DEFAULT_HEARTBEAT_MS, ttlSeconds = DEFAULT_TTL_SECONDS } = opts
  const [others, setOthers] = useState<ReportPresenceRow[]>([])
  const intentRef = useRef(intent)
  const meIdRef = useRef<string | null>(null)

  intentRef.current = intent

  const upsert = useCallback(async (nextIntent: 'viewing' | 'editing' | 'commenting') => {
    if (!reportId || !projectId) return
    const { data: sess } = await supabase.auth.getUser()
    const me = sess.user
    if (!me) return
    meIdRef.current = me.id

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
    const row = {
      report_id: reportId,
      project_id: projectId,
      user_id: me.id,
      display_name: me.user_metadata?.full_name ?? me.email ?? null,
      avatar_url: me.user_metadata?.avatar_url ?? null,
      intent: nextIntent,
      last_seen_at: new Date().toISOString(),
      expires_at: expiresAt,
    }
    const { error } = await supabase
      .from('report_presence')
      .upsert(row, { onConflict: 'report_id,user_id' })
    if (error) debugWarn('presence', 'upsert failed', { error: error.message })
  }, [reportId, projectId, ttlSeconds])

  const setIntent = useCallback(async (nextIntent: 'viewing' | 'editing' | 'commenting') => {
    intentRef.current = nextIntent
    await upsert(nextIntent)
  }, [upsert])

  // Initial load + heartbeat
  useEffect(() => {
    if (!reportId || !projectId) return
    let cancelled = false

    void upsert(intentRef.current)

    const refreshList = async () => {
      const nowIso = new Date().toISOString()
      const { data, error } = await supabase
        .from('report_presence')
        .select('*')
        .eq('report_id', reportId)
        .gt('expires_at', nowIso)
      if (cancelled) return
      if (error) {
        debugWarn('presence', 'list failed', { error: error.message })
        return
      }
      const filtered = (data ?? []).filter((r) => r.user_id !== meIdRef.current)
      setOthers(filtered as ReportPresenceRow[])
    }

    void refreshList()

    const heartbeat = setInterval(() => {
      void upsert(intentRef.current)
    }, heartbeatMs)

    const channel = supabase
      .channel(`mushi:report-presence:${reportId}`)
      .on('postgres_changes' as never,
        { event: '*', schema: 'public', table: 'report_presence', filter: `report_id=eq.${reportId}` } as never,
        () => { void refreshList() },
      )
      .subscribe()

    const cleanup = async () => {
      cancelled = true
      clearInterval(heartbeat)
      supabase.removeChannel(channel)
      if (meIdRef.current) {
        await supabase
          .from('report_presence')
          .delete()
          .eq('report_id', reportId)
          .eq('user_id', meIdRef.current)
      }
    }

    return () => { void cleanup() }
  }, [reportId, projectId, heartbeatMs, upsert])

  return { others, setIntent }
}
