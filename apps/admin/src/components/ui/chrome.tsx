/**
 * Shell chrome primitives — header context switchers (team / project).
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import type { BadgeTone } from './layout'

/**
 * One control height for the whole top bar (h-8). Search, switchers, the
 * version pill and the icon buttons used to be 24 / 26 / 28 / 34px tall with
 * four different border and fill treatments.
 */
export const HEADER_CONTROL_BASE =
  'inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-sm border border-edge-subtle px-2 text-xs text-fg-secondary hover:bg-surface-hover hover:text-fg motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50'

const TRIGGER_BASE = HEADER_CONTROL_BASE

export interface HeaderContextChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Uppercase kicker label, e.g. "Team" or "Project". */
  kicker?: string
  /**
   * Leading glyph that replaces the uppercase kicker text. The kicker word
   * still reaches assistive tech through `title`/`aria-label`, but the header
   * stops spending ~55px per switcher on the words TEAM and PROJECT — which
   * is what squeezed long project names into "the-wanting-mi…".
   */
  icon?: ReactNode
  /** Primary label (truncated). */
  label: ReactNode
  /** Trailing tag (plan / role). `badgeTone="brand"` tints it; anything else is muted. */
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
  icon,
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
  title,
  ...props
}: HeaderContextChipProps) {
  const kickerClass = kickerHiddenBelowLg
    ? ' hidden lg:inline'
    : kickerHiddenSm
      ? ' hidden sm:inline'
      : ''
  // An icon replaces the kicker word entirely; the word survives in the
  // tooltip so nothing is lost for a first-time or assistive-tech user.
  const resolvedTitle =
    title ?? (kicker && typeof label === 'string' ? `${kicker}: ${label}` : undefined)
  const variantClass =
    variant === 'accent'
      ? 'bg-brand/12 text-brand-foreground border border-brand/28 hover:bg-brand-subtle'
      : ''
  return (
    <button
      type={type}
      title={resolvedTitle}
      className={`${TRIGGER_BASE} ${variantClass} ${className}`.trim()}
      {...props}
    >
      {icon ? (
        <span className="shrink-0 inline-flex items-center text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden>
          {icon}
        </span>
      ) : kicker ? (
        <span
          className={`text-2xs uppercase tracking-wider text-fg-muted shrink-0${kickerClass}`}
        >
          {kicker}
        </span>
      ) : null}
      {/* Wider than before: dropping the kicker word buys ~55px, which goes to
          the name so real project slugs stop truncating mid-word. */}
      <span className="max-w-[7rem] sm:max-w-[9rem] lg:max-w-[12rem] xl:max-w-[15rem] min-w-0 truncate font-medium inline-flex items-center gap-1">{label}</span>
      {badge != null && badge !== false ? (
        typeof badge === 'string' || typeof badge === 'number' ? (
          // Plain tag text, not a filled pill: a coloured chip nested inside a
          // bordered chip was the "ADMIN" orange-on-amber box in the header.
          // One display utility per branch: `inline-flex` + `hidden` together
          // both set `display`, and inline-flex won — the badge never hid.
          <span
            className={`max-w-[4.5rem] xl:max-w-[5.5rem] items-center truncate text-3xs font-semibold uppercase tracking-wider shrink-0 ${
              badgeHiddenBelowXl ? 'hidden xl:inline-flex' : 'inline-flex'
            } ${badgeTone === 'brand' ? 'text-brand-foreground' : 'text-fg-muted'}`}
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
