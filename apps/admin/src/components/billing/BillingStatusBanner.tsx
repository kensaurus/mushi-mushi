/**
 * FILE: apps/admin/src/components/billing/BillingStatusBanner.tsx
 * PURPOSE: Plan + usage health — quota, Stripe posture, complimentary accounts.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { BillingStats, BillingTabId } from './types'

interface Props {
  stats: BillingStats
  onManage?: () => void
  onUpgrade?: () => void
  onTab?: (tab: BillingTabId) => void
  plainBanner?: boolean
}

function fmtLimit(used: number, limit: number | null): string {
  if (limit == null) return `${used.toLocaleString()} reports (unlimited)`
  return `${used.toLocaleString()} / ${limit.toLocaleString()} reports`
}

export function BillingStatusBanner({ stats, onManage, onUpgrade, onTab, plainBanner = false }: Props) {
  const copy = usePageCopy('/billing')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'active project'

  if (stats.projectCount === 0) {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Create a project first' : 'No projects yet'}
        subtitle={
          plainBanner
            ? 'Billing is per app — set one up on Projects first.'
            : 'Billing is per-project — create an app first, then usage and invoices appear here.'
        }
        action={
          <Link to="/projects">
            <Btn size="sm" variant="ghost">{actions.projects ?? 'Create project'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.pastDueProjects > 0 || stats.subscriptionStatus === 'past_due') {
    return (
      <StatusBannerShell
        tone="danger"
        title={plainBanner ? 'Payment failed — update your card' : `Payment past due for ${projectLabel}`}
        subtitle="Stripe couldn't charge the card on file — update payment method or ingest may stop."
        action={
          onManage ? (
            <Btn size="sm" variant="ghost" onClick={onManage}>
              {actions.payment ?? 'Update payment'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.overQuota) {
    return (
      <StatusBannerShell
        tone="danger"
        title={plainBanner ? 'Over quota — upgrade to keep ingesting' : 'Over quota — new reports may be rejected'}
        subtitle={`${fmtLimit(stats.reportsUsed, stats.reportsLimit)} this period on ${stats.planDisplayName}. Upgrade to keep ingesting.`}
        action={
          onUpgrade ? (
            <Btn size="sm" variant="ghost" onClick={onUpgrade}>
              {actions.upgrade ?? 'Upgrade plan'}
            </Btn>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('plans')}>
              {actions.plans ?? 'Compare plans'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.approachingQuota) {
    return (
      <StatusBannerShell
        tone="warn"
        title={`Approaching quota — ${stats.usagePct}% used`}
        subtitle={`${fmtLimit(stats.reportsUsed, stats.reportsLimit)} on ${projectLabel}. Headroom is shrinking this period.`}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('plans')}>
              {actions.plans ?? 'View plans'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.cancelAtPeriodEnd) {
    return (
      <StatusBannerShell
        tone="warn"
        title="Subscription cancels at period end"
        subtitle={
          stats.periodEnd ? (
            <>Access continues until <RelativeTime value={stats.periodEnd} /></>
          ) : (
            'Reactivate in Stripe before the period ends to avoid downgrade.'
          )
        }
        action={
          onManage ? (
            <Btn size="sm" variant="ghost" onClick={onManage}>
              {actions.manage ?? 'Manage in Stripe'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.isComplimentary) {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'Admin account — no charges' : 'Admin account — complimentary billing'}
        subtitle={`${stats.planDisplayName} entitlements for ${projectLabel} · no Stripe charges · ${fmtLimit(stats.reportsUsed, stats.reportsLimit)} this period`}
        action={
          <Link to="/cost">
            <Btn size="sm" variant="ghost">{actions.cost ?? 'View LLM cost'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.hasStripeCustomer && !stats.paymentOk) {
    return (
      <StatusBannerShell
        tone="warn"
        title="Payment method needs attention"
        subtitle={`Stripe customer exists for ${projectLabel} but default payment isn't confirmed — open Manage to verify card on file.`}
        action={
          onManage ? (
            <Btn size="sm" variant="ghost" onClick={onManage}>
              {actions.manage ?? 'Open portal'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.reportsUsed === 0 && stats.planId === 'hobby') {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Hobby plan — no usage yet' : 'Hobby plan — no usage this period yet'}
        subtitle={`${stats.freeLimitReports.toLocaleString()} free reports/mo included. Send a test report from Health or wire the SDK widget.`}
        action={
          <Link to="/health">
            <Btn size="sm" variant="ghost">{actions.health ?? 'Run Health test'}</Btn>
          </Link>
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={
        plainBanner
          ? `${stats.planDisplayName} active`
          : `${stats.planDisplayName} active for ${projectLabel}`
      }
      subtitle={
        <>
          {fmtLimit(stats.reportsUsed, stats.reportsLimit)} this period
          {stats.usagePct != null ? ` · ${stats.usagePct}% of quota` : ''}
          {stats.llmCostUsdMonth > 0 ? ` · $${stats.llmCostUsdMonth.toFixed(4)} LLM COGS` : ''}
        </>
      }
      action={
        onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('plans')}>
            {actions.plans ?? 'Compare plans'}
          </Btn>
        ) : null
      }
    />
  )
}
