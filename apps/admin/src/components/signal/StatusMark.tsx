/**
 * FILE: apps/admin/src/components/signal/StatusMark.tsx
 * PURPOSE: The console's one way to draw a state (2026-11-18; the owner: "a running runner could
 *          show as running colour and status and graphical, and show different when broken —
 *          you expect us to read a bunch of text wall?").
 *
 * Every state has its own colour token (`st-*` in styles/theme-tokens.css, light and dark),
 * its own glyph and, for running, its own motion, so it never relies on colour alone:
 *   running   ● + a breathing ring (blue)        passed    ✓ (green)
 *   failed    ✕ (red)                             waiting   clock (amber)
 *   slow      hourglass (orange)                  idle      hollow ○ (grey)
 *   cancelled ⊘ with a struck label (muted grey)
 * Under prefers-reduced-motion the ring stops; the glyph stays.
 *
 *   <StatusMark status="running" />                  the mark alone (decorative unless `label`)
 *   <StatusPill status="failed" label="2 failed" />  mark + short label, ink on soft ground
 */

import type { ReactNode } from 'react'

export type RunStatus = 'running' | 'passed' | 'failed' | 'waiting' | 'slow' | 'idle' | 'cancelled'

/** Default words for each state (short; pages pass their own label when they have a better one). */
export const STATUS_WORD: Record<RunStatus, string> = {
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  waiting: 'Waiting',
  slow: 'Slow',
  idle: 'Idle',
  cancelled: 'Cancelled',
}

/** Bright mark colour (text-* so the SVG's currentColor picks it up). */
const STATUS_MARK: Record<RunStatus, string> = {
  running: 'text-st-running',
  passed: 'text-st-passed',
  failed: 'text-st-failed',
  waiting: 'text-st-waiting',
  slow: 'text-st-slow',
  idle: 'text-st-idle',
  cancelled: 'text-st-cancelled',
}

/** Deep text colour beside the mark. */
export const STATUS_INK: Record<RunStatus, string> = {
  running: 'text-st-running-ink',
  passed: 'text-st-passed-ink',
  failed: 'text-st-failed-ink',
  waiting: 'text-st-waiting-ink',
  slow: 'text-st-slow-ink',
  idle: 'text-st-idle-ink',
  cancelled: 'text-st-cancelled-ink',
}

/** Soft ground + edge for pills, tiles and cells. */
export const STATUS_SOFT: Record<RunStatus, string> = {
  running: 'bg-st-running-soft border-st-running/50',
  passed: 'bg-st-passed-soft border-st-passed/45',
  failed: 'bg-st-failed-soft border-st-failed/55',
  waiting: 'bg-st-waiting-soft border-st-waiting/55',
  slow: 'bg-st-slow-soft border-st-slow/55',
  idle: 'bg-st-idle-soft border-st-idle/45',
  cancelled: 'bg-st-cancelled-soft border-st-cancelled/45',
}

/** Solid fill for bars and dots. */
export const STATUS_FILL: Record<RunStatus, string> = {
  running: 'bg-st-running',
  passed: 'bg-st-passed',
  failed: 'bg-st-failed',
  waiting: 'bg-st-waiting',
  slow: 'bg-st-slow',
  idle: 'bg-st-idle',
  cancelled: 'bg-st-cancelled',
}

/** @internal A plain-text glyph per state, for titles and places an SVG can't go (exported for tests). */
export const STATUS_CHAR: Record<RunStatus, string> = {
  running: '●',
  passed: '✓',
  failed: '✕',
  waiting: '◷',
  slow: '⧗',
  idle: '○',
  cancelled: '⊘',
}

/** 12 × 12 drawings; stroke glyphs use currentColor. */
function Glyph({ status }: { status: RunStatus }): ReactNode {
  switch (status) {
    case 'running':
      return <circle cx="6" cy="6" r="3.5" fill="currentColor" />
    case 'passed':
      return <path d="M2.2 6.4 4.9 9 9.8 3.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    case 'failed':
      return <path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    case 'waiting':
      return (
        <>
          <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 3.4V6l1.9 1.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )
    case 'slow':
      return <path d="M3 1.5h6M3 10.5h6M3.6 1.8c0 2.6 4.8 2.6 4.8 4.2S3.6 7.6 3.6 10.2M8.4 1.8c0 2.6-4.8 2.6-4.8 4.2s4.8 1.6 4.8 4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    case 'idle':
      return <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    case 'cancelled':
      return (
        <>
          <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 9 9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )
  }
}

