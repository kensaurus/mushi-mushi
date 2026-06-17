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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import { formatLlmCost } from '../lib/format'
import {
  fixesPeriodDetail,
  fixesPeriodTooltip,
  llmCogsDetail,
  llmCogsTooltip,
  planDetail,
  planTooltip,
  reportsPeriodDetail,
  reportsPeriodTooltip,
} from '../lib/statTooltips/billing'
import { billingLinks } from '../lib/statCardLinks'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageCopy } from '../lib/copy'
import { useBillingUx, resolveQuickBillingTab } from '../lib/billingModeUx'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { SdkConnectivityEmptyState } from '../components/SdkHealthSummary'
import { BillingStatusBanner } from '../components/billing/BillingStatusBanner'
import { EMPTY_BILLING_STATS, type BillingStats, type BillingTabId } from '../components/billing/types'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { ResponsiveTable } from '../components/ResponsiveTable'
import { SnapshotSectionHint,
  Card,
  Btn,
  Badge,
  ErrorAlert,
  EmptyState,
  RelativeTime,
  Input,
  Textarea,
  SelectField,
  Sparkline,
  DetailRows,
  Section,
  StatCard,
  SegmentedControl, } from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { ConfigHelp } from '../components/ConfigHelp'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { PlanComparisonTable } from '../components/billing/PlanComparisonTable'
import { PlanBenefitsList } from '../components/billing/PlanBenefitsList'
import { Modal } from '../components/Modal'

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
    stripe_price_id?: string | null
    current_period_start?: string
    current_period_end?: string
    cancel_at_period_end?: boolean
    /** True when synthesised by the API for a complimentary org (no Stripe sub). */
    synthetic?: boolean
  } | null
  customer: {
    stripe_customer_id?: string
    default_payment_ok?: boolean
    email?: string | null
  } | null
  /**
   * Org-level billing posture. `'stripe'` (default) = self-serve Stripe Billing;
   * `'complimentary'` = Mushi-internal / staff / sponsored — entitlements come
   * from `organizations.plan_id` and no Stripe customer is required.
   */
  billing_mode?: 'stripe' | 'complimentary'
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
  /**
   * Last 30 daily buckets of `reports_ingested` for this project, oldest →
   * newest. Always exactly 30 entries — days with no events come back as
   * `reports: 0` so the sparkline domain is stable across renders. Drives the
   * "Last 30 days" sparkline + caption in the UsageBar so the user can
   * sanity-check the headline number against actual time distribution.
   */
  usage_series?: {
    days: Array<{ day: string; reports: number }>
  } | null
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
  past_due: 'bg-warn-muted/50 text-warning-foreground',
  canceled: 'bg-surface-overlay text-fg-muted',
  unpaid: 'bg-danger-subtle text-danger',
  free: 'bg-surface-overlay text-fg-muted',
}

// Visual tier badges. Falls back to a neutral pill for unknown plan ids.
const TIER_TONE: Record<string, string> = {
  hobby: 'bg-surface-overlay text-fg-muted',
  starter: 'bg-brand-subtle text-brand',
  pro: 'bg-ok-muted text-ok',
  enterprise: 'bg-warn-muted/50 text-warning-foreground border border-warn/30',
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

const BILLING_TABS: Array<{ id: BillingTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Active project plan, usage bar, invoices, and quota health for this period.',
  },
  {
    id: 'plans',
    label: 'Plans',
    description: 'Compare Hobby, Starter, Pro, and Enterprise entitlements side by side.',
  },
  {
    id: 'support',
    label: 'Support',
    description: 'Open a billing ticket or email the team — reply SLA depends on plan tier.',
  },
]

function isBillingTabId(value: string | null): value is BillingTabId {
  return BILLING_TABS.some((t) => t.id === value)
}

