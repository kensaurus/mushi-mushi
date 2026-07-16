/**
 * rrweb replay player for report detail.
 *
 * Event sources, in order:
 * 1. Inline events on the report row (replays ≤ 120 events are stored inline).
 * 2. Object storage via `GET /v1/admin/reports/:id/replay-url` — the ingest
 *    path uploads larger replays as JSON and records `replayPath` in
 *    custom_metadata; the endpoint returns a short-lived signed URL.
 *
 * Playback uses rrweb's own Replayer (same package/version that captured the
 * events in @mushi-mushi/web), lazy-loaded so it never weighs the main chunk.
 */
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Card, Btn } from '../ui'

interface Props {
  reportId: string
  events: unknown[] | null | undefined
  replayPath?: string | null
}

type FetchState = 'idle' | 'loading' | 'error'

export function ReportReplayPlayer({ reportId, events, replayPath }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const replayerRef = useRef<{ play: () => void; pause: () => void; destroy?: () => void } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [fetchState, setFetchState] = useState<FetchState>('idle')
  const [loadedEvents, setLoadedEvents] = useState<unknown[] | null>(
    events?.length ? events : null,
  )

  // Keep state in sync when the report changes (detail page reuses this
  // component instance across reports) or when inline events arrive after a
  // refetch — otherwise the previous report's replay would keep playing.
  const lastReportRef = useRef(reportId)
  useEffect(() => {
    if (lastReportRef.current !== reportId) {
      lastReportRef.current = reportId
      setPlaying(false)
      setFetchState('idle')
      setLoadedEvents(events?.length ? events : null)
    } else if (events?.length && !loadedEvents?.length) {
      setLoadedEvents(events)
    }
  }, [reportId, events, loadedEvents])

  // Pull the stored replay from object storage when there are no inline events.
  useEffect(() => {
    if (loadedEvents?.length || !replayPath) return
    let cancelled = false
    setFetchState('loading')
    ;(async () => {
      try {
        const res = await apiFetch<{ url: string }>(`/v1/admin/reports/${reportId}/replay-url`)
        if (!res.ok || !res.data?.url) throw new Error('no signed url')
        const blob = await fetch(res.data.url)
        if (!blob.ok) throw new Error(`replay fetch ${blob.status}`)
        const json = (await blob.json()) as unknown[]
        if (!cancelled && Array.isArray(json) && json.length) {
          setLoadedEvents(json)
          setFetchState('idle')
        } else if (!cancelled) {
          setFetchState('error')
        }
      } catch {
        if (!cancelled) setFetchState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reportId, replayPath, loadedEvents])

  // Mount / unmount the rrweb Replayer when playback toggles.
  useEffect(() => {
    if (!playing || !loadedEvents?.length || !hostRef.current) return
    const el = hostRef.current
    let cancelled = false
    ;(async () => {
      try {
        const rrweb = await import('rrweb')
        if (cancelled) return
        el.innerHTML = ''
        const replayer = new rrweb.Replayer(loadedEvents as never[], {
          root: el,
          mouseTail: false,
        })
        replayerRef.current = replayer as unknown as typeof replayerRef.current
        replayer.play()
      } catch {
        el.textContent = 'Replay playback failed to initialise.'
      }
    })()
    return () => {
      cancelled = true
      try {
        replayerRef.current?.pause()
        replayerRef.current?.destroy?.()
      } catch {
        /* replayer already torn down */
      }
      replayerRef.current = null
      el.innerHTML = ''
    }
  }, [playing, loadedEvents])

  if (!loadedEvents?.length && !replayPath) return null

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Session replay</h3>
        <Btn size="sm" variant="ghost" onClick={() => setPlaying((p) => !p)} disabled={!loadedEvents?.length && fetchState !== 'idle'}>
          {playing ? 'Hide' : 'Play'} replay
        </Btn>
      </div>
      <div
        ref={hostRef}
        // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
        className="mushi-replay-host min-h-[180px] rounded-md border border-edge-subtle bg-surface-raised overflow-hidden [&_iframe]:pointer-events-none [&_iframe]:border-0 [&_.replayer-wrapper]:mx-auto"
      />
      <p className="text-2xs text-fg-muted">
        {fetchState === 'loading'
          ? 'Fetching stored replay…'
          : fetchState === 'error'
            ? 'Stored replay could not be fetched — it may have expired with the retention window.'
            : `${loadedEvents?.length ?? 0} buffered events · inputs masked client-side`}
      </p>
    </Card>
  )
}
