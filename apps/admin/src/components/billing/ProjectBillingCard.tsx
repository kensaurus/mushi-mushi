/**
 * Per-project billing card — plan badges, usage, predictability, invoices.
 */

import React from 'react'
import {
  Card,
  Btn,
  Badge,
  RelativeTime,
} from '../ui'
import { ContainedBlock, InlineProof, SignalChip } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import { ConfigHelp } from '../ConfigHelp'
import { ResponsiveTable } from '../ResponsiveTable'
import { PlanBenefitsList } from './PlanBenefitsList'
import { BillingPredictabilityControls } from './BillingPredictabilityControls'
import { BillingUsageBar } from './BillingUsageBar'
import { usePageData } from '../../lib/usePageData'
import type { BillingProject, Invoice, PlanCatalog } from './types'
import { BILLING_STATUS_TONE as STATUS_TONE, BILLING_TIER_TONE as TIER_TONE, formatBillingMoney as formatMoney } from './billing-tokens'

export interface ProjectBillingCardProps {
  project: BillingProject
  plans: PlanCatalog[]
  actioning: string | null
  pickerOpen: boolean
  onTogglePicker: () => void
  onPickPlan: (planId: string, billingInterval: 'monthly' | 'annual') => void
  onManage: () => void
  onReload?: () => void
}