export function BillingPage() {
  const copy = usePageCopy('/billing')
  const ux = useBillingUx()
  const toast = useToast()
  const { user } = useAuth()
  const activeProjectId = useActiveProjectId()
  const [searchParams, setSearchParams] = useSearchParams()

  const param = searchParams.get('tab')
  const activeTab: BillingTabId = isBillingTabId(param) ? param : 'overview'
  const activeTabMeta = BILLING_TABS.find((t) => t.id === activeTab) ?? BILLING_TABS[0]

  const billingQuery = usePageData<BillingResponse>('/v1/admin/billing')
  const statsQuery = usePageData<BillingStats>('/v1/admin/billing/stats')
  const billing = billingQuery.data
  const stats = statsQuery.data ?? EMPTY_BILLING_STATS
  const projects = billing?.projects ?? []
  const activeProject = useMemo(
    () => projects.find(p => p.project_id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  )
  const activeTierId = activeProject?.tier?.id ?? 'hobby'
  // Setup status drives the connectivity diagnostic empty state below the
  // active project's billing card. We only need it when the active project
  // has zero reports this period — otherwise React skips the render and
  // the hook just sits on its cache.
  const setup = useSetupStatus(activeProjectId)

  const reloadAll = useCallback(() => {
    billingQuery.reload()
    statsQuery.reload()
  }, [billingQuery, statsQuery])

  useRealtimeReload(['usage_events', 'billing_subscriptions'], reloadAll)

  const setActiveTab = useCallback(
    (id: BillingTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsQuery.loading) return
    const quickTab = resolveQuickBillingTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsQuery.loading, stats, activeTab, setActiveTab])

  const criticalCount =
    (stats.projectCount === 0 ? 1 : 0) +
    stats.pastDueProjects +
    stats.unpaidProjects +
    (stats.overQuota ? 1 : 0) +
    (stats.approachingQuota ? 1 : 0) +
    (stats.hasStripeCustomer && !stats.paymentOk ? 1 : 0) +
    (stats.cancelAtPeriodEnd ? 1 : 0)

  usePublishPageContext({
    route: '/billing',
    title: `${activeTabMeta.label} · Billing`,
    summary: activeTabMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      { id: 'plans' as const, label: copy?.tabLabels?.plans ?? 'Plans' },
      {
        id: 'support' as const,
        label: copy?.tabLabels?.support ?? 'Support',
      },
    ],
    [copy?.tabLabels],
  )

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

  const triggerUpgrade = useCallback(() => {
    if (!activeProject) return
    setPickerFor(activeProject.project_id)
    setActiveTab('overview')
  }, [activeProject, setActiveTab])

  const triggerManage = useCallback(() => {
    if (!activeProject) return
    void openPortal(activeProject.project_id)
  }, [activeProject, openPortal])

  if ((billingQuery.loading && !billing) || (statsQuery.loading && !statsQuery.data)) {
    return <PanelSkeleton rows={5} label="Loading billing" />
  }
  if (billingQuery.error) {
    return (
      <ErrorAlert
        message={`Failed to load billing: ${billingQuery.error}`}
        onRetry={reloadAll}
      />
    )
  }
  if (statsQuery.error) {
    return (
      <ErrorAlert
        message={`Failed to load billing stats: ${statsQuery.error}`}
        onRetry={reloadAll}
      />
    )
  }

  return (
    <div className="space-y-4" data-testid="mushi-page-billing">
      <PageHeaderBar
        title={copy?.title ?? 'Billing'}
        projectScope={stats.projectName ?? activeProject?.project_name}
        description={copy?.description ?? 'Plan, usage, invoices, and quota — everything you need to keep the loop running on your terms.'}
        helpTitle={copy?.help?.title ?? 'About Billing'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Per-project subscription + usage view. The free tier gives every project a monthly quota of report ingests; subscriptions unlock unlimited reports + usage-based pricing on Stripe Meter Events.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Upgrade to Cloud Starter when you hit the free quota and reports are being rejected with HTTP 402',
            'Open the Stripe Billing Portal to update your card, download invoices, or cancel',
            'Cross-check usage between Mushi (reports/fixes/tokens) and Stripe (line items)',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Overview shows your project card with usage + invoices. Plans compares tiers. Support opens a ticket. Upgrade starts Stripe Checkout; Manage opens the customer portal.'
        }
      >
        {!ux.hideOverviewChrome && (
        <SignalChip tone="neutral" className="font-mono">
          Free quota: {billing?.free_limit_reports_per_month?.toLocaleString() ?? stats.freeLimitReports.toLocaleString()} / mo
        </SignalChip>
        )}
      </PageHeaderBar>

      <BillingStatusBanner
        stats={stats}
        onManage={activeProject?.customer?.stripe_customer_id ? triggerManage : undefined}
        onUpgrade={activeProject && activeProject.billing_mode !== 'complimentary' ? triggerUpgrade : undefined}
        onTab={setActiveTab}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Billing sections"
        size="sm"
      />
      )}

      {!ux.hideBillingSnapshot && (
      <Section
        title={copy?.sections?.snapshot ?? 'Billing snapshot'}
        freshness={{ at: statsQuery.lastFetchedAt, isValidating: statsQuery.isValidating }}
      >
        <SnapshotSectionHint text={activeTabMeta.description} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label={copy?.statLabels?.plan ?? 'Plan'}
            value={stats.planDisplayName}
            accent={stats.isComplimentary ? 'text-brand' : stats.planId === 'hobby' ? undefined : 'text-ok'}
            tooltip={planTooltip(stats)}
            detail={planDetail(stats)}
            to={billingLinks.plan}
          />
          <StatCard
            label={copy?.statLabels?.reports ?? 'Reports · period'}
            value={
              stats.reportsLimit != null
                ? `${stats.reportsUsed.toLocaleString()} / ${stats.reportsLimit.toLocaleString()}`
                : stats.reportsUsed.toLocaleString()
            }
            accent={stats.overQuota ? 'text-danger' : stats.approachingQuota ? 'text-warn' : 'text-ok'}
            tooltip={reportsPeriodTooltip(stats)}
            detail={reportsPeriodDetail(stats)}
            to={billingLinks.reportsPeriod}
          />
          <StatCard
            label={copy?.statLabels?.fixes ?? 'Fixes · period'}
            value={`${stats.fixesSucceeded}/${stats.fixesAttempted}`}
            accent={stats.fixesAttempted > 0 ? 'text-info' : undefined}
            tooltip={fixesPeriodTooltip(stats)}
            detail={fixesPeriodDetail()}
            to={billingLinks.fixesPeriod}
          />
          <StatCard
            label={copy?.statLabels?.llmCogs ?? 'LLM COGS · month'}
            value={stats.llmCostUsdMonth > 0 ? formatLlmCost(stats.llmCostUsdMonth) : '$0'}
            accent={stats.llmCostUsdMonth > 0 ? 'text-brand' : undefined}
            tooltip={llmCogsTooltip(stats)}
            detail={llmCogsDetail(stats)}
            to={billingLinks.llmCogs}
          />
        </div>
      </Section>
      )}

      {!ux.hideOverviewChrome &&
        (stats.overQuota ||
          stats.approachingQuota ||
          stats.pastDueProjects > 0 ||
          stats.unpaidProjects > 0 ||
          (stats.hasStripeCustomer && !stats.paymentOk) ||
          stats.cancelAtPeriodEnd) && (
        <Card
          className={`space-y-3 p-4 ${
            stats.overQuota || stats.pastDueProjects > 0 || stats.unpaidProjects > 0 || !stats.paymentOk
              ? 'border-danger/30 bg-danger/5'
              : 'border-warn/30 bg-warn/5'
          }`}
        >
          <SignalChip
            tone={
              stats.overQuota || stats.pastDueProjects > 0 || stats.unpaidProjects > 0
                ? 'danger'
                : 'warn'
            }
          >
            Needs attention
          </SignalChip>
          <ContainedBlock tone="warn">
            <p className="text-xs font-medium leading-snug text-fg">
              {stats.overQuota
                ? `Over quota — ${stats.reportsUsed.toLocaleString()} reports this period${stats.reportsLimit != null ? ` (limit ${stats.reportsLimit.toLocaleString()})` : ''}.`
                : stats.pastDueProjects > 0
                  ? `${stats.pastDueProjects} project${stats.pastDueProjects === 1 ? '' : 's'} past due — update payment method.`
                  : stats.unpaidProjects > 0
                    ? `${stats.unpaidProjects} unpaid invoice${stats.unpaidProjects === 1 ? '' : 's'} need settlement.`
                    : stats.approachingQuota
                      ? `Approaching quota — ${stats.usagePct ?? 0}% of monthly reports used.`
                      : stats.cancelAtPeriodEnd
                        ? 'Subscription cancels at period end — renew to keep Pro features.'
                        : 'Payment method needs attention — open the billing portal.'}
            </p>
          </ContainedBlock>
          <ActionPillRow>
            {activeProject?.customer?.stripe_customer_id ? (
              <ActionPill onClick={() => void triggerManage()} tone="brand">
                Manage billing →
              </ActionPill>
            ) : (
              <ActionPill onClick={() => activeProject && void triggerUpgrade()} tone="brand">
                Upgrade plan →
              </ActionPill>
            )}
            <ActionPill onClick={() => setActiveTab('plans')} tone="neutral">
              Compare plans
            </ActionPill>
          </ActionPillRow>
        </Card>
      )}

      {ux.hideBillingSnapshot && (
        <ContainedBlock tone="muted" className="mb-1">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeTabMeta.description}</p>
        </ContainedBlock>
      )}

      <div
        role="tabpanel"
        id={`billing-panel-${activeTab}`}
        aria-labelledby={`billing-tab-${activeTab}`}
      >
        {activeTab === 'overview' && (
          <>
            {projects.length === 0 ? (
              <EmptyState
                title="No projects yet"
                description="Create a project from the Projects page to start tracking usage and billing."
                action={
                  <Link to="/projects">
                    <Btn size="sm">Go to Projects</Btn>
                  </Link>
                }
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

            {activeProject &&
              (activeProject.usage?.reports ?? 0) === 0 &&
              setup.activeProject?.project_id === activeProject.project_id && (
                <SdkConnectivityEmptyState
                  projectId={activeProject.project_id}
                  projectName={activeProject.project_name}
                  lastReportAt={null}
                  diagnostic={setup.getStep('sdk_installed')?.diagnostic ?? null}
                  adminHost={setup.data?.admin_endpoint_host ?? null}
                  headline="Why this period reads 0"
                  onTestReportSent={() => {
                    setup.reload()
                    reloadAll()
                  }}
                />
              )}
          </>
        )}

        {activeTab === 'plans' && (billing?.plans?.length ?? 0) > 0 && (
          <PlanComparisonTable
            plans={billing!.plans!}
            currentPlanId={activeTierId}
            currentUsage={
              activeProject
                ? {
                    reports: activeProject.usage?.reports ?? 0,
                    contextLabel: activeProject.project_name,
                  }
                : undefined
            }
          />
        )}

        {activeTab === 'plans' && (billing?.plans?.length ?? 0) === 0 && (
          <EmptyState
            title="Plan catalog unavailable"
            description="The API didn't return plan tiers — check billing_subscriptions migrations or reload."
          />
        )}

        {activeTab === 'support' && <SupportSection projects={projects} />}
      </div>
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
  // Org-level posture: complimentary orgs (Mushi staff / sponsored / beta) have
  // a synthesised subscription server-side and intentionally no Stripe customer.
  // Hide every Stripe-touching affordance for them — no checkout, no portal,
  // no invoices section noise — and replace with a clear "Complimentary" badge.
  const isComplimentary = project.billing_mode === 'complimentary'
  // Use the API-provided usage_pct when available; we DON'T clamp here so the
  // UsageBar can show the true overage % (e.g. "120% used") in the chip.
  // Bar fill clamping is the bar component's responsibility.
  const apiPct = project.usage_pct ?? null
  const usagePct = apiPct != null
    ? apiPct
    : project.limit_reports
      ? Math.round((project.usage.reports / project.limit_reports) * 100)
      : null

  const overageRate = tier?.overage_unit_amount_decimal
  const purchasable = plans.filter((p) => p.is_self_serve && p.id !== 'hobby' && p.id !== tierId)

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
              <Badge className="bg-warn-muted/50 text-warning-foreground border border-warn/30">
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

      <UsageBar
        usage={project.usage}
        limitReports={project.limit_reports}
        pct={usagePct}
        periodStart={project.period_start}
        llmCostUsd={project.llm_cost_usd_this_month}
        overQuota={project.over_quota}
        overageRate={overageRate ?? null}
        tierId={tierId}
        usageSeries={project.usage_series}
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
  onPick: (planId: string) => void
}

function PlanPicker({ plans, currentPlanId, busy, onPick }: PlanPickerProps) {
  return (
    <ContainedBlock tone="muted" className="p-3 space-y-2">
      <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
        <SignalChip tone="neutral" className="uppercase tracking-wider">
          {currentPlanId === 'hobby' ? 'Pick a plan' : 'Switch to'}
        </SignalChip>
        <InlineProof className="border-0 bg-transparent px-0 py-0">
          Billed monthly · cancel any time
        </InlineProof>
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
            <ContainedBlock tone="neutral" className="mt-1 space-y-1">
              <InlineProof className="border-0 bg-transparent px-0 py-0">
                {p.included_reports_per_month?.toLocaleString() ?? '∞'} reports/mo included
                {p.overage_unit_amount_decimal != null && (
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
              onClick={() => onPick(p.id)}
              disabled={busy}
              loading={busy}
            >
              {`Select ${p.display_name}`}
            </Btn>
          </article>
        ))}
      </div>
      <InlineProof className="mt-2 border-0 bg-transparent px-0 py-0">
        Need an air-gapped install, custom DPA, or &gt; 500k reports/mo?{' '}
        <a href="mailto:kensaurus@gmail.com" className="text-brand hover:text-brand-hover">
          Email sales
        </a>{' '}
        for Enterprise.
      </InlineProof>
    </ContainedBlock>
  )
}

