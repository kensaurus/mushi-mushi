/**
 * FILE: apps/admin/src/components/ci/ciOutcome.tsx
 * PURPOSE: The one visual system for CI job outcomes on /ci: a colour, an
 *          icon, a name, what it means and what to do, used by the summary,
 *          the queue, the timeline, the legend and the drawer, so an outcome
 *          looks and reads the same everywhere. Colour is never the only
 *          signal: every use pairs it with the icon and the name.
 *          Colours are the run-status tokens (`st-*`, 2026-11-18) shared with
 *          components/signal/StatusMark: running blue, passed green, failed red,
 *          waiting amber, machine stopped orange, cancelled and skipped grey.
 */

import type { ComponentType } from 'react'
import { CI_OUTCOME_META, type CiJobOutcome } from '../../lib/ciView'
import { IconBan, IconCheck, IconClock, IconClose, IconPlay, IconServerOff, IconSkip } from '../icons'

export interface CiOutcomeStyle {
  label: string
  /** What happened, in one plain sentence. */
  meaning: string
  /** What to do about it, or null when nothing is needed. */
  action: string | null
  Icon: ComponentType<{ size?: number; className?: string }>
  /** Chip / pill: tinted background with AA text. */
  chip: string
  /** Solid fill for bars and swatches. */
  fill: string
  /** Text and icon colour on a plain surface. */
  text: string
}

export const CI_OUTCOME_STYLE: Record<CiJobOutcome, CiOutcomeStyle> = {
  waiting: {
    label: CI_OUTCOME_META.waiting.label,
    meaning: 'Queued until a test machine is free.',
    action: 'A long wait means too few machines for the work.',
    Icon: IconClock,
    chip: 'border border-st-waiting/45 bg-st-waiting-soft text-st-waiting-ink',
    fill: 'bg-st-waiting',
    text: 'text-st-waiting-ink',
  },
  running: {
    label: CI_OUTCOME_META.running.label,
    meaning: 'A test machine is running it now.',
    action: null,
    Icon: IconPlay,
    chip: 'border border-st-running/45 bg-st-running-soft text-st-running-ink',
    fill: 'bg-st-running',
    text: 'text-st-running-ink',
  },
  passed: {
    label: CI_OUTCOME_META.passed.label,
    meaning: 'Every check passed.',
    action: null,
    Icon: IconCheck,
    chip: 'border border-st-passed/45 bg-st-passed-soft text-st-passed-ink',
    fill: 'bg-st-passed',
    text: 'text-st-passed-ink',
  },
  code_failure: {
    label: CI_OUTCOME_META.code_failure.label,
    meaning: 'A check failed on the code.',
    action: 'Read the logs, or open the fix to send it back.',
    Icon: IconClose,
    chip: 'border border-st-failed/45 bg-st-failed-soft text-st-failed-ink',
    fill: 'bg-st-failed',
    text: 'text-st-failed-ink',
  },
  infra: {
    label: CI_OUTCOME_META.infra.label,
    meaning: 'Not your code: the machine died or never picked the job up.',
    action: 'Re-run it. The code was never tested.',
    Icon: IconServerOff,
    chip: 'border border-st-slow/45 bg-st-slow-soft text-st-slow-ink',
    fill: 'bg-st-slow',
    text: 'text-st-slow-ink',
  },
  cancelled: {
    label: CI_OUTCOME_META.cancelled.label,
    meaning: 'Stopped on purpose, usually by a newer push.',
    action: null,
    Icon: IconBan,
    chip: 'border border-st-cancelled/45 bg-st-cancelled-soft text-st-cancelled-ink',
    fill: 'bg-st-cancelled',
    text: 'text-st-cancelled-ink',
  },
  skipped: {
    label: CI_OUTCOME_META.skipped.label,
    meaning: "The workflow's rules skipped it.",
    action: null,
    Icon: IconSkip,
    chip: 'border border-st-idle/45 bg-st-idle-soft text-st-idle-ink',
    fill: 'bg-st-idle',
    text: 'text-st-idle-ink',
  },
}

/** Legend order: what a reader acts on first. */
const LEGEND: CiJobOutcome[] = ['waiting', 'running', 'passed', 'code_failure', 'infra', 'cancelled']

/** One line per outcome: icon, name and what it means. */
export function CiOutcomeLegend({ className = '' }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1.5 text-2xs ${className}`} aria-label="What the colours mean" data-testid="ci-outcome-legend">
      {LEGEND.map((o) => {
        const s = CI_OUTCOME_STYLE[o]
        return (
          <li key={o} className="inline-flex min-w-0 items-center gap-1.5" title={s.action ? `${s.meaning} ${s.action}` : s.meaning}>
            <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm ${s.chip}`}>
              <s.Icon size={10} />
            </span>
            <span className="font-medium text-fg">{s.label}</span>
            <span className="hidden text-fg-muted lg:inline">— {s.meaning}</span>
          </li>
        )
      })}
    </ul>
  )
}
