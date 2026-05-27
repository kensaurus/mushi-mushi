/**
 * FILE: apps/admin/src/components/report-detail/ReportSurface.tsx
 * PURPOSE: Primitive layout components reused across the report detail
 *   surface — ContainedBlock (tinted inset card), SignalChip (compact
 *   labelled badge), and InlineProof (key-value label chip).
 *   Kept here so report-detail components don't import from the
 *   top-level ui barrel (no circular deps, easier to co-evolve).
 */

import type { ReactNode } from 'react'

// ─── ContainedBlock ───────────────────────────────────────────
// Inset tinted card for contextual data blocks.

type BlockTone = 'muted' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'

const BLOCK_TONE: Record<BlockTone, string> = {
  muted:  'bg-surface-overlay border-edge',
  ok:     'bg-ok-muted/20 border-ok/20',
  warn:   'bg-warn-muted/20 border-warn/20',
  danger: 'bg-danger-muted/20 border-danger/20',
  info:   'bg-info-muted/20 border-info/20',
  brand:  'bg-brand/5 border-brand/20',
}

interface ContainedBlockProps {
  children: ReactNode
  tone?: BlockTone
  className?: string
}

export function ContainedBlock({ children, tone = 'muted', className = '' }: ContainedBlockProps) {
  return (
    <div className={`rounded-md border px-3 py-2.5 text-xs ${BLOCK_TONE[tone]} ${className}`}>
      {children}
    </div>
  )
}

// ─── SignalChip ───────────────────────────────────────────────
// Compact badge for status signals (Accepted, Spam, etc.).

type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info'

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'bg-surface-overlay text-fg-muted border-edge',
  ok:      'bg-ok-muted/30 text-ok border-ok/30',
  warn:    'bg-warn-muted/30 text-warn border-warn/30',
  danger:  'bg-danger-muted/30 text-danger border-danger/30',
  info:    'bg-info-muted/30 text-info border-info/30',
}

interface SignalChipProps {
  children: ReactNode
  tone?: ChipTone
  className?: string
}

export function SignalChip({ children, tone = 'neutral', className = '' }: SignalChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium ${CHIP_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

// ─── InlineProof ─────────────────────────────────────────────
// Key label in a key-value row (e.g. "Tester  @handle").

interface InlineProofProps {
  children: ReactNode
  className?: string
}

export function InlineProof({ children, className = '' }: InlineProofProps) {
  return (
    <span
      className={`inline-flex items-center rounded bg-surface-overlay px-1.5 py-0.5 text-2xs font-medium text-fg-muted shrink-0 ${className}`}
    >
      {children}
    </span>
  )
}
