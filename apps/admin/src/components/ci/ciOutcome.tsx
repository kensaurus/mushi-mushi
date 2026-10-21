/**
 * FILE: apps/admin/src/components/ci/ciOutcome.tsx
 * PURPOSE: The one visual system for CI job outcomes on /ci: a colour, an
 *          icon, a name, what it means and what to do, used by the summary,
 *          the queue, the timeline, the legend and the drawer, so an outcome
 *          looks and reads the same everywhere. Colour is never the only
 *          signal: every use pairs it with the icon and the name.
 */

import type { ComponentType } from 'react'
import { CHIP_TONE } from '../../lib/chipTone'
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
  /** Left stripe on cards. */
  stripe: string
  /** Text and icon colour on a plain surface. */
  text: string
}

export const CI_OUTCOME_STYLE: Record<CiJobOutcome, CiOutcomeStyle> = {
  waiting: {
    label: CI_OUTCOME_META.waiting.label,
    meaning: 'Queued until a test machine is free.',
    action: 'A long wait means too few machines for the work.',
    Icon: IconClock,
    chip: CHIP_TONE.neutral,
    fill: 'bg-fg-faint',
    stripe: 'border-l-fg-faint',
    text: 'text-fg-secondary',
  },
  running: {
    label: CI_OUTCOME_META.running.label,
    meaning: 'A test machine is running it now.',
    action: null,
    Icon: IconPlay,
    chip: CHIP_TONE.infoSubtle,
    fill: 'bg-info',
    stripe: 'border-l-info',
    text: 'text-info',
  },
  passed: {
    label: CI_OUTCOME_META.passed.label,
    meaning: 'Every check passed.',
    action: null,
    Icon: IconCheck,
    chip: CHIP_TONE.okSubtle,
    fill: 'bg-ok',
    stripe: 'border-l-ok',
    text: 'text-ok',
  },
  code_failure: {
    label: CI_OUTCOME_META.code_failure.label,
    meaning: 'A check failed on the code.',
    action: 'Read the logs, or open the fix to send it back.',
    Icon: IconClose,
    chip: CHIP_TONE.dangerSubtle,
    fill: 'bg-danger',
    stripe: 'border-l-danger',
    text: 'text-danger',
  },
  infra: {
    label: CI_OUTCOME_META.infra.label,
    meaning: 'Not your code: the machine died or never picked the job up.',
    action: 'Re-run it. The code was never tested.',
    Icon: IconServerOff,
    chip: CHIP_TONE.warnSubtle,
    fill: 'bg-warn',
    stripe: 'border-l-warn',
    text: 'text-warn-foreground',
  },
  cancelled: {
    label: CI_OUTCOME_META.cancelled.label,
    meaning: 'Stopped on purpose, usually by a newer push.',
    action: null,
    Icon: IconBan,
    chip: CHIP_TONE.neutral,
    fill: 'bg-fg-faint',
    stripe: 'border-l-edge',
    text: 'text-fg-muted',
  },
  skipped: {
    label: CI_OUTCOME_META.skipped.label,
    meaning: "The workflow's rules skipped it.",
    action: null,
    Icon: IconSkip,
    chip: CHIP_TONE.neutral,
    fill: 'bg-fg-faint',
    stripe: 'border-l-edge',
    text: 'text-fg-muted',
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
