/** Two small chips for migration metadata — effort and risk. */

import type { ReactNode } from 'react'

export type EffortLevel = 'Hours' | 'Days' | 'Weeks'
export type RiskLevel = 'Low' | 'Med' | 'High'

export const EFFORT_LEVELS: EffortLevel[] = ['Hours', 'Days', 'Weeks']
export const RISK_LEVELS: RiskLevel[] = ['Low', 'Med', 'High']

const baseChip =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-mono uppercase tracking-[0.12em] leading-none align-middle'

const effortStyles: Record<EffortLevel, string> = {
  Hours:
    'border-[var(--mushi-jade)]/40 bg-[var(--mushi-jade-wash)] text-[var(--mushi-jade)]',
  Days:
    'border-[var(--mushi-viz-warn)]/40 bg-[var(--mushi-viz-wash-warn)] text-[var(--mushi-viz-warn)]',
  Weeks:
    'border-[var(--mushi-vermillion)]/40 bg-[var(--mushi-vermillion-wash)] text-[var(--mushi-vermillion-ink)]',
}

const riskStyles: Record<RiskLevel, string> = {
  Low: 'border-[var(--mushi-jade)]/40 bg-[var(--mushi-jade-wash)] text-[var(--mushi-jade)]',
  Med: 'border-[var(--mushi-viz-warn)]/40 bg-[var(--mushi-viz-wash-warn)] text-[var(--mushi-viz-warn)]',
  High: 'border-[var(--mushi-vermillion)]/40 bg-[var(--mushi-vermillion-wash)] text-[var(--mushi-vermillion-ink)]',
}

const Dot = ({ filled }: { filled: number }): ReactNode => (
  <span aria-hidden className="inline-flex gap-0.5">
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className={`h-1.5 w-1.5 rounded-full ${
          i < filled ? 'bg-current opacity-90' : 'bg-current opacity-25'
        }`}
      />
    ))}
  </span>
)

export interface EffortBadgeProps {
  level: EffortLevel
}

/** "About how long will this take" — read by both humans and the hub filter. */
export function EffortBadge({ level }: EffortBadgeProps) {
  const filled = level === 'Hours' ? 1 : level === 'Days' ? 2 : 3
  return (
    <span
      className={`${baseChip} ${effortStyles[level]}`}
      title={`Estimated effort: ${level.toLowerCase()}`}
    >
      <Dot filled={filled} />
      {level}
    </span>
  )
}

export interface RiskBadgeProps {
  level: RiskLevel
}

/** "How likely is this to break something". Same dot scale as effort so
 *  users can read both at a glance without re-learning the visual. */
export function RiskBadge({ level }: RiskBadgeProps) {
  const filled = level === 'Low' ? 1 : level === 'Med' ? 2 : 3
  return (
    <span
      className={`${baseChip} ${riskStyles[level]}`}
      title={`Risk: ${level.toLowerCase()}`}
    >
      <Dot filled={filled} />
      {level} risk
    </span>
  )
}