interface UsageBarProps {
  usage: BillingProject['usage']
  limitReports: number | null
  pct: number | null
  periodStart: string | null
  /** §3: real $ spent on LLM calls this billing month. */
  llmCostUsd?: number
  /** API-flagged: ingest is currently being rejected (Hobby) or overage-billed (paid). */
  overQuota: boolean
  /** USD per report once over included quota. `null` for plans without metered overage. */
  overageRate: number | null
  /** `'hobby' | 'starter' | 'pro' | 'enterprise'` — drives whether overage is billed or rejected. */
  tierId: string
  /**
   * 30-day daily reports series (oldest → newest, always 30 entries). When
   * present, renders a sparkline + summary caption beneath the progress bar
   * so the user can verify the headline count against the actual temporal
   * shape of their ingest. Omit on legacy API responses → section hides.
   */
  usageSeries?: BillingProject['usage_series']
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

// Severity tone the whole UsageBar takes on — matches across chip, progress
// bar, and headline number so the user gets one consistent visual signal.
type UsageTone = 'ok' | 'warn' | 'danger' | 'muted'

interface UsageHeadline {
  tone: UsageTone
  /** Short label for the right-aligned chip ("Healthy" / "Approaching quota" / "Over quota"). */
  chipLabel: string
  /** Long-form sentence under the bar. Plan-aware. `null` => suppress (no signal yet). */
  narrative: string | null
}

const USAGE_CHIP_TONE: Record<UsageTone, string> = {
  ok: 'bg-ok-muted text-ok',
  warn: 'bg-warn-muted/50 text-warning-foreground',
  danger: 'bg-danger-subtle text-danger',
  muted: 'bg-surface-overlay text-fg-muted',
}

const USAGE_BAR_TONE: Record<UsageTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  muted: 'bg-fg-faint/40',
}

