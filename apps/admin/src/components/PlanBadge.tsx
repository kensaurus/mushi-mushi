/**
 * FILE: apps/admin/src/components/PlanBadge.tsx
 * PURPOSE: Compact "you're on <plan>" pill for the global header. Gives paid
 *          members an always-visible signal that their subscription is active
 *          AND surfaces the free-tier quota percentage so hobby users can see
 *          how close they are to upgrading without opening /billing first.
 *
 *          Clickable — deep-links to `/billing`. Tier tones match the existing
 *          `TIER_TONE` map on `BillingPage` so the badge feels consistent
 *          whether you see it in the header, in a picker, or on a card.
 */

import { Link } from 'react-router-dom'
import { useActivePlan } from '../lib/useActivePlan'

const TONE: Record<string, string> = {
  hobby: 'bg-surface-overlay text-fg-muted border-edge-subtle',
  starter: 'bg-brand-subtle text-brand border-brand/30',
  pro: 'bg-ok-muted text-ok border-ok/30',
  enterprise: 'bg-warn/10 text-warn border-warn/30',
}

const GLYPH: Record<string, string> = {
  hobby: '○',
  starter: '◆',
  pro: '◆◆',
  enterprise: '★',
}

// Distinct visual identity for complimentary / staff accounts. We deliberately
// pick a tone that doesn't compete with the `pro: bg-ok-muted` so a glance at
// the header makes "Admin" read as "different account class" rather than
// "another pricing tier". Border emphasis matches the brand palette so the
// pill still feels first-class, not like a degraded warning.
const COMPLIMENTARY_TONE = 'bg-brand-subtle text-brand border-brand/40'

export function PlanBadge() {
  const { plan, loading } = useActivePlan()

  if (loading) {
    return (
      <span
        aria-busy="true"
        className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-raised/40 px-2 py-1 text-2xs text-fg-faint"
      >
        <span className="motion-safe:animate-pulse">Plan…</span>
      </span>
    )
  }
  if (!plan) return null

  const usageHint = plan.includedReportsPerMonth != null && plan.usagePct != null
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
        className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-2xs font-medium motion-safe:transition-colors hover:brightness-110 ${COMPLIMENTARY_TONE}`}
      >
        <span aria-hidden="true" className="leading-none">◆</span>
        <span>Admin</span>
        <span
          className="rounded-sm bg-surface-overlay/70 px-1 py-0.5 text-3xs font-mono uppercase tracking-wider text-fg-muted"
          aria-hidden="true"
        >
          {plan.displayName}
        </span>
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
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-2xs font-medium motion-safe:transition-colors hover:brightness-110 ${tone}`}
    >
      <span aria-hidden="true" className="leading-none">{glyph}</span>
      <span>{label}</span>
      {plan.overQuota && (
        <span
          className="ml-0.5 rounded-sm bg-danger/20 px-1 py-0.5 text-3xs font-semibold text-danger"
          aria-label="Over quota"
        >
          !
        </span>
      )}
      {!plan.overQuota && plan.usagePct != null && plan.usagePct >= 80 && (
        <span
          className="ml-0.5 rounded-sm bg-warn/20 px-1 py-0.5 text-3xs font-mono text-warn"
          aria-label={`${plan.usagePct}% used`}
        >
          {plan.usagePct}%
        </span>
      )}
    </Link>
  )
}
