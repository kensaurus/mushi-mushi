'use client'

import { useEffect, useMemo, useState } from 'react'
import { logEvents, stages, type MushiStageId } from './data'

interface LogTickerProps {
  focusStageId: MushiStageId
}

export function LogTicker({ focusStageId }: LogTickerProps) {
  const focusIndex = useMemo(
    () => stages.findIndex((stage) => stage.id === focusStageId),
    [focusStageId],
  )
  const [cursor, setCursor] = useState(Math.max(0, focusIndex))

  useEffect(() => {
    setCursor(Math.max(0, focusIndex))
  }, [focusIndex])

  useEffect(() => {
    const id = window.setInterval(() => {
      setCursor((current) => {
        const next = current + 1
        return next >= logEvents.length ? 0 : next
      })
    }, 3200)

    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="mushi-log-ticker w-[min(720px,calc(100vw-2rem))] overflow-hidden rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)] px-3 py-2 shadow-[0_18px_60px_-42px_rgba(14,13,11,0.75)] backdrop-blur">
      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em]">
        {/* The numbered circle keeps its solid vermillion fill (it carries the
            "this is event N of the canvas" semantics — a real micro-indicator,
            not decoration). The timestamp next to it dropped to ink-faint
            because brand-on-brand made the ticker read as one undifferentiated
            red strip from across the room. */}
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--mushi-vermillion)] text-white shadow-[inset_0_-1.5px_0_rgba(0,0,0,0.22)]">
          {String(cursor + 1).padStart(2, '0')}
        </span>
        <span className="shrink-0 text-[var(--mushi-ink-faint)]">{logEvents[cursor].time}</span>
        <span className="h-px flex-1 bg-[var(--mushi-rule)]" aria-hidden="true" />
        <span className="max-w-[62vw] truncate text-[var(--mushi-ink)]">
          {logEvents[cursor].text}
        </span>
      </div>
    </div>
  )
}