const USAGE_NUMBER_TONE: Record<UsageTone, string> = {
  ok: 'text-fg',
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-fg',
}

/**
 * Build the severity tone + plan-aware narrative for a single project's quota.
 * Hobby gets "rejected" copy because the gateway HTTP-402s past the limit;
 * paid plans get "billed" copy because the meter just keeps going.
 */
function buildUsageHeadline(
  used: number,
  limit: number | null,
  pct: number | null,
  overQuota: boolean,
  overageRate: number | null,
  tierId: string,
): UsageHeadline {
  if (limit == null) {
    return { tone: 'muted', chipLabel: 'Unlimited', narrative: 'No monthly cap on this plan.' }
  }
  const isHobby = tierId === 'hobby'
  if (overQuota || (pct != null && pct >= 100)) {
    const overageReports = Math.max(0, used - limit)
    if (isHobby || overageRate == null || overageRate <= 0) {
      return {
        tone: 'danger',
        chipLabel: 'Over quota',
        narrative:
          overageReports > 0
            ? `${overageReports.toLocaleString()} report${overageReports === 1 ? '' : 's'} rejected this period — upgrade to keep ingesting.`
            : 'New reports are being rejected — upgrade to keep ingesting.',
      }
    }
    const overageUsd = overageReports * overageRate
    return {
      tone: 'danger',
      chipLabel: 'Over quota',
      narrative: `${overageReports.toLocaleString()} overage report${overageReports === 1 ? '' : 's'} — billed at $${overageRate.toFixed(4)}/each = ${formatLlmCost(overageUsd)} this cycle.`,
    }
  }
  if (pct != null && pct >= 80) {
    const remaining = Math.max(0, limit - used)
    return {
      tone: 'warn',
      chipLabel: `Approaching quota`,
      narrative: `${remaining.toLocaleString()} report${remaining === 1 ? '' : 's'} of headroom left this period.`,
    }
  }
  if (pct != null && pct >= 50) {
    const remaining = Math.max(0, limit - used)
    return {
      tone: 'ok',
      chipLabel: `${pct}% used`,
      narrative: `${remaining.toLocaleString()} reports of headroom left.`,
    }
  }
  return {
    tone: 'ok',
    chipLabel: pct != null ? `${pct}% used` : 'Healthy',
    narrative: pct === 0 || pct == null ? 'Plenty of headroom this period.' : null,
  }
}

