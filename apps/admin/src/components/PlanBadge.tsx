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

const TONE: Record<string, string> = {
  hobby: 'bg-surface-overlay text-fg-muted border-edge-subtle',
  starter: 'bg-brand-subtle text-brand border-brand/30',
  pro: CHIP_TONE.okSubtle,
  enterprise: CHIP_TONE.warnSubtle,
}

const GLYPH: Record<string, string> = {
  hobby: '○',
  starter: '◆',
  pro: '◆◆',
  enterprise: '★',
}

// Complimentary — ghost text row in sidebar; bordered pill in header only.
const COMPLIMENTARY_TONE = 'text-fg-muted hover:text-brand border-0 bg-transparent'
const COMPLIMENTARY_TONE_HEADER = 'bg-brand-subtle text-brand border-brand/40'

function densityClasses(sidebar: boolean) {
  if (sidebar) {
    return 'w-full min-w-0 justify-center text-2xs px-0 py-0 gap-1 border-0 bg-transparent font-normal shrink-0'
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
  // over the entire pill — showing "Pro $99/mo" on a comp account
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
          sidebar ? COMPLIMENTARY_TONE : `${COMPLIMENTARY_TONE_HEADER} border hover:brightness-110`
        } ${densityClasses(sidebar)}`}
      >
        <span aria-hidden="true" className="leading-none shrink-0 text-brand/80 text-2xs">◆</span>
        <span className={sidebar ? 'truncate' : ''}>Admin</span>
        {sidebar ? (
          <span className="text-fg-faint font-mono uppercase tracking-wider text-2xs shrink-0">
            {plan.displayName}
          </span>
        ) : (
          <span
            className="rounded-sm bg-surface-overlay/70 font-mono uppercase tracking-wider text-fg-secondary shrink-0 px-1 py-0.5 text-2xs"
            aria-hidden="true"
          >
            {plan.displayName}
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
      className={`inline-flex items-center border font-medium motion-safe:transition-opacity hover:brightness-110 min-w-0 ${tone} ${densityClasses(sidebar)}`}
    >
      <span aria-hidden="true" className={`leading-none shrink-0 ${sidebar ? 'scale-90' : ''}`}>{glyph}</span>
      <span className={sidebar ? 'truncate min-w-0' : ''}>{label}</span>
      {plan.overQuota && (
        <span
          className={`ml-0.5 shrink-0 rounded-sm px-1 py-0.5 text-2xs font-semibold ${CHIP_TONE.dangerSubtle}`}
          aria-label="Over quota"
        >
          !
        </span>
      )}
      {!plan.overQuota && plan.usagePct != null && plan.usagePct >= 80 && (
        <span
          className={`ml-0.5 shrink-0 rounded-sm px-1 py-0.5 font-mono text-2xs ${CHIP_TONE.warnSubtle}`}
          aria-label={`${plan.usagePct}% used`}
        >
          {plan.usagePct}%
        </span>
      )}
    </Link>
  )
}
