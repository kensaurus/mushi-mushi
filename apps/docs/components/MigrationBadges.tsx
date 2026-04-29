/**
 * FILE: apps/docs/components/MigrationBadges.tsx
 * PURPOSE: Two small chips for migration metadata — effort and risk.
 *
 *   <EffortBadge level="Days" />   - Hours | Days | Weeks
 *   <RiskBadge   level="Med"  />   - Low   | Med  | High
 *
 * Used at the top of every guide ("here's what you're in for") AND in the
 * <MigrationHub /> grid card so users can scan the catalogue quickly without
 * opening each page. Colors are neutral-with-accent so they read in both
 * Nextra light and dark themes; we deliberately avoid the page's vermillion
 * brand color for the high-risk chip so it doesn't fight Mushi's identity.
 */

import type { ReactNode } from 'react'

export type EffortLevel = 'Hours' | 'Days' | 'Weeks'
export type RiskLevel = 'Low' | 'Med' | 'High'

export const EFFORT_LEVELS: EffortLevel[] = ['Hours', 'Days', 'Weeks']
export const RISK_LEVELS: RiskLevel[] = ['Low', 'Med', 'High']

const baseChip =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-mono uppercase tracking-[0.12em] leading-none align-middle'

const effortStyles: Record<EffortLevel, string> = {
  Hours:
    'border-emerald-300/70 bg-emerald-50 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200',
  Days: 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200',
  Weeks:
    'border-rose-300/70 bg-rose-50 text-rose-900 dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200',
}

const riskStyles: Record<RiskLevel, string> = {
  Low: 'border-emerald-300/70 bg-emerald-50 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200',
  Med: 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200',
  High: 'border-rose-300/70 bg-rose-50 text-rose-900 dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200',
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
