/**
 * FILE: apps/admin/src/components/ci/CiTimeline.tsx
 * PURPOSE: Per-runner timeline on /ci: one lane per runner (busiest first)
 *          and "No runner yet" last, over the last 2 h / 6 h / 24 h; GitHub's
 *          machines and one-job runner families share packed lanes. Each job
 *          is a bar: a hatched segment for the wait for a machine, a solid
 *          segment for the run, coloured by outcome with a glyph so it never
 *          reads by colour alone. Bars are buttons: hover or focus shows the
 *          job, repo, wait, run and memory peak in the panel below. Plain
 *          divs, no chart library; layout from `buildCiTimeline`.
 *
 *          Desktop (2026-11-17): the time axis gets more ticks and faint
 *          gridlines as the timeline widens (4 → 6 → 12 steps, by container
 *          width), the machine names stay pinned when a narrow screen scrolls
 *          sideways, and machines with one passed job fold into one row
 *          (`splitQuietLanes`) so the busy runners sit together.
 */

import { useMemo, useState } from 'react'
import type { CiJob } from '../../lib/ciTypes'
import {
  CI_OUTCOME_META,
  buildCiTimeline,
  foldGithubLanes,
  formatSeconds,
  laneIsLive,
  splitQuietLanes,
  timelinePct,
  type CiJobOutcome,
  type CiTimeline as Timeline,
  type CiTimelineBar,
} from '../../lib/ciView'
import { useNow } from '../../lib/useNow'
import { ciJobKey, ciRepoKey, ciRunnerKey, useCiLink } from '../../lib/ciHighlight'
import { IconClock, IconCloud, IconServer } from '../icons'
import { SegmentedControl } from '../ui'
import { CI_OUTCOME_STYLE } from './ciOutcome'

type WindowId = '2h' | '6h' | '24h'

const WINDOW_MS: Record<WindowId, number> = { '2h': 2 * 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000 }
const WINDOW_OPTIONS = [
  { id: '2h', label: '2 h' },
  { id: '6h', label: '6 h' },
  { id: '24h', label: '24 h' },
] as const

const RUN_CLASS: Record<CiJobOutcome, string> = {
  ...(Object.fromEntries(Object.entries(CI_OUTCOME_STYLE).map(([k, v]) => [k, v.fill])) as Record<CiJobOutcome, string>),
  running: `${CI_OUTCOME_STYLE.running.fill} ci-stripes`,
}

const LEGEND_OUTCOMES: CiJobOutcome[] = ['passed', 'code_failure', 'infra', 'running', 'cancelled']

const HATCH = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--color-fg-faint) 0 2px, transparent 2px 6px)',
}

/**
 * The axis is cut into 12 steps; which ticks show depends on the timeline's width.
 * Narrow: every 3rd (4 steps). From 56rem: every 2nd (6 steps). From 100rem: all 12.
 * Each set is evenly spaced, so the labels never bunch.
 */
const TICK_STEPS = 12
/** @internal Exported for tests only. */
export function tickVisibility(i: number): string {
  const four = i % 3 === 0
  const six = i % 2 === 0
  if (four && six) return ''
  if (four) return '@4xl:hidden @min-[100rem]:block'
  if (six) return 'hidden @4xl:block'
  return 'hidden @min-[100rem]:block'
}

/**
 * Lane label column: 8.5rem plus the 0.5rem gap = the axis inset (ml-36). From 100rem it widens
 * to 12.5rem (+ gap = ml-52): "aw-solo-boss-cloud-docu 1/2/3" all cut to the same "aw-solo-boss-clou…".
 */
const LABEL_W = 'w-34 @min-[100rem]:w-50'
const AXIS_INSET = 'ml-36 @min-[100rem]:ml-52'

/**
 * A lane name split so the end that tells lanes apart survives the cut (round 3, 2026-11-19:
 * two rows read "aw-the-wanting-mi…"). The trailing " 2" or "-576" stays whole; the head
 * truncates.
 *
 * @internal Exported for tests.
 */
