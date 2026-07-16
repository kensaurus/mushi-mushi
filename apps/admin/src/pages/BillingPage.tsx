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
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageCopy } from '../lib/copy'
import { useBillingUx, resolveQuickBillingTab } from '../lib/billingModeUx'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { BillingStatusBanner } from '../components/billing/BillingStatusBanner'
import { BillingSnapshotStrip } from '../components/billing/BillingSnapshotStrip'
import { BillingSeatFaqCallout } from '../components/billing/BillingSeatFaqCallout'
import { useActivePlan } from '../lib/useActivePlan'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { EMPTY_MEMBERS_STATS, type MembersStats } from '../components/members/types'
import { BillingPlanReadout } from '../components/billing/BillingPlanReadout'
import {
  EMPTY_BILLING_STATS,
  type BillingStats,
  type BillingTabId,
  type BillingResponse,
} from '../components/billing/types'
import { BillingOverviewPanel } from '../components/billing/BillingOverviewPanel'
import { BillingSupportPanel } from '../components/billing/BillingSupportPanel'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import {
  Card,
  ErrorAlert,
  EmptyState,
} from '../components/ui'
import { MotionSegmentedControl } from '../components/motion/MotionSegmentedControl'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { PlanComparisonTable } from '../components/billing/PlanComparisonTable'

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
  const activeOrgId = useActiveOrgId()
  const membersStatsQuery = usePageData<MembersStats>(
    activeOrgId ? `/v1/org/${activeOrgId}/members/stats` : null,
  )
  const { plan: activePlan } = useActivePlan()
  const membersStats = membersStatsQuery.data ?? EMPTY_MEMBERS_STATS
  const billing = billingQuery.data
  const stats = statsQuery.data ?? EMPTY_BILLING_STATS
  usePublishPageHeroStats('/billing', statsQuery.data)
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
    membersStatsQuery.reload()
  }, [billingQuery, statsQuery, membersStatsQuery])

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

  const startCheckout = useCallback(async (projectId: string, planId: string, billingInterval: 'monthly' | 'annual' = 'monthly') => {
    if (!user?.email) {
      toast.error('Email required', 'Sign in with an email-backed account before subscribing.')
      return
    }
    setActioning(`checkout:${projectId}`)
    const res = await apiFetch<{ url: string }>('/v1/admin/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, email: user.email, plan_id: planId, billing_interval: billingInterval }),
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
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-billing">
      <PageHeaderBar
        title={copy?.title ?? 'Billing'}
        projectScope={stats.projectName ?? activeProject?.project_name}

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

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <BillingStatusBanner
                stats={stats}
                onManage={activeProject?.customer?.stripe_customer_id ? triggerManage : undefined}
                onUpgrade={activeProject && activeProject.billing_mode !== 'complimentary' ? triggerUpgrade : undefined}
                onTab={setActiveTab}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideBillingSnapshot,
            children: (
              <BillingSnapshotStrip
                stats={stats}
                fetchedAt={statsQuery.lastFetchedAt}
                isValidating={statsQuery.isValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'Billing snapshot'}
                hint={activeTabMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
        ]}
      />

      {(activeTab === 'overview' || activeTab === 'plans') && (
        <BillingSeatFaqCallout
          collapsible={activeTab === 'plans'}
          planDisplayName={
            membersStats.planDisplayName ?? activePlan?.displayName ?? stats.planDisplayName
          }
          planId={membersStats.planId ?? activePlan?.planId ?? stats.planId}
          seatLimit={membersStats.seatLimit ?? activePlan?.seatLimit ?? null}
          seatsUsed={membersStats.seatsUsed}
          teamsEnabled={Boolean(activePlan?.featureFlags?.teams)}
        />
      )}

      {!ux.hideTabs && (
      <MotionSegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Billing sections"
        trackId="billing-section-tabs"
        size="sm"
      />
      )}

      {activeTab === 'overview' && !ux.hideOverviewChrome ? (
        <BillingPlanReadout
          planName={stats.planDisplayName}
          planSlug={stats.planId}
          stripePortalUrl={null}
          diagnosesUsed={
            (stats as unknown as { diagnosesUsed?: number | null }).diagnosesUsed ?? null
          }
          diagnosesLimit={
            (stats as unknown as { diagnosesLimit?: number | null }).diagnosesLimit ?? null
          }
          fetchedAt={statsQuery.lastFetchedAt}
          isValidating={statsQuery.isValidating}
        />
      ) : null}

      {!ux.hideOverviewChrome &&
        (stats.overQuota ||
          stats.approachingQuota ||
          (stats as unknown as { overDiagnosisQuota?: boolean }).overDiagnosisQuota ||
          (stats as unknown as { approachingDiagnosisQuota?: boolean }).approachingDiagnosisQuota ||
          stats.pastDueProjects > 0 ||
          stats.unpaidProjects > 0 ||
          (stats.hasStripeCustomer && !stats.paymentOk) ||
          stats.cancelAtPeriodEnd) && (
        <Card
          className={`space-y-3 p-4 ${
            stats.overQuota ||
            (stats as unknown as { overDiagnosisQuota?: boolean }).overDiagnosisQuota ||
            stats.pastDueProjects > 0 || stats.unpaidProjects > 0 || !stats.paymentOk
              ? 'border-danger/40 bg-surface-raised'
              : 'border-warn/40 bg-surface-raised'
          }`}
        >
          <SignalChip
            tone={
              stats.overQuota ||
              (stats as unknown as { overDiagnosisQuota?: boolean }).overDiagnosisQuota ||
              stats.pastDueProjects > 0 || stats.unpaidProjects > 0
                ? 'danger'
                : 'warn'
            }
          >
            Needs attention
          </SignalChip>
          <ContainedBlock tone="warn">
            <p className="text-xs font-medium leading-snug text-fg">
              {(stats as unknown as { overDiagnosisQuota?: boolean }).overDiagnosisQuota
                ? (() => {
                    const s = stats as unknown as { diagnosesUsed: number; diagnosesLimit: number | null }
                    return `Diagnosis quota reached — ${s.diagnosesUsed.toLocaleString()} of ${s.diagnosesLimit?.toLocaleString() ?? '?'} diagnoses used. New bug reports are still captured; plain-English reads resume next billing cycle or on upgrade.`
                  })()
                : stats.overQuota
                  ? `Over quota — ${stats.reportsUsed.toLocaleString()} reports this period${stats.reportsLimit != null ? ` (limit ${stats.reportsLimit.toLocaleString()})` : ''}.`
                  : stats.pastDueProjects > 0
                    ? `${stats.pastDueProjects} project${stats.pastDueProjects === 1 ? '' : 's'} past due — update payment method.`
                    : stats.unpaidProjects > 0
                      ? `${stats.unpaidProjects} unpaid invoice${stats.unpaidProjects === 1 ? '' : 's'} need settlement.`
                      : (stats as unknown as { approachingDiagnosisQuota?: boolean }).approachingDiagnosisQuota
                        ? `Approaching quota — ${(stats as unknown as { diagnosesUsagePct: number }).diagnosesUsagePct ?? 0}% of monthly diagnoses used.`
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
          <BillingOverviewPanel
            projects={projects}
            plans={billing?.plans ?? []}
            actioning={actioning}
            pickerFor={pickerFor}
            onTogglePicker={(projectId) =>
              setPickerFor(pickerFor === projectId ? null : projectId)
            }
            onPickPlan={(projectId, planId, billingInterval) => {
              setPickerFor(null)
              void startCheckout(projectId, planId, billingInterval)
            }}
            onManage={openPortal}
            onReload={reloadAll}
            activeProject={activeProject}
            setup={setup}
          />
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

        {activeTab === 'support' && <BillingSupportPanel projects={projects} />}

      </div>
    </div>
  )
}