interface UsageSeriesSummary {
  values: number[]
  total: number
  activeDays: number
  peakReports: number
  peakDayLabel: string | null
  /** Most recent day with any reports, formatted as "Apr 23" — null when fully idle. */
  lastActiveDayLabel: string | null
  lastActiveDaysAgo: number | null
  /** Average reports / active day, rounded to 1dp. 0 when no active days. */
  avgPerActiveDay: number
}

/**
 * Derive everything the sparkline section needs from a 30-day daily reports
 * series. Built once per render rather than splattered across JSX so the
 * component stays scannable and the math is easy to test.
 */
function summariseUsageSeries(
  series: BillingProject['usage_series'],
): UsageSeriesSummary | null {
  if (!series || !Array.isArray(series.days) || series.days.length === 0) return null
  const values = series.days.map((d) => Math.max(0, Number(d.reports) || 0))
  const total = values.reduce((a, b) => a + b, 0)
  const activeBuckets = series.days.filter((d) => (Number(d.reports) || 0) > 0)
  const activeDays = activeBuckets.length
  const avgPerActiveDay = activeDays > 0 ? Math.round((total / activeDays) * 10) / 10 : 0

  let peakReports = 0
  let peakDayLabel: string | null = null
  for (const d of series.days) {
    const v = Number(d.reports) || 0
    if (v > peakReports) {
      peakReports = v
      peakDayLabel = formatShortDay(d.day)
    }
  }

  let lastActiveDayLabel: string | null = null
  let lastActiveDaysAgo: number | null = null
  for (let i = series.days.length - 1; i >= 0; i--) {
    if ((Number(series.days[i].reports) || 0) > 0) {
      lastActiveDayLabel = formatShortDay(series.days[i].day)
      lastActiveDaysAgo = series.days.length - 1 - i
      break
    }
  }

  return {
    values,
    total,
    activeDays,
    peakReports,
    peakDayLabel,
    lastActiveDayLabel,
    lastActiveDaysAgo,
    avgPerActiveDay,
  }
}

function formatShortDay(yyyyMmDd: string): string | null {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  if (!y || !m || !d) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const SPARK_TONE: Record<UsageTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-fg-muted',
}

