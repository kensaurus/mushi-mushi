/**
 * FILE: apps/admin/src/pages/BillingPage.tsx
 * PURPOSE: v4.2 — first-class billing surface for the Mushi Cloud
 *          product. Replaces the old "go to Stripe and squint" workflow
 *          with a real plan + usage + invoices view per project.
 *
 *          Each project card shows:
 *            - Current plan (free / metered) with status pill
 *            - This-month usage bar against free quota or unlimited
 *            - Upgrade CTA → Stripe Checkout (subscription mode)
 *            - Manage CTA → Stripe Billing Portal (card / cancel / invoices)
 *            - Recent invoices with hosted links + PDF downloads
 *
 *          Reads /v1/admin/billing (aggregate across owned projects) and
 *          /v1/admin/billing/invoices?project_id=… per project.
 *          Mutates via /billing/checkout and /billing/portal which return
 *          Stripe-hosted URLs we redirect to.
 */

import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import { formatLlmCost } from '../lib/format'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  Badge,
  ErrorAlert,
  EmptyState,
  RelativeTime,
  Input,
  Textarea,
  SelectField,
} from '../components/ui'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { PlanComparisonTable } from '../components/billing/PlanComparisonTable'
import { PlanBenefitsList } from '../components/billing/PlanBenefitsList'

interface PlanCatalog {
  id: 'hobby' | 'starter' | 'pro' | 'enterprise' | string
  display_name: string
  position: number
  monthly_price_usd: number
  base_price_lookup_key: string | null
  overage_price_lookup_key: string | null
  included_reports_per_month: number | null
  overage_unit_amount_decimal: number | null
  retention_days: number
  seat_limit: number | null
  is_self_serve: boolean
  active: boolean
  feature_flags: Record<string, unknown>
}

interface ProjectTier {
  id: string
  display_name: string
  monthly_price_usd: number
  included_reports_per_month: number | null
  overage_unit_amount_decimal: number | null
  retention_days: number
  feature_flags: Record<string, unknown>
}

interface BillingProject {
  project_id: string
  project_name: string
  plan: string
  tier?: ProjectTier
  subscription: {
    status?: string
    plan_id?: string | null
    stripe_price_id?: string
    current_period_start?: string
    current_period_end?: string
    cancel_at_period_end?: boolean
  } | null
  customer: {
    stripe_customer_id?: string
    default_payment_ok?: boolean
    email?: string | null
  } | null
  period_start: string
  usage: {
    reports: number
    fixes: number
    fixesSucceeded?: number
    tokens: number
  }
  /**
   * §2: real LLM dollars spent this billing month, summed server-side
   * from llm_invocations.cost_usd. Always present (0 when no calls). Lets the
   * Billing page show "what is this project actually costing me?" alongside
   * report quota usage.
   */
  llm_cost_usd_this_month?: number
  limit_reports: number | null
  over_quota: boolean
  usage_pct?: number | null
}

interface BillingResponse {
  projects: BillingProject[]
  plans?: PlanCatalog[]
  free_limit_reports_per_month: number
}

interface Invoice {
  id: string
  number: string | null
  status: string
  amount_due: number
  amount_paid: number
  currency: string
  created: number
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  period_start: number
  period_end: number
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-ok-muted text-ok',
  trialing: 'bg-brand-subtle text-brand',
  past_due: 'bg-warn/10 text-warn',
  canceled: 'bg-surface-overlay text-fg-muted',
  unpaid: 'bg-danger-subtle text-danger',
  free: 'bg-surface-overlay text-fg-muted',
}

// Visual tier badges. Falls back to a neutral pill for unknown plan ids.
const TIER_TONE: Record<string, string> = {
  hobby: 'bg-surface-overlay text-fg-muted',
  starter: 'bg-brand-subtle text-brand',
  pro: 'bg-ok-muted text-ok',
  enterprise: 'bg-warn/10 text-warn border border-warn/30',
}

const formatMoney = (amountMinor: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountMinor / 100)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

