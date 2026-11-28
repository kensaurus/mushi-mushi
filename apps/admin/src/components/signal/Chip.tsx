/**
 * FILE: apps/admin/src/components/signal/Chip.tsx
 * PURPOSE: The kit's slim label chip (2026-11-18, moved from components/providers/providerMarks):
 *          a provider, an app, a parameter. Neutral by default; `strong` for the thing a row is
 *          about, `danger` for a problem word ("tried last"). A state is never a Chip: use
 *          StatusPill, which carries the state's glyph and colour.
 */

import type { ReactNode } from 'react'

export type ChipTone = 'neutral' | 'strong' | 'danger'

const TONE: Record<ChipTone, string> = {
  neutral: 'border-neutral-edge bg-surface-overlay text-fg-secondary',
  strong: 'border-edge bg-surface-raised text-fg',
  danger: 'border-st-failed/55 bg-st-failed-soft text-st-failed-ink', // mushi-mushi-allowlist: the Chip root adds `border`
}

export function Chip({ children, title, tone = 'neutral', className = '' }: { children: ReactNode; title?: string; tone?: ChipTone; className?: string }) {
  return (
    <span title={title} className={`inline-flex max-w-full items-center truncate rounded-xs border px-1 text-3xs leading-4 font-semibold ${TONE[tone]} ${className}`}>
      {children}
    </span>
  )
}