function UsageBar({
  usage,
  limitReports,
  pct,
  periodStart,
  llmCostUsd,
  overQuota,
  overageRate,
  tierId,
  usageSeries,
}: UsageBarProps) {
  const headline = buildUsageHeadline(usage.reports, limitReports, pct, overQuota, overageRate, tierId)
  const barTone = USAGE_BAR_TONE[headline.tone]
  // Bar fill: clamp at 100% so the visual length stays sane, but the chip +
  // narrative still report the *real* overage above the bar.
  const barWidthPct = pct == null ? 0 : Math.min(100, Math.max(2, pct))
  const forecast = buildUsageForecast(usage.reports, limitReports, periodStart)
  const seriesSummary = summariseUsageSeries(usageSeries)

  return (
    <section
      className="space-y-2"
      aria-label={`Quota usage: ${headline.chipLabel}${pct != null ? ` (${pct}%)` : ''}`}
      data-quota-tone={headline.tone}
    >
      {/* Headline row — the count + severity chip are now the focal point of
          the card. Tabular-nums keeps the digits aligned across re-renders. */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className={`text-base font-semibold tabular-nums ${USAGE_NUMBER_TONE[headline.tone]}`}>
              {usage.reports.toLocaleString()}
            </span>
            {limitReports != null ? (
              <span className="text-xs text-fg-muted tabular-nums">
                / {limitReports.toLocaleString()}
              </span>
            ) : (
              <span className="text-xs text-fg-faint">unlimited</span>
            )}
            <SignalChip tone="neutral" className="tabular-nums">
              reports this period
            </SignalChip>
          </div>
        </div>
        <Badge className={USAGE_CHIP_TONE[headline.tone]} title={headline.narrative ?? undefined}>
          {/* Tone glyph — small visual anchor so the chip reads at a squint
              even when colour is missing (high-contrast mode, colour-blind). */}
          <span aria-hidden="true" className="mr-1 leading-none">
            {headline.tone === 'danger' ? '●' : headline.tone === 'warn' ? '▲' : headline.tone === 'muted' ? '∞' : '○'}
          </span>
          {headline.chipLabel}
          {pct != null && headline.chipLabel !== `${pct}% used` && (
            <span className="ml-1 font-mono opacity-80 tabular-nums">{pct}%</span>
          )}
        </Badge>
      </div>

      {limitReports != null && (
        <div
          className="relative h-2.5 bg-surface-overlay rounded-sm overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, pct ?? 0)}
          aria-valuetext={`${pct ?? 0}% of monthly quota used`}
        >
          <div
            className={`h-full ${barTone} motion-safe:transition-[width] duration-500`}
            style={{ width: `${barWidthPct}%` }}
          />
          {/* 80% milestone tick — gives the eye something to land on between
              "comfortable" and "you should look at this". Hidden when over quota
              so the danger bar reads as a single saturated block. */}
          {headline.tone !== 'danger' && (
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-px bg-edge-subtle/80"
              style={{ left: '80%' }}
            />
          )}
        </div>
      )}

      {(headline.narrative || forecast) && (
        <ContainedBlock tone={headline.tone === 'danger' ? 'warn' : headline.tone === 'warn' ? 'warn' : 'muted'} className="flex flex-wrap items-center gap-2">
          {headline.narrative && (
            <InlineProof className={`border-0 bg-transparent px-0 py-0 ${headline.tone === 'danger' ? 'text-danger' : headline.tone === 'warn' ? 'text-warn' : ''}`}>
              {headline.narrative}
            </InlineProof>
          )}
          {forecast && (
            <SignalChip tone={forecast.tone === 'danger' ? 'danger' : forecast.tone === 'warn' ? 'warn' : 'neutral'} className="font-mono">
              {forecast.label}
            </SignalChip>
          )}
        </ContainedBlock>
      )}

      {/* 30-day reports trend — sits between the period headline and the
          secondary metrics so the user can sanity-check the big number ("am I
          really at 60k?") against the actual time distribution. The
          sparkline inherits the headline tone so the chart, chip, and bar all
          read as one coherent severity signal. When the project has been
          fully idle for 30 days we suppress the chart and show a one-line
          empty state instead — a flat zero line is visual noise, not signal. */}
      {seriesSummary && (
        <section
          className="border-t border-edge-subtle/60 pt-2 space-y-1"
          aria-label="Last 30 days of reports ingested"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <SignalChip tone="neutral" className="uppercase tracking-wider">
              Last 30 days
            </SignalChip>
            <InlineProof className="border-0 bg-transparent px-0 py-0 font-mono tabular-nums">
              {seriesSummary.total.toLocaleString()} report
              {seriesSummary.total === 1 ? '' : 's'}
              <span aria-hidden="true" className="mx-1">·</span>
              {seriesSummary.activeDays} active day
              {seriesSummary.activeDays === 1 ? '' : 's'}
            </InlineProof>
          </div>
          {seriesSummary.total > 0 ? (
            <div className="flex items-center gap-3 flex-wrap">
              <div className={SPARK_TONE[headline.tone]}>
                <Sparkline
                  values={seriesSummary.values}
                  width={180}
                  height={28}
                  ariaLabel={`Daily reports trend over the last 30 days. Total ${seriesSummary.total}, ${seriesSummary.activeDays} active days, peak ${seriesSummary.peakReports}${seriesSummary.peakDayLabel ? ` on ${seriesSummary.peakDayLabel}` : ''}.`}
                />
              </div>
              <InlineProof className="tabular-nums border-0 bg-transparent px-0 py-0">
                {seriesSummary.avgPerActiveDay > 0 && (
                  <>
                    <SignalChip tone="neutral" className="font-mono">
                      {seriesSummary.avgPerActiveDay} / active day
                    </SignalChip>
                  </>
                )}
                {seriesSummary.peakDayLabel && seriesSummary.peakReports > 0 && (
                  <SignalChip tone="neutral" className="font-mono">
                    peak {seriesSummary.peakReports.toLocaleString()} on {seriesSummary.peakDayLabel}
                  </SignalChip>
                )}
                {seriesSummary.lastActiveDayLabel && seriesSummary.lastActiveDaysAgo != null && (
                  <SignalChip tone="neutral">
                    last activity{' '}
                    {seriesSummary.lastActiveDaysAgo === 0
                      ? 'today'
                      : seriesSummary.lastActiveDaysAgo === 1
                        ? 'yesterday'
                        : `${seriesSummary.lastActiveDaysAgo}d ago`}
                  </SignalChip>
                )}
              </InlineProof>
            </div>
          ) : (
            <EmptySectionMessage
              text="No reports ingested in the last 30 days."
              hint="Confirm the SDK is wired up and sending events to this project."
            />
          )}
        </section>
      )}

      {/* Secondary metrics — explicitly demoted below the quota block.
          They're useful but not what the user came here to read. */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-edge-subtle/60">
        <ContainedBlock tone="muted" className="flex flex-wrap items-center gap-1.5 py-1.5">
          <SignalChip tone="info">
            Fixes <span className="font-mono tabular-nums">{usage.fixes.toLocaleString()}</span>
          </SignalChip>
          <SignalChip tone="neutral">
            Classifier tokens <span className="font-mono tabular-nums">{usage.tokens.toLocaleString()}</span>
          </SignalChip>
          {llmCostUsd != null && (
            <span title="Real $ spent on LLM calls this billing month, from llm_invocations.cost_usd">
              <SignalChip tone="brand">
                LLM {formatLlmCost(llmCostUsd)}
              </SignalChip>
            </span>
          )}
        </ContainedBlock>
      </div>
    </section>
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
      </ResponsiveTable>
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
  body?: string
  category: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed' | 'cancelled'
  plan_id: string | null
  admin_response?: string | null
  admin_responded_at?: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  cancelled_at?: string | null
}

const TICKET_STATUS_TONE: Record<SupportTicket['status'], string> = {
  open: 'bg-warn-muted/50 text-warning-foreground',
  in_progress: 'bg-brand-subtle text-brand',
  resolved: 'bg-ok-muted text-ok',
  closed: 'bg-surface-overlay text-fg-muted',
  cancelled: 'bg-surface-overlay text-fg-faint border border-edge-subtle',
}

const TICKET_STATUS_LABEL: Record<SupportTicket['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

function isCancellable(status: SupportTicket['status']): boolean {
  return status === 'open' || status === 'in_progress'
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
          <ContainedBlock tone="muted" className="mt-0.5">
            <p className="text-2xs text-fg-muted">
              Direct line to a human. We reply within one business day for paid plans, two for free.
            </p>
          </ContainedBlock>
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

      {tickets.length > 0 && (
        <TicketHistory
          tickets={tickets}
          projects={projects}
          onTicketsChanged={() => ticketsQuery.reload()}
        />
      )}
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
    <form onSubmit={handleSubmit} className="border border-edge-subtle rounded-md p-3 bg-surface-raised/30 space-y-2">
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
          helpId="billing.support_category"
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
        helpId="billing.support_subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="One-line summary"
        required
        minLength={3}
        maxLength={200}
      />
      <Textarea
        label="What's going on?"
        helpId="billing.support_body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="Steps to reproduce, what you expected vs. what happened, project ID if relevant…"
        required
        minLength={10}
        maxLength={5000}
      />
      <div className="flex items-center justify-between">
        <InlineProof className="border-0 bg-transparent px-0 py-0">
          Sent to <span className="font-mono">{supportEmail}</span>. Don't include passwords or API keys.
        </InlineProof>
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

function TicketHistory({
  tickets,
  projects,
  onTicketsChanged,
}: {
  tickets: SupportTicket[]
  projects: BillingProject[]
  onTicketsChanged: () => void
}) {
  const projectName = useCallback(
    (id: string | null) => projects.find((p) => p.project_id === id)?.project_name ?? '—',
    [projects],
  )
  // Single source of truth for which ticket is expanded. A modal reads
  // straight from `tickets` instead of cloning state so the row stays in
  // sync if a realtime push (or explicit reload) updates the ticket while
  // the modal is open.
  const [openTicketId, setOpenTicketId] = useState<string | null>(null)
  const openTicket = tickets.find((t) => t.id === openTicketId) ?? null

  return (
    <section className="border-t border-edge-subtle pt-2">
      <SignalChip tone="neutral" className="mb-1.5 uppercase tracking-wider">
        Recent tickets
      </SignalChip>
      <ul className="divide-y divide-edge-subtle">
        {tickets.map((t) => {
          // Surface "you have a reply waiting" right on the row so users
          // don't have to open every ticket to find the one with news.
          const hasReply = Boolean(t.admin_response?.trim())
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setOpenTicketId(t.id)}
                className="w-full py-1.5 flex items-center justify-between gap-2 text-2xs text-left hover:bg-surface-overlay/40 motion-safe:transition-colors rounded-sm px-1 -mx-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                aria-label={`View ticket ${t.subject}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-fg truncate font-medium">{t.subject}</p>
                    {hasReply && (
                      <Badge className="border border-edge-subtle bg-surface-raised text-fg-secondary shrink-0 text-3xs">
                        Reply
                      </Badge>
                    )}
                  </div>
                  <InlineProof className="mt-0.5 border-0 bg-transparent px-0 py-0 truncate">
                    <SignalChip tone="neutral">{projectName(t.project_id)}</SignalChip>
                    <SignalChip tone="neutral" className="capitalize">{t.category}</SignalChip>
                    <RelativeTime value={t.created_at} />
                  </InlineProof>
                </div>
                <Badge className={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
              </button>
            </li>
          )
        })}
      </ul>

      <TicketDetailModal
        ticket={openTicket}
        projectName={openTicket ? projectName(openTicket.project_id) : ''}
        onClose={() => setOpenTicketId(null)}
        onCancelled={() => {
          setOpenTicketId(null)
          onTicketsChanged()
        }}
      />
    </section>
  )
}

function TicketDetailModal({
  ticket,
  projectName,
  onClose,
  onCancelled,
}: {
  ticket: SupportTicket | null
  projectName: string
  onClose: () => void
  onCancelled: () => void
}) {
  const toast = useToast()
  const [cancelling, setCancelling] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Reset transient confirm/cancel state every time the modal points at a
  // different ticket. Without this, opening ticket A → clicking "Cancel
  // ticket" → closing → opening ticket B would leave B pre-armed for
  // cancel, which is a footgun.
  //
  // Side-effects must live in `useEffect`, never `useMemo` — `useMemo` runs
  // during render, which makes `setState` calls inside it warn under
  // StrictMode and risk render loops. The `useMemo` form was a copilot-flagged
  // bug from the original wave; this is the fix.
  const ticketId = ticket?.id ?? null
  useEffect(() => {
    setConfirming(false)
    setCancelling(false)
  }, [ticketId])

  const handleCancel = useCallback(async () => {
    if (!ticket) return
    setCancelling(true)
    const res = await apiFetch<{ ticket_id: string; status: string }>(
      `/v1/admin/support/tickets/${ticket.id}/cancel`,
      { method: 'POST' },
    )
    setCancelling(false)
    if (!res.ok) {
      toast.error('Could not cancel', res.error?.message)
      return
    }
    toast.success('Ticket cancelled', 'Operators have been notified.')
    onCancelled()
  }, [ticket, toast, onCancelled])

  if (!ticket) return null

  const cancellable = isCancellable(ticket.status)
  const statusLine =
    ticket.status === 'cancelled' && ticket.cancelled_at
      ? <>Cancelled <RelativeTime value={ticket.cancelled_at} /></>
      : ticket.status === 'resolved' && ticket.resolved_at
        ? <>Resolved <RelativeTime value={ticket.resolved_at} /></>
        : <>Last updated <RelativeTime value={ticket.updated_at} /></>

  return (
    <Modal
      open={Boolean(ticket)}
      onClose={onClose}
      size="md"
      ariaLabel={`Support ticket: ${ticket.subject}`}
      title={
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate">{ticket.subject}</span>
        </span>
      }
      headerAction={
        <Badge className={TICKET_STATUS_TONE[ticket.status]}>
          {TICKET_STATUS_LABEL[ticket.status]}
        </Badge>
      }
      footer={
        <>
          <Btn size="sm" variant="cancel" onClick={onClose}>
            Close
          </Btn>
          {cancellable && !confirming && (
            <Btn size="sm" variant="danger" onClick={() => setConfirming(true)}>
              Cancel ticket
            </Btn>
          )}
          {cancellable && confirming && (
            <>
              <Btn size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={cancelling}>
                Keep ticket
              </Btn>
              <Btn size="sm" variant="danger" onClick={handleCancel} loading={cancelling} disabled={cancelling}>
                Confirm cancel
              </Btn>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <DetailRows
          dense
          items={[
            { label: 'Project', value: projectName, tone: 'muted' },
            { label: 'Category', value: <span className="capitalize">{ticket.category}</span>, tone: 'muted' },
            { label: 'Submitted', value: <RelativeTime value={ticket.created_at} />, tone: 'muted' },
            { label: 'Status', value: statusLine, tone: 'muted' },
          ]}
        />

        <section>
          <SignalChip tone="neutral" className="mb-1.5 uppercase tracking-wider">
            Your message
          </SignalChip>
          <ContainedBlock tone="muted" className="text-fg-secondary leading-relaxed whitespace-pre-wrap break-words">
            {ticket.body?.trim() || (
              <EmptySectionMessage text="No message recorded." />
            )}
          </ContainedBlock>
        </section>

        {ticket.admin_response?.trim() ? (
          <section>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <SignalChip tone="brand" className="uppercase tracking-wider">
                Reply from support
              </SignalChip>
              {ticket.admin_responded_at && (
                <SignalChip tone="neutral">
                  <RelativeTime value={ticket.admin_responded_at} />
                </SignalChip>
              )}
            </div>
            <ContainedBlock tone="info" className="text-fg leading-relaxed whitespace-pre-wrap break-words border-brand/30 bg-brand/5">
              {ticket.admin_response}
            </ContainedBlock>
          </section>
        ) : ticket.status === 'open' || ticket.status === 'in_progress' ? (
          <EmptySectionMessage text="No reply yet. We aim for one business day on paid plans, two on free. You'll see the response here and in the original email thread." />
        ) : null}

        {ticket.status === 'cancelled' && (
          <EmptySectionMessage text="You cancelled this ticket. If the issue resurfaces, send a fresh ticket and link to this id." />
        )}
      </div>
    </Modal>
  )
}
