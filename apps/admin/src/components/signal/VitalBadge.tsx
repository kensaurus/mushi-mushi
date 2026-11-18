/**
 * FILE: apps/admin/src/components/signal/VitalBadge.tsx
 * PURPOSE: A Web Vital as a graded badge, not a sentence (2026-11-18). "LCP of 7444 ms" becomes
 *          [▲ LCP 7.4 s] in the poor colour, graded against Google's thresholds
 *          (https://web.dev/articles/vitals): good / needs work / poor, each with its own
 *          shape so the grade never depends on colour. A sparkline follows when history exists.
 */

import { Sparkline } from '../ui/metrics'
import { StatusGlyph, TONE_INK, type SignalTone } from './StatusGlyph'

export type VitalName = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB' | 'FID'
export type VitalGrade = 'good' | 'needs-work' | 'poor'

/** Google's thresholds: at or under `good` is good, over `poor` is poor. ms, except CLS (unitless). */
export const VITAL_THRESHOLDS: Record<VitalName, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  FID: { good: 100, poor: 300 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
}

export function gradeVital(name: VitalName, value: number): VitalGrade {
  const t = VITAL_THRESHOLDS[name]
  if (value <= t.good) return 'good'
  if (value <= t.poor) return 'needs-work'
  return 'poor'
}

const GRADE_TONE: Record<VitalGrade, SignalTone> = { good: 'ok', 'needs-work': 'warn', poor: 'danger' }
const GRADE_WORDS: Record<VitalGrade, string> = { good: 'good', 'needs-work': 'needs work', poor: 'poor' }
const GRADE_BOX: Record<VitalGrade, string> = {
  good: 'border-ok/45 bg-ok-muted',
  'needs-work': 'border-warn/55 bg-warn-muted',
  poor: 'border-danger/55 bg-danger-muted',
}

/** "7.4 s", "180 ms", "0.31". */
export function formatVital(name: VitalName, value: number): string {
  if (name === 'CLS') return value.toFixed(2)
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`
  return `${Math.round(value)} ms`
}

/** Normalise a vital name from free text ("lcp", "web_vitals.lcp", "LCP_MS"). Null if not one. */
export function parseVitalName(raw: string | null | undefined): VitalName | null {
  if (!raw) return null
  const m = /\b(lcp|inp|cls|fcp|ttfb|fid)\b/i.exec(raw.replace(/[._-]/g, ' '))
  return m ? (m[1]!.toUpperCase() as VitalName) : null
}

export function VitalBadge({
  name,
  value,
  history,
  className = '',
}: {
  name: VitalName
  value: number
  /** Oldest first; draws a sparkline when there are 2+ points. */
  history?: readonly number[]
  className?: string
}) {
  const grade = gradeVital(name, value)
  const tone = GRADE_TONE[grade]
  const shown = formatVital(name, value)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 align-middle ${GRADE_BOX[grade]} ${className}`}
      aria-label={`${name} ${shown}, ${GRADE_WORDS[grade]}`}
      title={`${name} ${shown}: ${GRADE_WORDS[grade]} (good ≤ ${formatVital(name, VITAL_THRESHOLDS[name].good)}, poor > ${formatVital(name, VITAL_THRESHOLDS[name].poor)})`}
      data-testid={`vital-${name}`}
      data-grade={grade}
    >
      <StatusGlyph tone={tone} className="h-2.5 w-2.5" />
      <span className={`text-3xs font-bold tracking-wider uppercase ${TONE_INK[tone]}`}>{name}</span>
      <span className="font-mono text-2xs font-extrabold text-fg tabular-nums">{shown}</span>
      {history && history.length >= 2 && (
        <span aria-hidden="true" className={TONE_INK[tone]}>
          <Sparkline values={[...history]} width={40} height={12} filled={false} ariaLabel={`${name} trend`} />
        </span>
      )}
    </span>
  )
}
