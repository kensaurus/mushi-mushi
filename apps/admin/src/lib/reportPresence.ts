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

interface PresenceUser {
  id: string
  user_metadata?: { full_name?: string; avatar_url?: string } | null
  email?: string | null
}

/**
 * True when a realtime change is about the viewer's own presence row (our
 * heartbeat upsert echoing back). Those never change `others`, so refetching
 * the list for them was pure waste: one extra report_presence read every 20 s
 * per open tab (REPORT C, 2026-10-04). A DELETE payload can carry only the
 * primary key, so an unknown author is treated as "someone else".
 * @internal Exported for unit tests only.
 */
export function isOwnPresenceEcho(
  payload: { new?: Record<string, unknown> | null; old?: Record<string, unknown> | null } | null | undefined,
  meId: string | null,
): boolean {
  if (!meId || !payload) return false
  const author = (payload.new?.user_id ?? payload.old?.user_id) as string | undefined
  return author === meId
}

export function useReportPresence(opts: UseReportPresenceOptions): {
  others: ReportPresenceRow[]
  setIntent: (intent: 'viewing' | 'editing' | 'commenting') => Promise<void>
} {
  const { reportId, projectId, intent = 'viewing', heartbeatMs = DEFAULT_HEARTBEAT_MS, ttlSeconds = DEFAULT_TTL_SECONDS } = opts
  const [others, setOthers] = useState<ReportPresenceRow[]>([])
  const intentRef = useRef(intent)
  const meIdRef = useRef<string | null>(null)
  // Generation counter used to absorb React StrictMode's double-mount in dev.
  // Each effect mount bumps `generationRef`; the cleanup only deletes the
  // presence row if no newer generation has started since.
  const generationRef = useRef(0)
  // The signed-in user, resolved once per mount. `auth.getUser()` is a network
  // round trip to /auth/v1/user, and the heartbeat used to make it every 20 s.
  const meRef = useRef<Promise<PresenceUser | null> | null>(null)

  intentRef.current = intent

  const upsert = useCallback(async (nextIntent: 'viewing' | 'editing' | 'commenting') => {
    if (!reportId || !projectId) return
    if (!meRef.current) {
      meRef.current = supabase.auth.getUser().then(({ data }) => (data.user as PresenceUser | null) ?? null)
    }
    const me = await meRef.current
    if (!me) {
      meRef.current = null
      return
    }
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
    const myGeneration = ++generationRef.current

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

    const uid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const channel = supabase
      .channel(`mushi:report-presence:${reportId}:${uid}`)
      .on('postgres_changes' as never,
        { event: '*', schema: 'public', table: 'report_presence', filter: `report_id=eq.${reportId}` } as never,
        (payload: { new?: Record<string, unknown> | null; old?: Record<string, unknown> | null }) => {
          if (isOwnPresenceEcho(payload, meIdRef.current)) return
          void refreshList()
        },
      )
      .subscribe()

    const cleanup = async () => {
      cancelled = true
      clearInterval(heartbeat)
      supabase.removeChannel(channel)
      // If a newer mount has already started (StrictMode dev double-fire,
      // or rapid prop change), skip the delete — otherwise we'd race the
      // new mount's upsert and end up with no presence row at all.
      if (myGeneration !== generationRef.current) return
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