export function splitLaneLabel(label: string): { head: string; tail: string } {
  const m = label.match(/^(.*\S)(\s+\S{1,6}|-\d{1,6})$/)
  return m ? { head: m[1], tail: m[2] } : { head: label, tail: '' }
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
      {bar.run && <span className={`ci-grow-x absolute inset-y-0.5 rounded-sm ${RUN_CLASS[bar.outcome]}${bar.outcome === 'running' ? ' ci-stripes' : ''}`} style={seg(bar.run)} aria-hidden="true" />}
      {/* The outcome mark sits inside the bar, and only where it fits. */}
      {width >= 2 && (
        <span className="pointer-events-none absolute inset-y-0 left-1 flex items-center text-3xs font-bold leading-none text-surface-root" aria-hidden="true">
          {meta.glyph}
        </span>
      )}
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

/** One machine's row; pointing at it lights the machine, its apps and its jobs across the page. */
function Lane({ lane, timeline, onInspect }: { lane: Timeline['lanes'][number]; timeline: Timeline; onInspect: (b: CiTimelineBar | null) => void }) {
  const keys = useMemo(
    () => [ciRunnerKey(lane.label), ...new Set(lane.bars.flatMap((b) => [ciRepoKey(b.repo), ciJobKey(b.repo, b.jobName)]))],
    [lane],
  )
  const link = useCiLink(keys, ciRunnerKey(lane.label))
  // Running now: the row is tinted in the running colour, so live work reads first.
  const live = !lane.unassigned && laneIsLive(lane)
  return (
    <li
      {...link}
      className={`${link.className} flex items-center gap-2 rounded-sm`}
      data-testid={`ci-timeline-lane-${lane.label}`}
      data-failed={laneFailed(lane) || undefined}
      data-live={live || undefined}
    >
      <span
        // Pinned: on a narrow screen the lanes scroll sideways and the names stay put.
        className={`sticky left-0 z-10 flex ${LABEL_W} shrink-0 items-center gap-1.5 bg-surface-raised text-2xs ${lane.unassigned ? 'italic text-fg-muted' : live ? 'font-semibold text-st-running-ink' : 'font-medium text-fg-secondary'}`}
        title={lane.kind === 'family' ? `${lane.label}: jobs of one-job runners, packed so bars never overlap` : lane.label}
      >
        {lane.unassigned ? (
          <IconClock size={12} className="shrink-0" />
        ) : lane.kind === 'github' ? (
          <IconCloud size={12} className="shrink-0" />
        ) : (
          <IconServer size={12} className="shrink-0" />
        )}
        <LaneName label={lane.label} />
      </span>
      <div className={`relative h-7 flex-1 rounded-sm ${live ? 'bg-st-running-soft ring-1 ring-inset ring-st-running/30' : 'bg-surface-overlay/50'}`}>
        {lane.bars.map((bar) => (
          <Bar key={bar.jobId} bar={bar} timeline={timeline} onInspect={onInspect} />
        ))}
        <span className="absolute inset-y-0 right-0 w-px bg-brand" aria-hidden="true" />
      </div>
    </li>
  )
}

function LaneName({ label }: { label: string }) {
  const { head, tail } = splitLaneLabel(label)
  return (
    <span className="flex min-w-0">
      <span className="truncate">{head}</span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  )
}

const laneFailed = (l: { bars: ReadonlyArray<{ outcome: string }> }) => l.bars.some((b) => b.outcome === 'code_failure' || b.outcome === 'infra')

/**
 * @internal Exported for tests. Machines running (or waiting on) a job right now first, then
 * those with a failed job (a code failure or a stopped machine), "No runner yet" always last,
 * otherwise the given order (busiest first).
 */
export function failingLanesFirst<L extends { unassigned: boolean; bars: ReadonlyArray<{ outcome: string }> }>(lanes: readonly L[]): L[] {
  const rank = (l: L) => (l.unassigned ? 3 : laneIsLive(l) ? 0 : laneFailed(l) ? 1 : 2)
  return lanes.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map((x) => x.l)
}

export function CiTimeline({ jobs }: { jobs: CiJob[] }) {
  const [win, setWin] = useState<WindowId>('2h')
  const [inspect, setInspect] = useState<CiTimelineBar | null>(null)
  const [showQuiet, setShowQuiet] = useState(false)
  const [showGithub, setShowGithub] = useState(false)
  // Running bars grow to "now"; a 15 s tick is smooth enough at this scale.
  const now = useNow(15_000)
  const timeline = useMemo(() => buildCiTimeline(jobs, { now, windowMs: WINDOW_MS[win] }), [jobs, now, win])
  const { quiet } = useMemo(() => splitQuietLanes(timeline.lanes), [timeline.lanes])
  const quietIds = useMemo(() => new Set(quiet.map((l) => l.id)), [quiet])
  // Machines running a job now first, then those with a failed job: what is live and what
  // went wrong read before what went fine.
  const visible = failingLanesFirst(showQuiet ? timeline.lanes : timeline.lanes.filter((l) => !quietIds.has(l.id)))
  // GitHub-hosted 2 to 10 read as near-identical rows (2026-11-18): clean ones fold into one row.
  const github = foldGithubLanes(visible)
  const lanes = showGithub ? visible : github.shown
  const githubJobs = github.rest.reduce((n, l) => n + l.bars.length, 0)
  const ticks = useMemo(
    () => Array.from({ length: TICK_STEPS + 1 }, (_, i) => timeline.from + ((timeline.to - timeline.from) * i) / TICK_STEPS),
    [timeline.from, timeline.to],
  )

  // Nothing in the window: one line, no legend, no hint about bars (round 3: the empty 390 card
  // kept its legend, window picker and "Point at or tab to a bar"). A wider window is one click.
  if (timeline.lanes.length === 0) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted" data-testid="ci-timeline">
        No jobs in the last {WINDOW_OPTIONS.find((o) => o.id === win)!.label}.
        {win !== '24h' && (
          <button type="button" className="text-2xs font-medium text-fg-secondary underline underline-offset-2 hover:text-fg" onClick={() => setWin('24h')}>
            Look back 24 h
          </button>
        )}
      </p>
    )
  }

  return (
    <div className="@container flex flex-col gap-2" data-testid="ci-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-secondary" aria-label="What the bars mean">
          <li className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-sm opacity-70" style={HATCH} aria-hidden="true" />
            Waiting for a machine
          </li>
          {LEGEND_OUTCOMES.map((o) => {
            const st = CI_OUTCOME_STYLE[o]
            return (
              <li key={o} className="inline-flex items-center gap-1.5" title={st.meaning}>
                <span className={`inline-flex h-3 w-5 items-center justify-center rounded-sm text-surface-root ${st.fill}`} aria-hidden="true">
                  <st.Icon size={8} />
                </span>
                {st.label}
              </li>
            )
          })}
        </ul>
        <SegmentedControl<WindowId> value={win} options={WINDOW_OPTIONS} onChange={setWin} ariaLabel="Timeline window" size="sm" />
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-160">
          {/* Axis: labels sit centred on their tick; the first and last align to the edges. */}
          <div className={`${AXIS_INSET} relative h-4 text-3xs text-fg-faint tabular-nums`} aria-hidden="true" data-testid="ci-timeline-axis">
            {ticks.map((t, i) => (
              <span
                key={i}
                className={`absolute top-0 whitespace-nowrap ${i === 0 ? '' : i === TICK_STEPS ? '-translate-x-full' : '-translate-x-1/2'} ${tickVisibility(i)}`}
                style={{ left: `${(i / TICK_STEPS) * 100}%` }}
              >
                {i === TICK_STEPS ? 'now' : clock(t)}
              </span>
            ))}
          </div>
          <div className="relative">
            {/* Gridlines behind the lanes, at the ticks that show. */}
            <div className="pointer-events-none absolute inset-y-0 right-0 left-36 @min-[100rem]:left-52" aria-hidden="true">
              {ticks.slice(1, -1).map((_, j) => {
                const i = j + 1
                return (
                  <span
                    key={i}
                    className={`absolute inset-y-0 w-px bg-edge-subtle/60 ${tickVisibility(i)}`}
                    style={{ left: `${(i / TICK_STEPS) * 100}%` }}
                  />
                )
              })}
            </div>
            <ul className="relative flex flex-col gap-1" aria-label="Jobs per runner">
              {lanes.map((lane) => (
                <Lane key={lane.id} lane={lane} timeline={timeline} onInspect={setInspect} />
              ))}
              {github.rest.length > 0 && (
                <li className="flex items-center gap-2" data-testid="ci-timeline-github-fold">
                  <span className={`sticky left-0 z-10 flex ${LABEL_W} shrink-0 items-center gap-1.5 bg-surface-raised text-2xs font-medium text-fg-secondary`}>
                    <IconCloud size={12} className="shrink-0" />
                    <span className="truncate">{showGithub ? 'GitHub-hosted' : `+${github.rest.length} GitHub-hosted`}</span>
                  </span>
                  <button
                    type="button"
                    className="h-7 flex-1 rounded-sm bg-surface-overlay/50 px-2 text-left text-2xs whitespace-nowrap text-fg-secondary hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                    aria-expanded={showGithub}
                    onClick={() => setShowGithub((v) => !v)}
                  >
                    {showGithub ? 'Fold the clean GitHub-hosted rows' : `${githubJobs} ${githubJobs === 1 ? 'job' : 'jobs'}, none failed · show each row`}
                  </button>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {quiet.length > 0 && (
        <button
          type="button"
          className="self-start text-2xs text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg"
          aria-expanded={showQuiet}
          onClick={() => setShowQuiet((v) => !v)}
          data-testid="ci-timeline-quiet-toggle"
          title={quiet.map((l) => l.label).join(', ')}
        >
          {showQuiet ? `Fold the ${quiet.length} quiet machines` : `Show ${quiet.length} quiet machines (one job each, nothing failed)`}
        </button>
      )}

      <p className="min-h-5 text-2xs text-fg-secondary" aria-live="polite">
        {inspect ? barLabel(inspect) : 'Point at or tab to a bar to see the job.'}
      </p>
    </div>
  )
}
