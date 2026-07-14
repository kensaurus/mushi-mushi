/**
 * Shell chrome primitives — header context switchers (team / project).
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { CHIP_TONE } from '../../lib/chipTone'
import type { BadgeTone } from './layout'

const TRIGGER_BASE =
  'inline-flex max-w-full items-center gap-1 rounded-sm border border-edge-subtle bg-surface-raised/60 px-1.5 py-1 text-2xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 xl:gap-1.5 xl:px-2'

export interface HeaderContextChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Uppercase kicker label, e.g. "Team" or "Project". */
  kicker?: string
  /** Primary label (truncated). */
  label: ReactNode
  /** Nested status pill text — uses CHIP_TONE when `badgeTone` is set. */
  badge?: ReactNode
  badgeTone?: BadgeTone
  /** Trailing affordance (chevron, skeleton, etc.). */
  trailing?: ReactNode
  /** Hide kicker below `sm` (legacy project switcher). */
  kickerHiddenSm?: boolean
  /** Hide kicker below `lg` — saves header width on laptop viewports. */
  kickerHiddenBelowLg?: boolean
  /** Hide plan/status badge below `xl` — full label stays in `title`. */
  badgeHiddenBelowXl?: boolean
  /** Accent CTA styling for empty-state create actions. */
  variant?: 'default' | 'accent'
}

export function HeaderContextChip({
  kicker,
  label,
  badge,
  badgeTone,
  trailing,
  kickerHiddenSm,
  kickerHiddenBelowLg,
  badgeHiddenBelowXl,
  variant = 'default',
  className = '',
  type = 'button',
  ...props
}: HeaderContextChipProps) {
  const kickerClass = kickerHiddenBelowLg
    ? ' hidden lg:inline'
    : kickerHiddenSm
      ? ' hidden sm:inline'
      : ''
  const variantClass =
    variant === 'accent'
      ? 'bg-brand/12 text-brand border border-brand/28 hover:bg-brand-subtle'
      : ''
  return (
    <button type={type} className={`${TRIGGER_BASE} ${variantClass} ${className}`.trim()} {...props}>
      {kicker ? (
        <span
          className={`text-2xs uppercase tracking-wider text-fg-muted shrink-0${kickerClass}`}
        >
          {kicker}
        </span>
      ) : null}
      <span className="max-w-[5.5rem] sm:max-w-[7rem] lg:max-w-[8rem] xl:max-w-[10rem] min-w-0 truncate font-medium inline-flex items-center gap-1">{label}</span>
      {badge != null && badge !== false ? (
        typeof badge === 'string' || typeof badge === 'number' ? (
          <span
            className={`inline-flex h-5 max-w-[4.5rem] xl:max-w-[5.5rem] items-center truncate rounded-sm px-1 text-2xs font-medium uppercase shrink-0 ${
              badgeHiddenBelowXl ? 'hidden xl:inline-flex' : ''
            } ${badgeTone ? CHIP_TONE[badgeTone] : CHIP_TONE.neutral}`}
          >
            {badge}
          </span>
        ) : (
          badge
        )
      ) : null}
      {trailing}
    </button>
  )
}

/** Non-interactive skeleton matching HeaderContextChip footprint. */
export function HeaderContextChipSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={`${TRIGGER_BASE} text-fg-faint motion-safe:animate-pulse`}
    >
      {label}
    </div>
  )
}

/** Router link matching HeaderContextChip footprint. */
export function HeaderContextChipLink({
  children,
  className = '',
  ...props
}: LinkProps) {
  return (
    <Link className={`${TRIGGER_BASE} ${className}`.trim()} {...props}>
      {children}
    </Link>
  )
}
