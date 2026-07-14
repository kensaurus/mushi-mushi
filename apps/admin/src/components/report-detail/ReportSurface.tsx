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
import {
  confidenceBarTone,
  confidencePercent,
  confidenceTextTone,
  CONFIDENCE_SEGMENT_COUNT,
  confidenceSegmentFilled,
} from '../reports/reportMetricViz'
import { CHIP_TONE } from '../../lib/chipTone'

// ─── ContainedBlock ───────────────────────────────────────────
// Inset tinted card for contextual data blocks.

type BlockTone = 'muted' | 'ok' | 'warn' | 'danger' | 'info' | 'brand' | 'neutral'

const BLOCK_TONE: Record<BlockTone, string> = {
  muted:   'bg-surface-overlay border-edge',
  neutral: 'bg-surface-overlay border-edge',
  ok:      'bg-ok-muted border-ok/25',
  warn:    'bg-warn-muted border-warn/25',
  danger:  'bg-danger-muted border-danger/25',
  info:    'bg-info-muted border-info/25',
  brand:   'bg-brand-subtle border-brand/25',
}

export interface ContainedBlockProps {
  children: ReactNode
  tone?: BlockTone
  label?: string
  icon?: ReactNode
  className?: string
}

export function ContainedBlock({ children, tone = 'muted', label, icon, className = '' }: ContainedBlockProps) {
  return (
    <div className={`rounded-md border px-3 py-2.5 text-xs ${BLOCK_TONE[tone]} ${className}`}>
      {label && (
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-muted opacity-70">
          {label}
        </p>
      )}
      {icon ? (
        <div className="flex gap-2 items-start">
          {icon}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  )
}

// ─── SignalChip ───────────────────────────────────────────────
// Compact badge for status signals (Accepted, Spam, etc.).

type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'

const SIGNAL_CHIP_TONE: Record<ChipTone, string> = {
  neutral: CHIP_TONE.neutral,
  ok:      CHIP_TONE.okSubtle,
  warn:    CHIP_TONE.warnSubtle,
  danger:  CHIP_TONE.dangerSubtle,
  info:    CHIP_TONE.infoSubtle,
  brand:   CHIP_TONE.brandSubtle,
}

interface SignalChipProps {
  children: ReactNode
  tone?: ChipTone
  className?: string
}

export function SignalChip({ children, tone = 'neutral', className = '' }: SignalChipProps) {
  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center rounded-full border px-2 py-0.5 text-2xs font-medium whitespace-nowrap ${SIGNAL_CHIP_TONE[tone]} ${className}`}
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
  neutral: `${CHIP_TONE.neutral} hover:bg-surface-raised hover:text-fg`,
  brand:   `${CHIP_TONE.brandSubtle} hover:bg-brand-subtle`,
  ok:      `${CHIP_TONE.okSubtle} hover:bg-ok-muted/30`,
  danger:  `${CHIP_TONE.dangerSubtle} hover:bg-danger-muted/30`,
  warn:    `${CHIP_TONE.warnSubtle} hover:bg-warn-muted/30`,
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
  const pct = confidencePercent(confidence)
  if (pct == null || confidence == null) {
    return <span className={`text-2xs text-fg-faint ${className}`}>—</span>
  }

  const barTone = confidenceBarTone(confidence)
  const textTone = confidenceTextTone(pct)

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="flex h-1.5 w-16 gap-px overflow-hidden rounded-full bg-surface-raised p-px">
        {Array.from({ length: CONFIDENCE_SEGMENT_COUNT }, (_, i) => (
          <span
            key={i}
            className={`flex-1 rounded-hairline motion-safe:transition-colors ${
              confidenceSegmentFilled(pct, i) ? barTone : 'bg-edge-subtle/80'
            }`}
          />
        ))}
      </div>
      <span className={`text-2xs tabular-nums font-mono font-medium ${textTone}`}>{pct}%</span>
    </div>
  )
}