export function BillingPage() {
  const toast = useToast()
  const { user } = useAuth()
  const activeProjectId = useActiveProjectId()
  const billingQuery = usePageData<BillingResponse>('/v1/admin/billing')
  const billing = billingQuery.data
  const projects = billing?.projects ?? []
  const activeProject = useMemo(
    () => projects.find(p => p.project_id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  )
  const activeTierId = activeProject?.tier?.id ?? 'hobby'

  const [actioning, setActioning] = useState<string | null>(null)
  // Project ID whose plan picker is open. null = no picker open.
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  const startCheckout = useCallback(async (projectId: string, planId: string) => {
    if (!user?.email) {
      toast.error('Email required', 'Sign in with an email-backed account before subscribing.')
      return
    }
    setActioning(`checkout:${projectId}`)
    const res = await apiFetch<{ url: string }>('/v1/admin/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, email: user.email, plan_id: planId }),
    })
    setActioning(null)
    if (!res.ok || !res.data?.url) {
      const code = res.error?.code
      if (code === 'STRIPE_NOT_CONFIGURED') {
        toast.error('Stripe not configured', 'Set STRIPE_SECRET_KEY on the API function.')
      } else if (code === 'PLAN_NOT_CONFIGURED') {
        toast.error('Plan not configured', res.error?.message ?? 'Run scripts/stripe-bootstrap.mjs.')
      } else {
        toast.error('Checkout failed', res.error?.message)
      }
      return
    }
    window.location.href = res.data.url
  }, [user?.email, toast])

  const openPortal = useCallback(async (projectId: string) => {
    setActioning(`portal:${projectId}`)
    const res = await apiFetch<{ url: string }>('/v1/admin/billing/portal', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId }),
    })
    setActioning(null)
    if (!res.ok || !res.data?.url) {
      toast.error('Could not open billing portal', res.error?.message)
      return
    }
    window.open(res.data.url, '_blank', 'noopener,noreferrer')
  }, [toast])

  if (billingQuery.loading) return <PanelSkeleton rows={5} label="Loading billing" />
  if (billingQuery.error) {
    return <ErrorAlert message={`Failed to load billing: ${billingQuery.error}`} onRetry={billingQuery.reload} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Billing"
        description="Plan, usage, invoices, and quota \u2014 everything you need to keep the loop running on your terms."
      >
        <span className="text-2xs text-fg-faint font-mono">
          Free quota: {billing?.free_limit_reports_per_month?.toLocaleString() ?? '—'} reports / mo
        </span>
      </PageHeader>

      <PageHelp
        title="About Billing"
        whatIsIt="Per-project subscription + usage view. The free tier gives every project a monthly quota of report ingests; subscriptions unlock unlimited reports + usage-based pricing on Stripe Meter Events."
        useCases={[
          'Upgrade to Cloud Starter when you hit the free quota and reports are being rejected with HTTP 402',
          'Open the Stripe Billing Portal to update your card, download invoices, or cancel',
          'Cross-check usage between Mushi (reports/fixes/tokens) and Stripe (line items)',
        ]}
        howToUse="Each project bills independently. Click Upgrade to start a Stripe Checkout session, or Manage to jump into the customer portal. Recent invoices appear inline once Stripe sends the first one."
      />

      {(billing?.plans?.length ?? 0) > 0 && (
        <PlanComparisonTable
          plans={billing!.plans!}
          currentPlanId={activeTierId}
        />
      )}

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create a project from the Projects page to start tracking usage and billing."
        />
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <ProjectBillingCard
              key={p.project_id}
              project={p}
              plans={billing?.plans ?? []}
              actioning={actioning}
              pickerOpen={pickerFor === p.project_id}
              onTogglePicker={() => setPickerFor(pickerFor === p.project_id ? null : p.project_id)}
              onPickPlan={(planId) => {
                setPickerFor(null)
                void startCheckout(p.project_id, planId)
              }}
              onManage={() => openPortal(p.project_id)}
            />
          ))}
        </div>
      )}

      <SupportSection projects={projects} />
    </div>
  )
}