export function StatusMark({
  status,
  label,
  size = 12,
  className = '',
}: {
  status: RunStatus
  /** Accessible name when the mark stands alone; omit when a word sits beside it. */
  label?: string
  size?: number
  className?: string
}) {
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${STATUS_MARK[status]} ${className}`}
      style={{ width: size, height: size }}
      data-status={status}
      data-testid="status-mark"
      {...a11y}
    >
      {status === 'running' && <span className="st-ring absolute inset-0 rounded-full border-2 border-current" aria-hidden="true" />}
      <svg viewBox="0 0 12 12" width={size} height={size} className="relative" aria-hidden="true">
        <Glyph status={status} />
      </svg>
    </span>
  )
}

export function StatusPill({
  status,
  label,
  title,
  className = '',
  strike = true,
}: {
  status: RunStatus
  /** Short words ("running 2", "3 failed"); defaults to the state's word. */
  label?: ReactNode
  title?: string
  className?: string
  /**
   * Strike a cancelled label through (a cancelled run). False where the words already say the
   * state, such as a provider that is "Off for all apps": struck, that read as "not off" (2026-11-21).
   */
  strike?: boolean
}) {
  const text = label ?? STATUS_WORD[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-px text-2xs leading-tight font-bold whitespace-nowrap ${STATUS_SOFT[status]} ${STATUS_INK[status]} ${className}`}
      title={title}
      data-status={status}
      data-testid="status-pill"
    >
      <StatusMark status={status} size={10} />
      <span className={status === 'cancelled' && strike ? 'line-through decoration-1' : ''}>{text}</span>
    </span>
  )
}

/** A bar for something in progress: running stripes, a tick at the usual time, overrun past it. */
export function RunBar({
  elapsedS,
  usualS,
  label,
  className = '',
}: {
  elapsedS: number
  /** The usual duration; null draws an open-ended running bar. */
  usualS: number | null
  /** Visible short text, e.g. "18 / 16 min". */
  label: string
  className?: string
}) {
  const ratio = usualS && usualS > 0 ? elapsedS / usualS : null
  // Scale: the bar's full width is max(usual × 1.5, elapsed) so the tick sits at a fixed place
  // while the job is on time and the overrun has room to show.
  const scale = usualS && usualS > 0 ? Math.max(usualS * 1.5, elapsedS) : null
  const pct = (s: number) => (scale ? Math.min(100, (s / scale) * 100) : 0)
  const over = ratio != null && ratio > 1
  const status: RunStatus = ratio == null || ratio <= 1 ? 'running' : ratio <= 1.5 ? 'slow' : 'failed'
  const onTimeS = usualS != null ? Math.min(elapsedS, usualS) : elapsedS
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`} data-testid="run-bar" data-status={status}>
      <span className="relative block h-2.5 min-w-16 flex-1 overflow-hidden rounded-sm bg-surface-overlay" aria-hidden="true">
        {scale ? (
          <>
            <span className="ci-grow-x st-run-bar ci-stripes absolute inset-y-0 left-0" style={{ width: `${Math.max(3, pct(onTimeS))}%` }} />
            {over && (
              <span
                className={`ci-grow-x absolute inset-y-0 ${STATUS_FILL[status]}`}
                style={{ left: `${pct(usualS!)}%`, width: `${pct(elapsedS) - pct(usualS!)}%` }}
                data-testid="run-bar-over"
              />
            )}
            <span className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: `${pct(usualS!)}%` }} data-testid="run-bar-usual" />
          </>
        ) : (
          <span className="st-run-bar ci-stripes absolute inset-0 opacity-70" />
        )}
      </span>
      <span className={`shrink-0 font-mono text-2xs font-bold tabular-nums ${STATUS_INK[status]}`}>{label}</span>
    </span>
  )
}
