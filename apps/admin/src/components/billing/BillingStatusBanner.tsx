/**
 * FILE: apps/admin/src/components/billing/BillingStatusBanner.tsx
 * PURPOSE: Plan + usage health — quota, Stripe posture, complimentary accounts.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { BillingStats, BillingTabId } from './types'

interface Props {
  stats: BillingStats
  onManage?: () => void
  onUpgrade?: () => void
  onTab?: (tab: BillingTabId) => void
}

function fmtLimit(used: number, limit: number | null): string {
  if (limit == null) return `${used.toLocaleString()} reports (unlimited)`
  return `${used.toLocaleString()} / ${limit.toLocaleString()} reports`
}

export function BillingStatusBanner({ stats, onManage, onUpgrade, onTab }: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (stats.projectCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No projects yet</p>
            <p className="text-2xs text-fg-muted">
              Billing is per-project — create an app first, then usage and invoices appear here.
            </p>
          </div>
        </div>
        <Link to="/projects">
          <Btn size="sm" variant="ghost">Create project</Btn>
        </Link>
      </div>
    )
  }

  if (stats.pastDueProjects > 0 || stats.subscriptionStatus === 'past_due') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">Payment past due for {projectLabel}</p>
            <p className="text-2xs text-fg-muted">
              Stripe couldn&apos;t charge the card on file — update payment method or ingest may stop.
            </p>
          </div>
        </div>
        {onManage ? (
          <Btn size="sm" variant="ghost" onClick={onManage}>
            Update payment
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.overQuota) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">Over quota — new reports may be rejected</p>
            <p className="text-2xs text-fg-muted">
              {fmtLimit(stats.reportsUsed, stats.reportsLimit)} this period on {stats.planDisplayName}. Upgrade to keep ingesting.
            </p>
          </div>
        </div>
        {onUpgrade ? (
          <Btn size="sm" variant="ghost" onClick={onUpgrade}>
            Upgrade plan
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('plans')}>
            Compare plans
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.approachingQuota) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              Approaching quota — {stats.usagePct}% used
            </p>
            <p className="text-2xs text-fg-muted">
              {fmtLimit(stats.reportsUsed, stats.reportsLimit)} on {projectLabel}. Headroom is shrinking this period.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('plans')}>
            View plans
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.cancelAtPeriodEnd) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Subscription cancels at period end</p>
            <p className="text-2xs text-fg-muted">
              {stats.periodEnd ? (
                <>Access continues until <RelativeTime value={stats.periodEnd} /></>
              ) : (
                'Reactivate in Stripe before the period ends to avoid downgrade.'
              )}
            </p>
          </div>
        </div>
        {onManage ? (
          <Btn size="sm" variant="ghost" onClick={onManage}>
            Manage in Stripe
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.isComplimentary) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">Admin account — complimentary billing</p>
            <p className="text-2xs text-fg-muted">
              {stats.planDisplayName} entitlements for {projectLabel} · no Stripe charges · {fmtLimit(stats.reportsUsed, stats.reportsLimit)} this period
            </p>
          </div>
        </div>
        <Link to="/cost">
          <Btn size="sm" variant="ghost">View LLM cost</Btn>
        </Link>
      </div>
    )
  }

  if (stats.hasStripeCustomer && !stats.paymentOk) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Payment method needs attention</p>
            <p className="text-2xs text-fg-muted">
              Stripe customer exists for {projectLabel} but default payment isn&apos;t confirmed — open Manage to verify card on file.
            </p>
          </div>
        </div>
        {onManage ? (
          <Btn size="sm" variant="ghost" onClick={onManage}>
            Open portal
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.reportsUsed === 0 && stats.planId === 'hobby') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Hobby plan — no usage this period yet</p>
            <p className="text-2xs text-fg-muted">
              {stats.freeLimitReports.toLocaleString()} free reports/mo included. Send a test report from Health or wire the SDK widget.
            </p>
          </div>
        </div>
        <Link to="/health">
          <Btn size="sm" variant="ghost">Run Health test</Btn>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {stats.planDisplayName} active for {projectLabel}
          </p>
          <p className="text-2xs text-fg-muted">
            {fmtLimit(stats.reportsUsed, stats.reportsLimit)} this period
            {stats.usagePct != null ? ` · ${stats.usagePct}% of quota` : ''}
            {stats.llmCostUsdMonth > 0 ? ` · $${stats.llmCostUsdMonth.toFixed(4)} LLM COGS` : ''}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('plans')}>
          Compare plans
        </Btn>
      ) : null}
    </div>
  )
}
