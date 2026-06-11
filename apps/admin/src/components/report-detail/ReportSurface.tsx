/**
 * FILE: apps/admin/src/components/report-detail/ReportSurface.tsx
 * PURPOSE: Primitive layout components reused across the report detail
 *   surface — ContainedBlock (tinted inset card), SignalChip (compact
 *   labelled badge), InlineProof (key-value label chip), ActionPill
 *   (CTA button/link chip), and ActionPillRow (flex row wrapper).
 *   Kept here so report-detail components don't import from the
 *   top-level ui barrel (no circular deps, easier to co-evolve).
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// ─── ContainedBlock ───────────────────────────────────────────
// Inset tinted card for contextual data blocks.

type BlockTone = 'muted' | 'ok' | 'warn' | 'danger' | 'info' | 'brand' | 'neutral'

const BLOCK_TONE: Record<BlockTone, string> = {
  muted:   'bg-surface-overlay border-edge',
  neutral: 'bg-surface-overlay border-edge',
  ok:      'bg-ok-muted/20 border-ok/20',
  warn:    'bg-warn-muted/20 border-warn/20',
  danger:  'bg-danger-muted/20 border-danger/20',
  info:    'bg-info-muted/20 border-info/20',
  brand:   'bg-brand/5 border-brand/20',
}

export interface ContainedBlockProps {
  children: ReactNode
  tone?: BlockTone
  label?: string
  className?: string
}

export function ContainedBlock({ children, tone = 'muted', label, className = '' }: ContainedBlockProps) {
  return (
    <div className={`rounded-md border px-3 py-2.5 text-xs ${BLOCK_TONE[tone]} ${className}`}>
      {label && (
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-muted opacity-70">
          {label}
        </p>
      )}
      {children}
    </div>
  )
}

// ─── SignalChip ───────────────────────────────────────────────
// Compact badge for status signals (Accepted, Spam, etc.).

type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'bg-surface-overlay text-fg-muted border-edge',
  ok:      'bg-ok/15 text-ok border-ok/35',
  warn:    'bg-warn/15 text-warn border-warn/35',
  danger:  'bg-danger/15 text-danger border-danger/35',
  info:    'bg-info/15 text-info border-info/35',
  brand:   'bg-brand-subtle text-brand border-brand/35',
}

interface SignalChipProps {
  children: ReactNode
  tone?: ChipTone
  className?: string
}

export function SignalChip({ children, tone = 'neutral', className = '' }: SignalChipProps) {
  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center rounded-full border px-2 py-0.5 text-2xs font-medium whitespace-nowrap ${CHIP_TONE[tone]} ${className}`}
    >
      <span className="min-w-0 truncate">{children}</span>
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

// ─── ActionPill ───────────────────────────────────────────────
// CTA chip that renders as a button, internal link, or external anchor.
// Accepts `to` for React Router navigation, `href` for external URLs,
// or `onClick` for callbacks. Matches the visual language of SignalChip
// but is interactive and supports a `brand` accent tone.

type PillTone = 'neutral' | 'brand' | 'ok' | 'danger' | 'warn'

const PILL_TONE: Record<PillTone, string> = {
  neutral: 'bg-surface-overlay text-fg-muted border-edge hover:bg-surface-raised hover:text-fg',
  brand:   'bg-brand/10 text-brand border-brand/30 hover:bg-brand/20',
  ok:      'bg-ok-muted/20 text-ok border-ok/30 hover:bg-ok-muted/30',
  danger:  'bg-danger-muted/20 text-danger border-danger/30 hover:bg-danger-muted/30',
  warn:    'bg-warn-muted/20 text-warn border-warn/30 hover:bg-warn-muted/30',
}

export interface ActionPillProps {
  children: ReactNode
  tone?: PillTone
  className?: string
  onClick?: () => void
  to?: string
  href?: string
}

export function ActionPill({ children, tone = 'neutral', className = '', onClick, to, href }: ActionPillProps) {
  const base = `inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs font-medium transition-colors cursor-pointer ${PILL_TONE[tone]} ${className}`
  if (to) {
    return <Link to={to} className={base}>{children}</Link>
  }
  if (href) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={base}>{children}</a>
  }
  return (
    <button type="button" onClick={onClick} className={base}>
      {children}
    </button>
  )
}

// ─── ActionPillRow ────────────────────────────────────────────
// Flex row wrapper for one or more ActionPills.

interface ActionPillRowProps {
  children: ReactNode
  className?: string
  /** Spotlight/coachmark anchor — must be forwarded to the DOM to be targetable. */
  'data-dav-anchor'?: string
}

export function ActionPillRow({ children, className = '', ...rest }: ActionPillRowProps) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} {...rest}>
      {children}
    </div>
  )
}

// ─── MetaChip ─────────────────────────────────────────────────
// Labelled key-value chip: small label above, content below.
// Used in report headers for metadata like "Reported" date, "Component".

export interface MetaChipProps {
  children: ReactNode
  label: string
  title?: string
  to?: string
  className?: string
}

export function MetaChip({ children, label, title, to, className = '' }: MetaChipProps) {
  const inner = (
    <>
      <span className="text-2xs font-medium uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="text-fg-muted">{children}</span>
    </>
  )
  const base = `flex flex-col gap-0.5 rounded border border-edge bg-surface-overlay px-2 py-1 text-xs ${className}`
  if (to) {
    return <Link to={to} title={title} className={`${base} hover:bg-surface-raised transition-colors`}>{inner}</Link>
  }
  return <div title={title} className={base}>{inner}</div>
}

// ─── ConfidenceMeter ──────────────────────────────────────────
// Compact bar visualising a 0–1 confidence score.
// Used in report preview drawers alongside classification signals.

export interface ConfidenceMeterProps {
  confidence?: number | null
  className?: string
}

export function ConfidenceMeter({ confidence, className = '' }: ConfidenceMeterProps) {
  const pct = confidence != null ? Math.max(0, Math.min(1, confidence)) * 100 : 0
  const tone = pct >= 70 ? 'bg-ok' : pct >= 40 ? 'bg-warn' : 'bg-danger'
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-raised">
        <div
          className={`h-full rounded-full transition-all ${tone}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-2xs tabular-nums text-fg-muted">{confidence != null ? `${Math.round(pct)}%` : '—'}</span>
    </div>
  )
}

