/**
 * FILE: apps/admin/src/components/providers/providerMarks.tsx
 * PURPOSE: The small visual vocabulary of /providers: a provider state as
 *          colour + shape + short uppercase word (down pulses), slim chips,
 *          a margin change chip (▲/▼ with sign) and the pending mark. Colour
 *          is never the only signal. Follows the console status language
 *          (the CI page kit; a sibling PR moves that kit to components/signal).
 */

import type { ReactNode } from 'react'
import type { ProviderState } from '../../lib/kensaurusOpsTypes'

const STATE_STYLE: Record<ProviderState, { word: string; mark: string; ink: string; shape: 'tri' | 'dia' | 'dot' | 'clock' | 'ring' }> = {
  down: { word: 'DOWN', mark: 'text-danger', ink: 'text-danger-foreground', shape: 'tri' },
  warn: { word: 'WARN', mark: 'text-warn', ink: 'text-warn-foreground', shape: 'dia' },
  ok: { word: 'OK', mark: 'text-ok', ink: 'text-ok-foreground', shape: 'dot' },
  stale: { word: 'STALE', mark: 'text-fg-faint', ink: 'text-fg-secondary', shape: 'clock' },
  unknown: { word: 'UNKNOWN', mark: 'text-fg-faint', ink: 'text-fg-secondary', shape: 'ring' },
}

function Shape({ shape, className }: { shape: (typeof STATE_STYLE)[ProviderState]['shape']; className: string }) {
  return (
    <svg viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 ${className}`} aria-hidden="true">
      {shape === 'tri' && <path d="M6 1 11.5 11H.5z" fill="currentColor" />}
      {shape === 'dia' && <path d="M6 .5 11.5 6 6 11.5.5 6z" fill="currentColor" />}
      {shape === 'dot' && <circle cx="6" cy="6" r="5" fill="currentColor" />}
      {shape === 'ring' && <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {shape === 'clock' && (
        <g fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="6" cy="6" r="4.5" />
          <path d="M6 3.5V6l1.75 1.25" />
        </g>
      )}
    </svg>
  )
}

/** A provider's state: shape + word, plus "for 3h" when known. Down pulses (reduced motion: still). */
export function ProviderStateMark({ state, since, compact = false }: { state: ProviderState; since?: string | null; compact?: boolean }) {
  const s = STATE_STYLE[state]
  return (
    <span className="inline-flex shrink-0 items-center gap-1" data-state={state} title={since ? `${s.word.toLowerCase()} for ${since}` : s.word.toLowerCase()}>
      <span className="relative inline-flex h-3 w-3 items-center justify-center">
        {state === 'down' && <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-50 motion-safe:animate-ping" aria-hidden="true" />}
        <Shape shape={s.shape} className={`relative ${s.mark}`} />
      </span>
      {!compact && <span className={`text-3xs font-bold tracking-wider ${s.ink}`}>{s.word}</span>}
      {!compact && since && <span className="font-mono text-3xs text-fg-secondary tabular-nums">{since}</span>}
      {compact && <span className="sr-only">{s.word.toLowerCase()}</span>}
    </span>
  )
}

/** A slim neutral chip (provider, app, param). */
export function Chip({ children, title, tone = 'neutral', className = '' }: { children: ReactNode; title?: string; tone?: 'neutral' | 'strong' | 'danger'; className?: string }) {
  const toneClass =
    tone === 'strong'
      ? 'border-edge bg-surface-raised text-fg'
      : tone === 'danger'
        ? 'border-danger/50 bg-danger-muted text-danger-foreground'
        : 'border-edge-subtle bg-surface-overlay text-fg-secondary'
  return (
    <span title={title} className={`inline-flex max-w-full items-center truncate rounded-xs border px-1 text-3xs leading-4 font-semibold ${toneClass} ${className}`}>
      {children}
    </span>
  )
}

/** Margin as ▲/▼ with a sign: green above zero, red below. */
export function ChangeChip({ value }: { value: number | null }) {
  if (value == null) return <span className="text-3xs text-fg-faint">—</span>
  const pct = Math.round(value * 100)
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 font-mono text-3xs font-bold tabular-nums ${up ? 'text-ok-foreground' : 'text-danger-foreground'}`} data-testid="margin-chip">
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {up ? '+' : ''}
      {pct}%
    </span>
  )
}

/** A row whose write is in flight: a small spinning ring. */
export function PendingMark({ label = 'Saving' }: { label?: string }) {
  return (
    <span className="inline-flex h-3 w-3 shrink-0 rounded-full border-2 border-info border-t-transparent motion-safe:animate-spin" role="status" aria-label={label} data-testid="pending-mark" />
  )
}

/** A horizontal bar with warn/crit ticks. `fill` 0..1. */
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
  const colour = level === 'crit' ? 'bg-danger' : level === 'warn' ? 'bg-warn' : 'bg-ok'
  const pct = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-level={level}>
      <span className="relative h-2 w-24 shrink-0 overflow-hidden rounded-xs bg-surface-overlay">
        <span className={`absolute inset-y-0 left-0 ${colour} motion-safe:transition-[width] motion-safe:duration-300`} style={{ width: pct(fill) }} />
        {warn != null && <span className="absolute inset-y-0 w-px bg-warn-foreground" style={{ left: pct(warn) }} title="warn" aria-hidden="true" />}
        {crit != null && <span className="absolute inset-y-0 w-px bg-danger-foreground" style={{ left: pct(crit) }} title="crit" aria-hidden="true" />}
      </span>
      <span className="truncate font-mono text-2xs font-bold text-fg tabular-nums">{label}</span>
    </span>
  )
}
