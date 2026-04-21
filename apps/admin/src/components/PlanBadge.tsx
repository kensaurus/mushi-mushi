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

  const tone = TONE[plan.planId] ?? TONE.hobby
  const glyph = GLYPH[plan.planId] ?? GLYPH.hobby
  const label = plan.displayName
  const usageHint = plan.includedReportsPerMonth != null && plan.usagePct != null
    ? `${plan.usagePct}% of ${plan.includedReportsPerMonth.toLocaleString()} reports used`
    : plan.includedReportsPerMonth == null
      ? 'Unlimited reports'
      : null
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