interface CardProps {
  project: BillingProject
  plans: PlanCatalog[]
  actioning: string | null
  pickerOpen: boolean
  onTogglePicker: () => void
  onPickPlan: (planId: string) => void
  onManage: () => void
}

function ProjectBillingCard({
  project,
  plans,
  actioning,
  pickerOpen,
  onTogglePicker,
  onPickPlan,
  onManage,
}: CardProps) {
  const subscribed = !!project.subscription && ['active', 'trialing', 'past_due'].includes(project.subscription.status ?? '')
  const tier = project.tier
  const tierId = tier?.id ?? 'hobby'
  const planLabel = tier?.display_name
    ?? (subscribed ? `Plan ${project.subscription?.plan_id ?? '—'}` : 'Hobby (free)')
  const statusLabel = subscribed ? (project.subscription?.status ?? 'active') : 'free'
  // Use the API-provided usage_pct when available; clamp client-side too.
  const apiPct = project.usage_pct ?? null
  const usagePct = apiPct != null
    ? Math.min(100, apiPct)
    : project.limit_reports
      ? Math.min(100, Math.round((project.usage.reports / project.limit_reports) * 100))
      : null

  const overageRate = tier?.overage_unit_amount_decimal
  const purchasable = plans.filter((p) => p.is_self_serve && p.id !== 'hobby' && p.id !== tierId)

  return (
    <Card className="p-3 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">{project.project_name}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
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
            {project.subscription?.cancel_at_period_end && (
              <Badge className="bg-warn/10 text-warn border border-warn/30">
                Cancels at period end
              </Badge>
            )}
            {project.over_quota && (
              <Badge className="bg-danger-subtle text-danger">
                Over quota — new reports rejected
              </Badge>
            )}
            {overageRate != null && (
              <span className="text-2xs text-fg-faint">
                Overage ${Number(overageRate).toFixed(4)} / report
              </span>
            )}
          </div>
          {project.subscription?.current_period_end && (
            <p className="text-2xs text-fg-faint mt-1">
              Period ends <RelativeTime value={project.subscription.current_period_end} />
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {purchasable.length > 0 && (
            <Btn
              onClick={onTogglePicker}
              disabled={actioning?.startsWith(`checkout:${project.project_id}`) ?? false}
            >
              {pickerOpen ? 'Hide plans' : subscribed ? 'Change plan' : 'Upgrade'}
            </Btn>
          )}
          {project.customer?.stripe_customer_id && (
            <Btn
              variant="ghost"
              onClick={onManage}
              disabled={actioning === `portal:${project.project_id}`}
              loading={actioning === `portal:${project.project_id}`}
            >
              Manage
            </Btn>
          )}
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

      <UsageBar
        usage={project.usage}
        limitReports={project.limit_reports}
        pct={usagePct}
        periodStart={project.period_start}
        llmCostUsd={project.llm_cost_usd_this_month}
      />

      {tier && (
        <PlanBenefitsList
          planId={tier.id}
          planName={tier.display_name}
          flags={tier.feature_flags as Parameters<typeof PlanBenefitsList>[0]['flags']}
          retentionDays={tier.retention_days}
          seatLimit={(tier as { seat_limit?: number | null }).seat_limit ?? null}
        />
      )}

      <InvoicesSection projectId={project.project_id} hasCustomer={!!project.customer?.stripe_customer_id} />
    </Card>
  )
}

interface PlanPickerProps {
  plans: PlanCatalog[]
  currentPlanId: string
  busy: boolean
  onPick: (planId: string) => void
}

function PlanPicker({ plans, currentPlanId, busy, onPick }: PlanPickerProps) {
  return (
    <section className="border border-edge-subtle rounded-md p-3 bg-surface-subtle">
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-2xs uppercase tracking-wider text-fg-faint">
          {currentPlanId === 'hobby' ? 'Pick a plan' : 'Switch to'}
        </h4>
        <span className="text-2xs text-fg-faint">Billed monthly · cancel any time</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {plans.map((p) => (
          <article key={p.id} className="rounded-md border border-edge-subtle p-3 bg-surface">
            <header className="flex items-baseline justify-between gap-2">
              <h5 className="text-sm font-semibold text-fg">{p.display_name}</h5>
              <span className="text-sm font-mono text-fg-secondary">
                ${p.monthly_price_usd}/mo
              </span>
            </header>
            <p className="text-2xs text-fg-muted mt-1">
              {p.included_reports_per_month?.toLocaleString() ?? '∞'} reports/mo included
              {p.overage_unit_amount_decimal != null && (
                <> · ${Number(p.overage_unit_amount_decimal).toFixed(4)}/report after</>
              )}
            </p>
            <p className="text-2xs text-fg-faint mt-0.5">
              {p.retention_days}-day retention
              {p.feature_flags.sso ? ' · SSO' : ''}
              {p.feature_flags.byok ? ' · BYOK' : ''}
              {p.feature_flags.intelligence_reports ? ' · Intelligence reports' : ''}
            </p>
            <Btn
              size="sm"
              className="mt-2 w-full"
              onClick={() => onPick(p.id)}
              disabled={busy}
              loading={busy}
            >
              {`Select ${p.display_name}`}
            </Btn>
          </article>
        ))}
      </div>
      <p className="text-2xs text-fg-faint mt-2">
        Need an air-gapped install, custom DPA, or &gt; 500k reports/mo?{' '}
        <a href="mailto:hello@mushimushi.dev" className="text-brand hover:text-brand-hover">
          Email sales
        </a>{' '}
        for Enterprise.
      </p>
    </section>
  )
}

interface UsageBarProps {
  usage: BillingProject['usage']
  limitReports: number | null
  pct: number | null
  periodStart: string | null
  /** §3: real $ spent on LLM calls this billing month. */
  llmCostUsd?: number
}

interface UsageForecast {
  etaDays: number
  etaDate: Date
  tone: 'danger' | 'warn' | 'muted'
  label: string
}

/**
 * Project the day the project will hit its quota at the current ingest rate.
 * Returns null when there's not enough signal — first 24h of the period, no
 * limit, already over-quota, or the project is on a totally idle day.
 */
function buildUsageForecast(
  used: number,
  limit: number | null,
  periodStart: string | null,
): UsageForecast | null {
  if (limit == null || used <= 0) return null
  if (used >= limit) return null
  if (!periodStart) return null
  const startMs = new Date(periodStart).getTime()
  if (Number.isNaN(startMs)) return null
  const daysElapsed = (Date.now() - startMs) / 86_400_000
  if (daysElapsed < 1) return null
  const dailyRate = used / daysElapsed
  if (dailyRate <= 0) return null
  const etaDays = Math.max(0, Math.ceil((limit - used) / dailyRate))
  const etaDate = new Date(Date.now() + etaDays * 86_400_000)
  const tone: UsageForecast['tone'] = etaDays < 3 ? 'danger' : etaDays < 7 ? 'warn' : 'muted'
  const dateStr = etaDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const label = etaDays === 0
    ? `At current rate, you'll hit your limit today`
    : `At current rate, you'll hit your limit on ${dateStr} (${etaDays}d away)`
  return { etaDays, etaDate, tone, label }
}

const FORECAST_TONE: Record<UsageForecast['tone'], string> = {
  danger: 'bg-danger-subtle text-danger',
  warn: 'bg-warn/10 text-warn',
  muted: 'text-fg-faint',
}

function UsageBar({ usage, limitReports, pct, periodStart, llmCostUsd }: UsageBarProps) {
  const barColor = pct == null
    ? 'bg-brand'
    : pct >= 100
      ? 'bg-danger'
      : pct >= 80
        ? 'bg-warn'
        : 'bg-ok'
  const forecast = buildUsageForecast(usage.reports, limitReports, periodStart)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-2xs text-fg-muted gap-2 flex-wrap">
        <span>
          Reports this period: <span className="font-mono text-fg">{usage.reports.toLocaleString()}</span>
          {limitReports != null && (
            <> <span className="text-fg-faint">/ {limitReports.toLocaleString()}</span></>
          )}
          {limitReports == null && <> <span className="text-fg-faint">(unlimited)</span></>}
        </span>
        <span className="text-fg-faint flex items-center gap-2 flex-wrap">
          <span>
            Fixes <span className="font-mono text-fg-secondary">{usage.fixes.toLocaleString()}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Classifier tokens <span className="font-mono text-fg-secondary">{usage.tokens.toLocaleString()}</span>
          </span>
          {llmCostUsd != null && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className="font-mono text-fg-secondary"
                title="Real $ spent on LLM calls this billing month, from llm_invocations.cost_usd"
              >
                LLM <span className="text-fg">{formatLlmCost(llmCostUsd)}</span>
              </span>
            </>
          )}
        </span>
      </div>
      {limitReports != null && (
        <div className="h-1.5 bg-surface-overlay rounded-sm overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
          <div className={`h-full ${barColor}`} style={{ width: `${Math.max(2, pct ?? 0)}%` }} />
        </div>
      )}
      {forecast && (
        <p className={`text-2xs px-1.5 py-0.5 rounded-sm inline-block font-mono ${FORECAST_TONE[forecast.tone]}`}>
          {forecast.label}
        </p>
      )}
    </div>
  )
}

