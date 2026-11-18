/**
 * FILE: apps/admin/src/components/signal/BarCell.tsx
 * PURPOSE: An inline bar beside its number (2026-11-18, from the CI page's duration and CPU
 *          bars): a duration, a share or a progress reads by length at a glance, where a
 *          column of numbers has to be read cell by cell. The number stays as text; the bar
 *          repeats it and is hidden from screen readers. Bars grow in once
 *          (`ci-grow-x`, off under prefers-reduced-motion).
 */

import type { ReactNode } from 'react'

export type BarTone = 'neutral' | 'heat' | 'danger' | 'warn' | 'ok' | 'info' | 'accent'

const FILL: Record<BarTone, string> = {
  neutral: 'bg-fg-secondary',
  heat: 'ci-heat-4',
  danger: 'bg-danger',
  warn: 'bg-warn',
  ok: 'bg-ok',
  info: 'bg-info',
  accent: 'bg-accent',
}

/** 0–100, clamped; 0 when max is not positive. */
export function barPct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(100, Math.max(0, (value / max) * 100))
}

export function BarCell({
  value,
  max,
  tone = 'neutral',
  text,
  label,
  widthClass = 'w-16',
  className = '',
}: {
  value: number
  /** The top of the shared scale (the largest value in the column, or 100 for a percent). */
  max: number
  tone?: BarTone
  /** The visible number. Omit to show the bar alone (then `label` names it). */
  text?: ReactNode
  /** Accessible name when there is no visible `text`. */
  label?: string
  widthClass?: string
  className?: string
}) {
  const pct = barPct(value, max)
  const bar = (
    <span className={`relative inline-block h-1.5 shrink-0 overflow-hidden rounded-full bg-surface-overlay ${widthClass}`} aria-hidden="true">
      <span
        className={`ci-grow-x absolute inset-y-0 left-0 rounded-full ${FILL[tone]}`}
        style={{ width: `${pct}%` }}
        data-testid="bar-cell-fill"
      />
    </span>
  )
  if (text == null) {
    return (
      <span
        role="meter"
        aria-label={label ?? `${Math.round(pct)}%`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={`inline-flex items-center ${className}`}
      >
        {bar}
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="min-w-8 text-right font-mono text-2xs font-bold text-fg tabular-nums">{text}</span>
      {bar}
    </span>
  )
}

/**
 * A budget or quota bar with its warn and crit ticks (2026-11-18, moved from
 * components/providers/providerMarks): `fill` is 0..1 of the limit, the ticks sit at their own
 * fractions, and the fill takes the run-status colour of its level (✓ ok, ⧗ warn, ✕ crit). The
 * visible label carries the number; the bar repeats it.
 */
export function ThresholdBar({
  fill,
  warn,
  crit,
  level,
  label,
}: {
  fill: number
  warn: number | null
  crit: number | null
  level: 'ok' | 'warn' | 'crit'
  label: string
}) {
  const colour = level === 'crit' ? 'bg-st-failed' : level === 'warn' ? 'bg-st-slow' : 'bg-st-passed'
  const pct = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-level={level}>
      <span className="relative h-2 w-24 shrink-0 overflow-hidden rounded-xs bg-surface-overlay" aria-hidden="true">
        <span className={`ci-grow-x absolute inset-y-0 left-0 ${colour}`} style={{ width: pct(fill) }} />
        {warn != null && <span className="absolute inset-y-0 w-px bg-st-slow-ink" style={{ left: pct(warn) }} />}
        {crit != null && <span className="absolute inset-y-0 w-px bg-st-failed-ink" style={{ left: pct(crit) }} />}
      </span>
      <span className="truncate font-mono text-2xs font-bold text-fg tabular-nums">{label}</span>
    </span>
  )
}
