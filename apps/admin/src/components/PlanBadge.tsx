/**
 * FILE: apps/admin/src/components/PlanBadge.tsx
 * PURPOSE: Compact "you're on <plan>" pill. Gives paid members an always-
 *          visible signal that their subscription is active AND surfaces the
 *          free-tier quota percentage so hobby users can see how close they
 *          are to upgrading without opening /billing first.
 *
 *          Clickable — deep-links to `/billing`. Tier tones match the existing
 *          `TIER_TONE` map on `BillingPage` so the badge feels consistent
 *          whether you see it in the header, sidebar, in a picker, or on a card.
 */

import { Link } from 'react-router-dom'
import { useActivePlan } from '../lib/useActivePlan'
import { CHIP_TONE } from '../lib/chipTone'
import { Badge } from './ui/layout'

const TONE: Record<string, string> = {
  hobby: CHIP_TONE.neutral,
  starter: CHIP_TONE.brand,
  pro: CHIP_TONE.ok,
  enterprise: CHIP_TONE.warn,
}

const GLYPH: Record<string, string> = {
  hobby: '○',
  starter: '◆',
  pro: '◆◆',
  enterprise: '★',
}

// Complimentary — ghost text row in sidebar; bordered pill in header only.
const COMPLIMENTARY_TONE = 'text-fg-muted hover:text-brand border-0 bg-transparent'
const COMPLIMENTARY_TONE_HEADER = CHIP_TONE.brand

function densityClasses(sidebar: boolean) {
  if (sidebar) {
    return 'w-full min-w-0 justify-center text-2xs px-0 py-0 gap-1 border-0 ring-0 bg-transparent font-normal shrink-0'
  }
  return 'text-2xs px-2 py-1 gap-1.5 rounded-sm'
}

export interface PlanBadgeProps {
  /** `sidebar` fits the stacked profile card in `SidebarUserCard`. */
  density?: 'header' | 'sidebar'
}

export function PlanBadge({ density = 'header' }: PlanBadgeProps) {
  const { plan, loading } = useActivePlan()

  const sidebar = density === 'sidebar'

  if (loading) {
    return (
      <span
        aria-busy="true"
        className={`inline-flex items-center gap-1 border border-edge-subtle bg-surface-raised/40 font-medium text-fg-faint motion-safe:animate-pulse ${densityClasses(sidebar)}`}
      >
        Plan…
      </span>
    )
  }
  if (!plan) return null

  const usageHint = plan.diagnosesLimit != null && plan.diagnosesUsagePct != null
    ? `${plan.diagnosesUsagePct}% of ${plan.diagnosesLimit.toLocaleString()} diagnoses used`
    : plan.diagnosesLimit != null
      ? `0% of ${plan.diagnosesLimit.toLocaleString()} diagnoses used`
      : plan.includedReportsPerMonth != null && plan.usagePct != null
        ? `${plan.usagePct}% of ${plan.includedReportsPerMonth.toLocaleString()} reports used`
        : plan.includedReportsPerMonth == null
          ? 'Unlimited reports'
          : null

  // Complimentary accounts (Mushi staff / sponsored / beta) intentionally take
  // over the entire pill — showing "Studio $79/mo" on a comp account
  // misrepresents the relationship. We surface "Admin" as the primary identity
  // and demote the entitlement tier to a secondary chip so the user still
  // knows which feature set they have access to.
  if (plan.isComplimentary) {
    const tooltip = [
      `Admin account — billed by Mushi Mushi at no cost`,
      `Feature set tracks the ${plan.displayName} tier`,
      usageHint,
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <Link
        to="/billing"
        title={tooltip}
        aria-label={`Admin account with ${plan.displayName} entitlements. ${usageHint ?? ''} Open billing.`}
        data-tour-id="plan-badge"
        className={`inline-flex items-center font-medium motion-safe:transition-opacity min-w-0 ${
          sidebar ? COMPLIMENTARY_TONE : `${COMPLIMENTARY_TONE_HEADER} hover:brightness-110`
        } ${densityClasses(sidebar)}`}
      >
        <span aria-hidden="true" className="leading-none shrink-0 text-brand/80 text-2xs">◆</span>
        {/* "Studio · free", not "Admin Studio": "Admin" read as a role or a
            second product (journey walk, 2026-11-28). */}
        <span className={sidebar ? 'truncate font-semibold text-fg-secondary' : ''}>{plan.displayName}</span>
        {sidebar ? (
          <span className="text-fg-muted text-2xs shrink-0">· free</span>
        ) : (
          <span aria-hidden="true" className="shrink-0">
            <Badge tone="neutral">free</Badge>
          </span>
        )}
      </Link>
    )
  }

  const tone = TONE[plan.planId] ?? TONE.hobby
  const glyph = GLYPH[plan.planId] ?? GLYPH.hobby
  const label = plan.displayName
  const tooltip = [
    `${plan.displayName}${plan.monthlyPriceUsd > 0 ? ` · $${plan.monthlyPriceUsd}/mo` : ''}`,
    usageHint,
    plan.cancelAtPeriodEnd ? 'Cancels at period end' : null,
  ].filter(Boolean).join(' · ')

  return (
    <Link
      to="/billing"
      title={tooltip}
      aria-label={`Current plan: ${label}. ${usageHint ?? ''} Open billing.`}
      data-tour-id="plan-badge"
      className={`inline-flex items-center font-medium motion-safe:transition-opacity hover:brightness-110 min-w-0 ${tone} ${densityClasses(sidebar)}`}
    >
      <span aria-hidden="true" className={`leading-none shrink-0 ${sidebar ? 'scale-90' : ''}`}>{glyph}</span>
      <span className={sidebar ? 'truncate min-w-0' : ''}>{label}</span>
      {plan.overQuota && (
        <span
          className={`ml-0.5 shrink-0 rounded-sm px-1 py-px text-2xs font-semibold ${CHIP_TONE.danger}`}
          aria-label="Over quota"
        >
          !
        </span>
      )}
      {!plan.overQuota && plan.usagePct != null && plan.usagePct >= 80 && (
        <span
          className={`ml-0.5 shrink-0 rounded-sm px-1 py-px font-mono text-2xs ${CHIP_TONE.warn}`}
          aria-label={`${plan.usagePct}% used`}
        >
          {plan.usagePct}%
        </span>
      )}
    </Link>
  )
}