export function ProjectBillingCard({
  project,
  plans,
  actioning,
  pickerOpen,
  onTogglePicker,
  onPickPlan,
  onManage,
  onReload,
}: ProjectBillingCardProps) {
  const subscribed = !!project.subscription && ['active', 'trialing', 'past_due'].includes(project.subscription.status ?? '')
  const tier = project.tier
  const tierId = tier?.id ?? 'hobby'
  const planLabel = tier?.display_name
    ?? (subscribed ? `Plan ${project.subscription?.plan_id ?? '—'}` : 'Hobby (free)')
  const statusLabel = subscribed ? (project.subscription?.status ?? 'active') : 'free'
  // Org-level posture: complimentary orgs (Mushi staff / sponsored / beta) have
  // a synthesised subscription server-side and intentionally no Stripe customer.
  // Hide every Stripe-touching affordance for them — no checkout, no portal,
  // no invoices section noise — and replace with a clear "Complimentary" badge.
  const isComplimentary = project.billing_mode === 'complimentary'
  // Use the API-provided usage_pct when available; we DON'T clamp here so the
  // UsageBar can show the true overage % (e.g. "120% used") in the chip.
  // Bar fill clamping is the bar component's responsibility.
  // Phase 2: prefer diagnoses_usage_pct when the plan has a diagnoses limit.
  const apiPct = project.limit_diagnoses != null
    ? (project.diagnoses_usage_pct ?? null)
    : (project.usage_pct ?? null)
  const usagePct = apiPct != null
    ? apiPct
    : project.limit_reports
      ? Math.round((project.usage.reports / project.limit_reports) * 100)
      : null

  const overageRate = tier?.overage_unit_amount_decimal
  const purchasable = plans.filter((p: PlanCatalog) => p.is_self_serve && p.id !== 'hobby' && p.id !== tierId)

  return (
    <Card className="p-3 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">{project.project_name}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            {isComplimentary ? (
              <>
                {/* Complimentary orgs lead with the *account class* (Admin),
                    not the entitlement tier. Showing "Pro $99/mo" on a comp
                    account misrepresents the relationship and was the user's
                    direct complaint ("still being shown as Pro instead of
                    Admin"). The tier sits next to it as a secondary fact so
                    the user still knows which feature set they have. */}
                <Badge
                  className="bg-brand-subtle text-brand border border-brand/40 font-semibold"
                  title={`Admin account — billed by Mushi Mushi at no cost. Feature set tracks the ${planLabel} tier (${tier?.included_reports_per_month?.toLocaleString() ?? '∞'} reports/mo, ${tier?.retention_days ?? 0}-day retention).`}
                >
                  <span aria-hidden="true" className="mr-1 leading-none">◆</span>
                  Admin
                </Badge>
                <InlineProof className="inline-flex flex-wrap items-center gap-1 border-0 bg-transparent px-0 py-0">
                  <SignalChip tone="neutral" className="font-mono uppercase tracking-wider">
                    tier
                  </SignalChip>
                  <span className="font-medium text-fg-secondary">{planLabel}</span>
                  <SignalChip tone="neutral">entitlements</SignalChip>
                </InlineProof>
                <Badge
                  className="bg-surface-overlay text-fg-muted border border-edge-subtle"
                  title="No Stripe customer or invoice exists for this org. Entitlements are honoured at the platform level."
                >
                  No charges
                </Badge>
              </>
            ) : (
              <>
                <Badge className={TIER_TONE[tierId] ?? 'bg-surface-overlay text-fg-muted'}>
                  {planLabel}
                  {tier && tier.monthly_price_usd > 0 && (
                    <span className="ml-1 opacity-70">${tier.monthly_price_usd}/mo</span>
                  )}
                </Badge>
                {subscribed && (
                  <Badge className={STATUS_TONE[statusLabel] ?? 'bg-surface-overlay text-fg-muted'}>
                    {statusLabel}
                  </Badge>
                )}
              </>
            )}
            {project.subscription?.cancel_at_period_end && (
              <Badge tone="warnSubtle">
                Cancels at period end
              </Badge>
            )}
            {/* The quota severity badge used to live here. Moved into UsageBar
                so the chip and the bar are co-located — fixes the dup-datum
                fold issue and gives the severity signal a proper home next to
                the number it grades. */}
            {overageRate != null && !isComplimentary && (
              <SignalChip tone="warn" className="font-mono">
                Overage ${Number(overageRate).toFixed(4)} / report
              </SignalChip>
            )}
          </div>
          {project.subscription?.current_period_end && (
            <InlineProof className="mt-1 border-0 bg-transparent px-0 py-0">
              Period ends <RelativeTime value={project.subscription.current_period_end} />
            </InlineProof>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {purchasable.length > 0 && !isComplimentary && (
            <Btn
              onClick={onTogglePicker}
              disabled={actioning?.startsWith(`checkout:${project.project_id}`) ?? false}
            >
              {pickerOpen ? 'Hide plans' : subscribed ? 'Change plan' : 'Upgrade'}
            </Btn>
          )}
          {project.customer?.stripe_customer_id && !isComplimentary && (
            <Btn
              variant="ghost"
              onClick={onManage}
              disabled={actioning === `portal:${project.project_id}`}
              loading={actioning === `portal:${project.project_id}`}
            >
              Manage
            </Btn>
          )}
          <ConfigHelp helpId="billing.plan" />
        </div>
      </header>

      {pickerOpen && (
        <PlanPicker
          plans={purchasable}
          currentPlanId={tierId}
          busy={actioning?.startsWith(`checkout:${project.project_id}`) ?? false}
          onPick={onPickPlan}
        />
      )}

      <BillingUsageBar
        usage={project.usage}
        limitReports={project.limit_reports}
        pct={usagePct}
        periodStart={project.period_start}
        periodEnd={project.subscription?.current_period_end ?? null}
        llmCostUsd={project.llm_cost_usd_this_month}
        overQuota={project.over_diagnosis_quota ?? project.over_quota}
        overageRate={overageRate ?? null}
        overageRateDiagnoses={tier?.overage_unit_amount_decimal_diagnoses ?? null}
        basePriceUsd={tier?.monthly_price_usd ?? 0}
        spendCapUsd={project.spend_cap_usd ?? tier?.monthly_spend_cap_usd ?? null}
        tierId={tierId}
        usageSeries={project.usage_series}
        diagnosesUsed={project.diagnoses_used ?? null}
        diagnosesLimit={project.limit_diagnoses ?? null}
      />

      {!isComplimentary && (
        <BillingPredictabilityControls
          projectId={project.project_id}
          isSubscribed={subscribed}
          spendCapUsd={project.spend_cap_usd ?? null}
          planDefaultCapUsd={tier?.monthly_spend_cap_usd ?? null}
          alertEmail={project.alert_email ?? null}
          onSaved={onReload}
        />
      )}

      {tier && (
        <PlanBenefitsList
          planId={tier.id}
          planName={tier.display_name}
          flags={tier.feature_flags as Parameters<typeof PlanBenefitsList>[0]['flags']}
          retentionDays={tier.retention_days}
          seatLimit={(tier as { seat_limit?: number | null }).seat_limit ?? null}
        />
      )}

      <InvoicesSection
        projectId={project.project_id}
        hasCustomer={!!project.customer?.stripe_customer_id}
        isComplimentary={isComplimentary}
      />
    </Card>
  )
}
interface PlanPickerProps {
  plans: PlanCatalog[]
  currentPlanId: string
  busy: boolean
  onPick: (planId: string, billingInterval: 'monthly' | 'annual') => void
}

function PlanPicker({ plans, currentPlanId, busy, onPick }: PlanPickerProps) {
  const [billingInterval, setBillingInterval] = React.useState<'monthly' | 'annual'>('monthly')
  const annualDiscountPct = 17 // ~2 months free

  return (
    <ContainedBlock tone="muted" className="p-3 space-y-2">
      <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
        <SignalChip tone="neutral" className="uppercase tracking-wider">
          {currentPlanId === 'hobby' || currentPlanId === 'free_cloud' ? 'Pick a plan' : 'Switch to'}
        </SignalChip>
        {/* Billing interval toggle */}
        <div className="flex items-center gap-1 rounded-md border border-edge-subtle bg-surface p-0.5 text-2xs">
          <button
            type="button"
            onClick={() => setBillingInterval('monthly')}
            className={`px-2 py-0.5 rounded transition-colors ${billingInterval === 'monthly' ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg'}`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBillingInterval('annual')}
            className={`px-2 py-0.5 rounded transition-colors ${billingInterval === 'annual' ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg'}`}
          >
            Annual <span className="text-ok font-medium">−{annualDiscountPct}%</span>
          </button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {plans.map((p) => {
          const monthlyPrice = p.monthly_price_usd
          const annualMonthlyPrice = billingInterval === 'annual'
            ? Math.round(monthlyPrice * (1 - annualDiscountPct / 100))
            : null

          return (
            <article key={p.id} className="rounded-md border border-edge-subtle p-3 bg-surface">
              <header className="flex items-baseline justify-between gap-2">
                <h5 className="text-sm font-semibold text-fg">{p.display_name}</h5>
                <span className="text-sm font-mono text-fg-secondary">
                  {billingInterval === 'annual' && annualMonthlyPrice != null
                    ? <>${annualMonthlyPrice}/mo</>
                    : <>${monthlyPrice}/mo</>}
                </span>
              </header>
              {billingInterval === 'annual' && (
                <p className="text-2xs text-fg-muted mt-0.5">
                  Billed ${(annualMonthlyPrice ?? 0) * 12}/yr · {annualDiscountPct}% off
                </p>
              )}
              <ContainedBlock tone="neutral" className="mt-1 space-y-1">
                <InlineProof className="border-0 bg-transparent px-0 py-0">
                  {p.included_reports_per_month?.toLocaleString() ?? '∞'} reports/mo included
                  {billingInterval === 'monthly' && p.overage_unit_amount_decimal != null && (
                    <> · ${Number(p.overage_unit_amount_decimal).toFixed(4)}/report after</>
                  )}
                </InlineProof>
                <div className="flex flex-wrap gap-1">
                  <SignalChip tone="neutral">{p.retention_days}-day retention</SignalChip>
                  {p.feature_flags.sso ? <SignalChip tone="brand">SSO</SignalChip> : null}
                  {p.feature_flags.byok ? <SignalChip tone="brand">BYOK</SignalChip> : null}
                  {p.feature_flags.intelligence_reports ? (
                    <SignalChip tone="brand">Intelligence</SignalChip>
                  ) : null}
                </div>
              </ContainedBlock>
              <Btn
                size="sm"
                className="mt-2 w-full"
                onClick={() => onPick(p.id, billingInterval)}
                disabled={busy}
                loading={busy}
              >
                {`Select ${p.display_name}`}
              </Btn>
            </article>
          )
        })}
      </div>
      <InlineProof className="mt-2 border-0 bg-transparent px-0 py-0">
        Need an air-gapped install, custom DPA, or &gt; 500k reports/mo?{' '}
        <a href="mailto:kensaurus@gmail.com" className="text-accent-foreground hover:text-accent">
          Email sales
        </a>{' '}
        for Enterprise.
      </InlineProof>
    </ContainedBlock>
  )
}

interface InvoicesSectionProps {
  projectId: string
  hasCustomer: boolean
  /** Org is on a complimentary plan — Stripe is bypassed, so no invoices ever issue. */
  isComplimentary?: boolean
}

function InvoicesSection({ projectId, hasCustomer, isComplimentary }: InvoicesSectionProps) {
  const invoicesQuery = usePageData<{ invoices: Invoice[]; note?: string; billing_mode?: string }>(
    hasCustomer && !isComplimentary
      ? `/v1/admin/billing/invoices?project_id=${encodeURIComponent(projectId)}`
      : null,
  )

  if (isComplimentary) {
    return (
      <EmptySectionMessage
        text="Complimentary account — no Stripe invoices are issued for this organization."
      />
    )
  }

  if (!hasCustomer) {
    return (
      <EmptySectionMessage
        text="Invoices appear here after the first Stripe Checkout completes."
        hint="Upgrade from the overview tab to start a subscription."
      />
    )
  }

  if (invoicesQuery.loading) {
    return (
      <div className="border-t border-edge-subtle pt-2">
        <EmptySectionMessage text="Loading invoices…" />
      </div>
    )
  }

  if (invoicesQuery.error) {
    return (
      <div className="border-t border-edge-subtle pt-2 flex items-center justify-between gap-2">
        <p className="text-2xs text-danger">
          Could not load invoices: {invoicesQuery.error}
        </p>
        <button
          type="button"
          onClick={invoicesQuery.reload}
          className="rounded-sm border border-danger/40 bg-danger/10 px-2 py-0.5 text-2xs text-danger hover:bg-danger/15 motion-safe:transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  const invoices = invoicesQuery.data?.invoices ?? []
  if (invoices.length === 0) {
    return (
      <div className="border-t border-edge-subtle pt-2">
        <EmptySectionMessage
          text="No invoices yet."
          hint="Stripe issues the first one at the end of the billing period."
        />
      </div>
    )
  }

  return (
    <section className="border-t border-edge-subtle pt-2">
      <SignalChip tone="neutral" className="mb-1.5 uppercase tracking-wider">
        Recent invoices
      </SignalChip>
      <ResponsiveTable ariaLabel="Recent invoices">
      <table className="w-full text-2xs">
        <thead className="text-fg-faint">
          <tr>
            <th scope="col" className="text-left font-medium pb-1">Number</th>
            <th scope="col" className="text-left font-medium pb-1">Period</th>
            <th scope="col" className="text-right font-medium pb-1">Amount</th>
            <th scope="col" className="text-left font-medium pb-1 pl-2">Status</th>
            <th scope="col" className="text-right font-medium pb-1">Links</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-t border-edge-subtle">
              <td className="py-1 font-mono text-fg-secondary">{inv.number ?? inv.id.slice(0, 12)}</td>
              <td className="py-1 text-fg-muted">
                {new Date(inv.period_start * 1000).toLocaleDateString()} → {new Date(inv.period_end * 1000).toLocaleDateString()}
              </td>
              <td className="py-1 text-right font-mono text-fg">
                {formatMoney(inv.amount_paid > 0 ? inv.amount_paid : inv.amount_due, inv.currency)}
              </td>
              <td className="py-1 pl-2">
                <Badge className={STATUS_TONE[inv.status] ?? 'bg-surface-overlay text-fg-muted'}>
                  {inv.status}
                </Badge>
              </td>
              <td className="py-1 text-right space-x-2">
                {inv.hosted_invoice_url && (
                  <a
                    href={inv.hosted_invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-foreground hover:text-accent"
                  >
                    View
                  </a>
                )}
                {inv.invoice_pdf && (
                  <a
                    href={inv.invoice_pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-foreground hover:text-accent"
                  >
                    PDF
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </ResponsiveTable>
    </section>
  )
}
