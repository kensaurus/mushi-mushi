/**
 * FILE: apps/admin/src/components/reports/StatusStepper.tsx
 * PURPOSE: 4-segment stepper that shows where a report is in its lifecycle —
 *          new → classified → fixing → fixed. Replaces the single status pill,
 *          which conveyed *state* but never *progression*.
 *
 *          Same primitive ships in both the Reports table row and the Report
 *          detail header so triagers see the loop in the same shape everywhere.
 *
 *          Pattern: a 4-segment stepper, the active one tinted by severity tone,
 *          completed segments tinted ok-muted, future segments edge-subtle —
 *          mirroring the affordance Linear uses for workflow state and GitHub
 *          uses for PR status (Open → Review → Merged).
 *
 *          The bar row is one `role="img"` named with the current step
 *          (`Status: Fixing, step 3 of 4`). Segments are `aria-hidden` so a
 *          screen reader hears that name once. A bare span is generic, and
 *          axe `aria-prohibited-attr` rejects `aria-label` on that role
 *          (reports table Status column). Tooltips still show each step.
 */

import { Tooltip } from '../ui'
import { SEVERITY_TRAFFIC } from '../../lib/severityTraffic'

/** Canonical stage order. `dismissed` is a terminal off-loop state and
 *  rendered as a single muted bar instead of a stepper. */
const STATUS_STEPS = ['new', 'classified', 'fixing', 'fixed'] as const
type StatusStep = (typeof STATUS_STEPS)[number]

const STEP_LABELS: Record<StatusStep, string> = {
  new: 'Received',
  classified: 'Classified',
  fixing: 'Fixing',
  fixed: 'Fixed',
}

/** Map every report.status value into a step index (0..3). Anything we don't
 *  know about defaults to 0 so the stepper still renders gracefully. */
const STATUS_TO_INDEX: Record<string, number> = {
  new: 0,
  pending: 0,
  submitted: 0,
  queued: 0,
  classified: 1,
  triaged: 1,
  grouped: 1,
  dispatched: 1,
  fixing: 2,
  fixed: 3,
  resolved: 3,
  completed: 3,
}

interface StatusStepperProps {
  status: string
  /** Optional severity to tint the active segment. Critical/high get warm
   *  tones to nudge attention; medium/low stay cool. */
  severity?: string | null
  /** Optional per-stage timestamps for hover tooltips. Pass undefined for
   *  any stage we don't have an exact landing time for. */
  timestamps?: Partial<Record<StatusStep, string | null>>
  className?: string
  /** Compact = label + bars. `table` = bars only (dense triage row). */
  size?: 'compact' | 'full' | 'table'
}

export function StatusStepper({
  status,
  severity,
  timestamps,
  className = '',
  size = 'compact',
}: StatusStepperProps) {
  if (status === 'dismissed') {
    // Full size already prints the word, so the bar stays decorative.
    const showCaption = size === 'full'
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <span
          role={showCaption ? undefined : 'img'}
          aria-hidden={showCaption ? true : undefined}
          aria-label={showCaption ? undefined : 'Dismissed'}
          className="h-1 w-full rounded-full bg-surface-overlay"
        />
        {showCaption && (
          <span className="text-2xs text-fg-faint ml-1">Dismissed</span>
        )}
      </div>
    )
  }

  const activeIdx = STATUS_TO_INDEX[status] ?? 0
  const activeTone = severity
    ? (SEVERITY_TRAFFIC[severity as keyof typeof SEVERITY_TRAFFIC]?.bg ?? 'bg-brand')
    : 'bg-brand'

  const activeLabel = STEP_LABELS[STATUS_STEPS[activeIdx]]
  const isTable = size === 'table'
  const barHeight = size === 'full' ? 'h-2.5' : isTable ? 'h-2' : 'h-1.5'
  const tableSummary = `${activeLabel} · stage ${activeIdx + 1} of 4`

  const barRow = (
    <div
      className="flex w-full max-w-full min-w-0 items-center gap-px"
      role="img"
      aria-label={`Status: ${activeLabel}, step ${activeIdx + 1} of 4`}
    >
      {STATUS_STEPS.map((step, i) => {
        const completed = i < activeIdx
        const active = i === activeIdx
        const tint = active
          ? activeTone
          : completed
            ? 'bg-ok'
            : 'bg-fg-faint/20'
        const ts = timestamps?.[step]
        const tooltipBase = STEP_LABELS[step]
        const tooltip = ts ? `${tooltipBase} · ${new Date(ts).toLocaleString()}` : tooltipBase
        const activeRing = active ? 'ring-1 ring-inset ring-fg/15' : ''
        // Tooltip renders its own `inline-flex` span around the child, and
        // THAT span is the flex item here. Without `flex-1` on it the
        // segment's own `flex-1` grew inside an empty wrapper and every bar
        // rendered 0 px wide (2026-10-04 console audit).
        return (
          <Tooltip key={step} portal content={tooltip} className="flex-1 min-w-0">
            <span
              aria-hidden="true"
              className={`${barHeight} w-full rounded-hairline motion-safe:transition-opacity ${tint} ${activeRing}`}
            />
          </Tooltip>
        )
      })}
    </div>
  )

  return (
    <div
      className={`flex items-stretch w-full min-w-0 ${size === 'full' ? 'flex-col gap-1' : isTable ? 'flex-row items-center gap-1' : 'flex-col gap-1'} ${className}`}
    >
      {size === 'compact' && (
        <span className="text-2xs text-fg-muted leading-none font-medium">
          {activeLabel}
          <span className="text-fg-faint font-normal"> · {activeIdx + 1}/4</span>
        </span>
      )}
      {isTable ? (
        <Tooltip portal content={tableSummary} className="flex-1 min-w-0">
          {barRow}
        </Tooltip>
      ) : (
        barRow
      )}
      {isTable && (
        <span
          className="shrink-0 text-2xs text-fg-muted tabular-nums leading-none font-medium"
          title={tableSummary}
        >
          {activeIdx + 1}/4
        </span>
      )}
      {size === 'full' && (
        <div className="flex items-center justify-between text-2xs text-fg-faint w-full">
          {STATUS_STEPS.map((step, i) => (
            <span
              key={step}
              className={i === activeIdx ? 'text-fg font-medium' : ''}
            >
              {STEP_LABELS[step]}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
