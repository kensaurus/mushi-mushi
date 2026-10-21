/**
 * FILE: apps/admin/src/components/ci/CiTimeline.tsx
 * PURPOSE: Per-runner timeline on /ci: one lane per runner (busiest first)
 *          and "No runner yet" last, over the last 2 h / 6 h / 24 h. Each job
 *          is a bar: a hatched segment for the wait for a machine, a solid
 *          segment for the run, coloured by outcome with a glyph so it never
 *          reads by colour alone. Bars are buttons: hover or focus shows the
 *          job, repo, wait, run and memory peak in the panel below. Plain
 *          divs, no chart library; layout from `buildCiTimeline`.
 */

import { useMemo, useState } from 'react'
import type { CiJob } from '../../lib/ciTypes'
import {
  CI_OUTCOME_META,
  buildCiTimeline,
  formatSeconds,
  timelinePct,
  type CiJobOutcome,
  type CiTimeline as Timeline,
  type CiTimelineBar,
} from '../../lib/ciView'
import { useNow } from '../../lib/useNow'
import { SegmentedControl } from '../ui'

type WindowId = '2h' | '6h' | '24h'

const WINDOW_MS: Record<WindowId, number> = { '2h': 2 * 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000 }
const WINDOW_OPTIONS = [
  { id: '2h', label: '2 h' },
  { id: '6h', label: '6 h' },
  { id: '24h', label: '24 h' },
] as const

const RUN_CLASS: Record<CiJobOutcome, string> = {
  passed: 'bg-ok',
  code_failure: 'bg-danger',
  infra: 'bg-warn',
  cancelled: 'bg-fg-faint',
  skipped: 'bg-fg-faint',
  running: 'bg-info motion-safe:animate-pulse',
  waiting: 'bg-fg-faint',
}

const HATCH = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--color-fg-faint) 0 2px, transparent 2px 6px)',
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function barLabel(b: CiTimelineBar): string {
  const parts = [
    `${b.jobName} in ${b.repo}${b.prNumber ? `, PR #${b.prNumber}` : ''}`,
    CI_OUTCOME_META[b.outcome].label,
    `waited ${formatSeconds(b.waitSeconds)}`,
  ]
  if (b.runSeconds != null) parts.push(`ran ${formatSeconds(b.runSeconds)}`)
  if (b.memPeakMb != null) parts.push(`memory peak ${(b.memPeakMb / 1024).toFixed(1)} GB`)
  return parts.join(', ')
}

function Bar({ bar, timeline, onInspect }: { bar: CiTimelineBar; timeline: Timeline; onInspect: (b: CiTimelineBar | null) => void }) {
  const start = Math.min(bar.queue?.start ?? Infinity, bar.run?.start ?? Infinity)
  const end = Math.max(bar.queue?.end ?? -Infinity, bar.run?.end ?? -Infinity)
  const left = timelinePct(start, timeline)
  const width = Math.max(0.4, timelinePct(end, timeline) - left)
  const span = Math.max(1, end - start)
  const seg = (s: { start: number; end: number }) => ({
    left: `${((s.start - start) / span) * 100}%`,
    width: `${((s.end - s.start) / span) * 100}%`,
  })
  const meta = CI_OUTCOME_META[bar.outcome]
  const label = barLabel(bar)
  const inner = (
    <>
      {bar.queue && <span className="absolute inset-y-1 rounded-sm opacity-70" style={{ ...seg(bar.queue), ...HATCH }} aria-hidden="true" />}
      {bar.run && <span className={`absolute inset-y-0.5 rounded-sm ${RUN_CLASS[bar.outcome]}`} style={seg(bar.run)} aria-hidden="true" />}
      <span className="pointer-events-none absolute -top-0.5 left-0.5 text-3xs leading-none text-fg" aria-hidden="true">
        {meta.glyph}
      </span>
    </>
  )
  const common = {
    className:
      'absolute top-1 h-5 min-w-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70',
    style: { left: `${left}%`, width: `${width}%` },
    'aria-label': label,
    'data-testid': `ci-timeline-bar-${bar.jobId}`,
    onMouseEnter: () => onInspect(bar),
    onMouseLeave: () => onInspect(null),
    onFocus: () => onInspect(bar),
    onBlur: () => onInspect(null),
  }
  return bar.htmlUrl ? (
    <a {...common} href={bar.htmlUrl} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    <button {...common} type="button">
      {inner}
    </button>
  )
}

export function CiTimeline({ jobs }: { jobs: CiJob[] }) {
  const [win, setWin] = useState<WindowId>('2h')
  const [inspect, setInspect] = useState<CiTimelineBar | null>(null)
  // Running bars grow to "now"; a 15 s tick is smooth enough at this scale.
  const now = useNow(15_000)
  const timeline = useMemo(() => buildCiTimeline(jobs, { now, windowMs: WINDOW_MS[win] }), [jobs, now, win])
  const ticks = useMemo(() => {
    const n = 4
    return Array.from({ length: n + 1 }, (_, i) => timeline.from + ((timeline.to - timeline.from) * i) / n)
  }, [timeline.from, timeline.to])

  return (
    <div className="flex flex-col gap-2" data-testid="ci-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          <span className="mr-3 inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm opacity-70" style={HATCH} aria-hidden="true" /> waiting for a machine
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-fg-muted" aria-hidden="true" /> running (colour and mark show the outcome)
          </span>
        </p>
        <SegmentedControl<WindowId> value={win} options={WINDOW_OPTIONS} onChange={setWin} ariaLabel="Timeline window" size="sm" />
      </div>

      {timeline.lanes.length === 0 ? (
        <p className="text-xs text-fg-muted">No jobs in the last {WINDOW_OPTIONS.find((o) => o.id === win)!.label}.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-160">
            <div className="ml-36 flex justify-between pb-1 text-3xs text-fg-faint tabular-nums" aria-hidden="true">
              {ticks.map((t, i) => (
                <span key={t}>{i === ticks.length - 1 ? 'now' : clock(t)}</span>
              ))}
            </div>
            <ul className="flex flex-col gap-1" aria-label="Jobs per runner">
              {timeline.lanes.map((lane) => (
                <li key={lane.id} className="flex items-center gap-2" data-testid={`ci-timeline-lane-${lane.label}`}>
                  <span className={`w-34 shrink-0 truncate text-2xs ${lane.unassigned ? 'italic text-fg-muted' : 'font-medium text-fg-secondary'}`} title={lane.label}>
                    {lane.label}
                  </span>
                  <div className="relative h-7 flex-1 rounded-sm bg-surface-overlay/50">
                    {lane.bars.map((bar) => (
                      <Bar key={bar.jobId} bar={bar} timeline={timeline} onInspect={setInspect} />
                    ))}
                    <span className="absolute inset-y-0 right-0 w-px bg-brand" aria-hidden="true" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <p className="min-h-5 text-2xs text-fg-secondary" aria-live="polite">
        {inspect ? barLabel(inspect) : 'Point at or tab to a bar to see the job.'}
      </p>
    </div>
  )
}
