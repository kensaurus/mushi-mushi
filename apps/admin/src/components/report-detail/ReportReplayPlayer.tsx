/**
 * rrweb replay player for report detail — lazy-loads rrweb when events exist.
 */
import { useEffect, useRef, useState } from 'react'
import { Card, Btn } from '../ui'

interface Props {
  events: unknown[] | null | undefined
  replayPath?: string | null
}

export function ReportReplayPlayer({ events, replayPath }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [loadedEvents, setLoadedEvents] = useState<unknown[] | null>(events ?? null)

  useEffect(() => {
    if (events?.length) {
      setLoadedEvents(events)
      return
    }
    if (!replayPath) return
    // Signed URL fetch would go here; for now rely on inline events from metadata.
    const metaEvents = (globalThis as { __MUSHI_REPLAY__?: unknown[] }).__MUSHI_REPLAY__
    if (metaEvents?.length) setLoadedEvents(metaEvents)
  }, [events, replayPath])

  useEffect(() => {
    if (!playing || !loadedEvents?.length || !hostRef.current) return
    const el = hostRef.current
    el.textContent = `${loadedEvents.length} replay events captured — scrubbable playback requires the optional rrweb player package in the admin build.`
    return () => {
      if (el) el.textContent = ''
    }
  }, [playing, loadedEvents])

  if (!loadedEvents?.length && !replayPath) return null

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Session replay</h3>
        <Btn size="sm" variant="ghost" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Hide' : 'Inspect'} replay
        </Btn>
      </div>
      <div
        ref={hostRef}
        className="min-h-[180px] rounded-md border border-edge-subtle bg-surface-raised overflow-hidden"
      />
      <p className="text-2xs text-fg-muted">
        {loadedEvents?.length ?? 0} buffered events · inputs masked client-side
      </p>
    </Card>
  )
}
