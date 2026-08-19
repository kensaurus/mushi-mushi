/**
 * FILE: apps/admin/src/components/sidebar/NavRailLink.tsx
 * PURPOSE: One row of the collapsed sidebar rail.
 *
 * Split out of Layout.tsx so the rail's accessibility contract (name in
 * `aria-label`, explanation in a real `aria-describedby` target, count never
 * announced only as colour) can be asserted in a unit test — Layout itself
 * needs auth + a dozen fetching hooks to mount.
 *
 * Layout behaviour this preserves: the badge OVERLAYS the glyph instead of
 * sitting beside it. The pre-refactor compact branch dropped the expanded
 * sidebar's `ml-auto` badge node into a `justify-center` flex row, which
 * rendered `[icon][gap][dot][3]` and pushed the icon off optical centre.
 */

import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { IntegrationHealthDot } from '../IntegrationHealthDot'
import { CHIP_TONE } from '../../lib/chipTone'
import { navBadgeStatus, type NavBadgeSpec } from '../../lib/navBadges'
import type { HealthTone } from '../../lib/useNavCounts'
import { Tooltip } from '../ui'
import { NavRailFlyout } from './NavRailFlyout'

/** Count pill tones — CHIP_TONE so the strict chip-contrast guard covers them. */
const RAIL_BADGE_TONE: Record<HealthTone, string> = {
  idle: CHIP_TONE.neutral,
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
}

/** Solid fill for the number-less status dot variant. */
const RAIL_DOT_TONE: Record<HealthTone, string> = {
  idle: 'bg-fg-faint',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
}

/**
 * Stable DOM id for a rail control's screen-reader description. The flyout is
 * portaled and only exists while visible, so the description has to live
 * inside the control itself for `aria-describedby` to always resolve.
 */
export function railDescriptionId(key: string): string {
  const slug = key.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
  return `rail-desc-${slug || 'root'}`
}

/** Counts are capped so a runaway number can never widen the 44px tile. */
export function railBadgeText(count: number): string {
  return count > 99 ? '99+' : String(count)
}

export interface NavRailLinkProps {
  to: string
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  active: boolean
  /** Feature-gated for this plan — shows a "Pro" kicker in the flyout. */
  gated?: boolean
  badge: NavBadgeSpec | null
  onNavigate?: () => void
}

export function NavRailLink({
  to,
  label,
  description,
  icon: Icon,
  active,
  gated = false,
  badge,
  onNavigate,
}: NavRailLinkProps) {
  const status = navBadgeStatus(badge)
  const descId = railDescriptionId(to)
  return (
    <Tooltip
      side="right"
      portal
      content={
        <NavRailFlyout
          title={label}
          description={description}
          status={status}
          kicker={gated ? { label: 'Pro', className: CHIP_TONE.brandSubtle } : null}
        />
      }
    >
      <Link
        to={to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        aria-describedby={descId}
        className={`nav-rail-item ${gated ? 'opacity-80' : ''}`}
      >
        <span className="nav-rail-glyph">
          <Icon className="nav-rail-icon" />
          {badge?.kind === 'integration' ? (
            <span className="nav-rail-badge-slot">
              <IntegrationHealthDot />
            </span>
          ) : status ? (
            <span
              aria-hidden="true"
              className={
                status.count == null
                  ? `nav-rail-badge nav-rail-badge--dot ring-1 ring-surface-root ${RAIL_DOT_TONE[status.tone]}`
                  : `nav-rail-badge ring-1 ring-surface-root ${RAIL_BADGE_TONE[status.tone]}`
              }
            >
              {status.count == null ? null : railBadgeText(status.count)}
            </span>
          ) : null}
        </span>
        {/* The flyout is never the only source of the explanation — AT reads
            this whether or not the tooltip is open. */}
        <span id={descId} className="sr-only">
          {description}
          {status ? ` — ${status.label}` : ''}
        </span>
      </Link>
    </Tooltip>
  )
}
