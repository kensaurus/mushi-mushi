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
 */

import { Tooltip } from '../ui'

/** Canonical stage order. `dismissed` is a terminal off-loop state and
 *  rendered as a single muted bar instead of a stepper. */
export const STATUS_STEPS = ['new', 'classified', 'fixing', 'fixed'] as const
export type StatusStep = (typeof STATUS_STEPS)[number]

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
  grouped: 1,
  fixing: 2,
  fixed: 3,
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
  /** Compact = no labels, just bars (used inside the table row). Default
   *  shows labels under each segment for the report-detail header. */
  size?: 'compact' | 'full'
}

const ACTIVE_TONE: Record<string, string> = {
  critical: 'bg-danger',
  high: 'bg-warn',
  medium: 'bg-info',
  low: 'bg-info',
}

export function StatusStepper({
  status,
  severity,
  timestamps,
  className = '',
  size = 'compact',
}: StatusStepperProps) {
  if (status === 'dismissed') {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <span className="h-1 w-full rounded-full bg-surface-overlay" aria-label="Dismissed" />
        {size === 'full' && (
          <span className="text-2xs text-fg-faint ml-1">Dismissed</span>
        )}
      </div>
    )
  }

  const activeIdx = STATUS_TO_INDEX[status] ?? 0
  const activeTone = ACTIVE_TONE[severity ?? ''] ?? 'bg-brand'

  return (
    <div
      className={`inline-flex items-stretch ${size === 'full' ? 'flex-col gap-1' : ''} ${className}`}
      role="group"
      aria-label={`Report progress: ${STEP_LABELS[STATUS_STEPS[activeIdx]]}`}
    >
      <div className="flex items-center gap-0.5 w-full">
        {STATUS_STEPS.map((step, i) => {
          const completed = i < activeIdx
          const active = i === activeIdx
          const tint = active
            ? activeTone
            : completed
              ? 'bg-ok'
              : 'bg-edge-subtle'
          const ts = timestamps?.[step]
          const tooltipBase = STEP_LABELS[step]
          const tooltip = ts ? `${tooltipBase} · ${new Date(ts).toLocaleString()}` : tooltipBase
          return (
            <Tooltip key={step} content={tooltip}>
              <span
                aria-label={tooltipBase}
                className={`h-1.5 flex-1 rounded-full motion-safe:transition-colors ${tint}`}
              />
            </Tooltip>
          )
        })}
      </div>
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