interface InvoicesSectionProps {
  projectId: string
  hasCustomer: boolean
}

function InvoicesSection({ projectId, hasCustomer }: InvoicesSectionProps) {
  const invoicesQuery = usePageData<{ invoices: Invoice[] }>(
    hasCustomer ? `/v1/admin/billing/invoices?project_id=${encodeURIComponent(projectId)}` : null,
  )

  if (!hasCustomer) {
    return (
      <p className="text-2xs text-fg-faint border-t border-edge-subtle pt-2">
        Invoices appear here after the first Stripe Checkout completes.
      </p>
    )
  }

  if (invoicesQuery.loading) {
    return <p className="text-2xs text-fg-faint border-t border-edge-subtle pt-2">Loading invoices…</p>
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
      <p className="text-2xs text-fg-faint border-t border-edge-subtle pt-2">
        No invoices yet. Stripe issues the first one at the end of the billing period.
      </p>
    )
  }

  return (
    <section className="border-t border-edge-subtle pt-2">
      <h4 className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">Recent invoices</h4>
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
                    className="text-brand hover:text-brand-hover"
                  >
                    View
                  </a>
                )}
                {inv.invoice_pdf && (
                  <a
                    href={inv.invoice_pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:text-brand-hover"
                  >
                    PDF
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ============================================================
// Support contact
//
// Lives inside Billing because that's where paid customers go when
// something is wrong with their account. Future versions will surface this
// elsewhere (header HelpMenu, command palette) — but starting from one
// well-known location is the right v1.
// ============================================================

interface SupportInfo {
  email: string
  url: string
  operator_notifications_enabled: boolean
}

interface SupportTicket {
  id: string
  project_id: string | null
  subject: string
  category: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  plan_id: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

const TICKET_STATUS_TONE: Record<SupportTicket['status'], string> = {
  open: 'bg-warn/10 text-warn',
  in_progress: 'bg-brand-subtle text-brand',
  resolved: 'bg-ok-muted text-ok',
  closed: 'bg-surface-overlay text-fg-muted',
}

function SupportSection({ projects }: { projects: BillingProject[] }) {
  const infoQuery = usePageData<SupportInfo>('/v1/admin/support/info')
  const ticketsQuery = usePageData<{ tickets: SupportTicket[] }>('/v1/admin/support/tickets?limit=10')
  const info = infoQuery.data
  const tickets = ticketsQuery.data?.tickets ?? []
  const [composing, setComposing] = useState(false)

  if (infoQuery.loading) return null
  if (!info) return null

  return (
    <Card className="p-3 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">Need help?</h3>
          <p className="text-2xs text-fg-muted mt-0.5">
            Direct line to a human. We reply within one business day for paid plans, two for free.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={`mailto:${info.email}?subject=${encodeURIComponent('[Mushi Mushi support]')}`}
            className="text-2xs text-brand hover:text-brand-hover font-mono"
          >
            {info.email}
          </a>
          <Btn size="sm" onClick={() => setComposing((v) => !v)}>
            {composing ? 'Cancel' : 'Open ticket'}
          </Btn>
        </div>
      </header>

      {composing && (
        <SupportComposer
          projects={projects}
          supportEmail={info.email}
          onSubmitted={() => {
            setComposing(false)
            ticketsQuery.reload()
          }}
        />
      )}

      {tickets.length > 0 && <TicketHistory tickets={tickets} projects={projects} />}
    </Card>
  )
}

interface ComposerProps {
  projects: BillingProject[]
  supportEmail: string
  onSubmitted: () => void
}

function SupportComposer({ projects, supportEmail, onSubmitted }: ComposerProps) {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const initialProjectId = useMemo(() => {
    if (activeProjectId && projects.some((p) => p.project_id === activeProjectId)) {
      return activeProjectId
    }
    return projects[0]?.project_id ?? ''
  }, [activeProjectId, projects])

  const [projectId, setProjectId] = useState(initialProjectId)
  const [category, setCategory] = useState('billing')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const res = await apiFetch<{ ticket_id: string; delivered_to_operator: boolean }>(
      '/v1/support/contact',
      {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId || null,
          subject: subject.trim(),
          body: body.trim(),
          category,
        }),
      },
    )
    setSubmitting(false)
    if (!res.ok) {
      if (res.error?.code === 'RATE_LIMITED') {
        toast.error('Slow down', `${res.error.message} Or email ${supportEmail} directly.`)
      } else {
        toast.error('Could not send', res.error?.message)
      }
      return
    }
    toast.success(
      'Ticket received',
      res.data?.delivered_to_operator
        ? 'A human is on it. Reply will land in your inbox.'
        : `Saved. Email ${supportEmail} for urgent issues.`,
    )
    setSubject('')
    setBody('')
    onSubmitted()
  }, [projectId, subject, body, category, supportEmail, toast, onSubmitted])

  return (
    <form onSubmit={handleSubmit} className="border border-edge-subtle rounded-md p-3 bg-surface-subtle space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          label="Project (optional)"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">No specific project</option>
          {projects.map((p) => (
            <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
          ))}
        </SelectField>
        <SelectField
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="billing">Billing</option>
          <option value="bug">Bug</option>
          <option value="feature">Feature request</option>
          <option value="other">Other</option>
        </SelectField>
      </div>
      <Input
        label="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="One-line summary"
        required
        minLength={3}
        maxLength={200}
      />
      <Textarea
        label="What's going on?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="Steps to reproduce, what you expected vs. what happened, project ID if relevant…"
        required
        minLength={10}
        maxLength={5000}
      />
      <div className="flex items-center justify-between">
        <p className="text-2xs text-fg-faint">
          Sent to <span className="font-mono">{supportEmail}</span>. Don't include passwords or API keys.
        </p>
        <Btn
          type="submit"
          size="sm"
          disabled={submitting || subject.length < 3 || body.length < 10}
          loading={submitting}
        >
          Send ticket
        </Btn>
      </div>
    </form>
  )
}

function TicketHistory({ tickets, projects }: { tickets: SupportTicket[]; projects: BillingProject[] }) {
  const projectName = useCallback(
    (id: string | null) => projects.find((p) => p.project_id === id)?.project_name ?? '—',
    [projects],
  )
  return (
    <section className="border-t border-edge-subtle pt-2">
      <h4 className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">Recent tickets</h4>
      <ul className="divide-y divide-edge-subtle">
        {tickets.map((t) => (
          <li key={t.id} className="py-1.5 flex items-center justify-between gap-2 text-2xs">
            <div className="min-w-0 flex-1">
              <p className="text-fg truncate font-medium">{t.subject}</p>
              <p className="text-fg-faint">
                {projectName(t.project_id)} · {t.category} · <RelativeTime value={t.created_at} />
              </p>
            </div>
            <Badge className={TICKET_STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
          </li>
        ))}
      </ul>
    </section>
  )
}
