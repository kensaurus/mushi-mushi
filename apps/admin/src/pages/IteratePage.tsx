/**
 * FILE: apps/admin/src/pages/IteratePage.tsx
 * PURPOSE: Banner + PDCA SNAPSHOT + tabs: Overview | Runs | New Run.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageCopy } from '../lib/copy'
import { useIterateUx, resolveQuickIterateTab } from '../lib/iterateModeUx'
import { SetupNudge } from '../components/SetupNudge'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Card,
  Section,
  Btn,
  Badge,
  ErrorAlert,
  StatCard,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction,
  RelativeTime,
} from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PdcaContextHint } from '../components/PdcaContextHint'
import { IterateStatusBanner } from '../components/iterate/IterateStatusBanner'
import { PdcaRunTable } from '../components/iterate/PdcaRunTable'
import { NewRunForm } from '../components/iterate/NewRunForm'
import { PdcaRunDrawer } from '../components/iterate/PdcaRunDrawer'
import type { PdcaRun } from '../components/iterate/types'
import {
  EMPTY_ITERATE_STATS,
  type IterateStats,
  type IterateTabId,
} from '../components/iterate/IterateStatsTypes'
import {
  activeRunsDetail,
  activeRunsTooltip,
  avgScoreDetail,
  avgScoreTooltip,
  failedRunsDetail,
  failedRunsTooltip,
  iterationsDetail,
  iterationsTooltip,
  succeededRunsDetail,
  succeededRunsTooltip,
  totalRunsDetail,
  totalRunsTooltip,
} from '../lib/statTooltips/iterate'
import { iterateLinks } from '../lib/statCardLinks'

const TABS: Array<{ id: IterateTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'PDCA pipeline posture — what is running, queued, failed, or idle on this project.',
  },
  {
    id: 'runs',
    label: 'Runs',
    description: 'All producer/critic loops — Trigger queued runs, abort active ones, open detail drawer.',
  },
  {
    id: 'new',
    label: 'New Run',
    description: 'Queue a target URL with critic persona, score target, and iteration cap.',
  },
]

function resolveIterateTab(value: string | null): IterateTabId {
  if (value === 'runs' || value === 'new') return value
  return 'overview'
}

export function IteratePage() {
  const copy = usePageCopy('/iterate')
  const ux = useIterateUx()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveIterateTab(searchParams.get('tab'))
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const toast = useToast()

  const [selectedRun, setSelectedRun] = useState<PdcaRun | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<IterateStats>('/v1/admin/pdca/stats')
  const stats = { ...EMPTY_ITERATE_STATS, ...statsData }

  const listPath =
    activeProjectId && activeTab === 'runs' ? `/v1/admin/pdca?project_id=${activeProjectId}&limit=50` : null

  const {
    data: runs,
    loading: runsLoading,
    error: runsError,
    reload: reloadRuns,
    lastFetchedAt: runsFetchedAt,
    isValidating: runsValidating,
  } = usePageData<PdcaRun[]>(listPath, { deps: [activeProjectId, activeTab] })

  const runList = runs ?? []
  const activeRuns = runList.filter((r) => r.status === 'running' || r.status === 'queued')

  const reloadAll = useCallback(() => {
    reloadStats()
    reloadRuns()
  }, [reloadStats, reloadRuns])

  useRealtimeReload(['pdca_runs', 'pdca_iterations'], reloadAll)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    const hasActive = stats.running + stats.queued > 0 || activeRuns.length > 0
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(reloadAll, 4000)
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [stats.running, stats.queued, activeRuns.length, reloadAll])

  const setActiveTab = useCallback(
    (tab: IterateTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'overview') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  usePublishPageContext({
    route: '/iterate',
    title: projectName ? `Iterate · ${projectName}` : 'Iterate',
    summary: statsLoading
      ? 'Loading PDCA…'
      : stats.running + stats.queued > 0
        ? `${stats.running + stats.queued} active run${stats.running + stats.queued === 1 ? '' : 's'}`
        : stats.total === 0
          ? 'No runs yet'
          : `${stats.succeeded} succeeded · avg ${stats.avgFinalScorePct ?? 0}%`,
    criticalCount: stats.running + stats.queued,
  })

  const tabOptions = useMemo(
    () =>
      TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'runs' && stats.total > 0
            ? stats.total
            : t.id === 'runs' && stats.queued + stats.running > 0
              ? stats.queued + stats.running
              : undefined,
      })),
    [copy?.tabLabels, stats.total, stats.queued, stats.running],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickIterateTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const openDetail = useCallback(
    async (run: PdcaRun) => {
      const res = await apiFetch<PdcaRun>(`/v1/admin/pdca/${run.id}`)
      if (res.ok && res.data) {
        setSelectedRun(res.data)
        setDrawerOpen(true)
      } else {
        toast.error('Failed to load run', res.error?.message)
      }
    },
    [toast],
  )

  const abortRun = useCallback(
    async (runId: string) => {
      const res = await apiFetch(`/v1/admin/pdca/${runId}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error(res.error?.message ?? 'Abort failed')
        return
      }
      reloadAll()
      toast.success('Run aborted')
    },
    [reloadAll, toast],
  )

  const triggerRun = useCallback(
    async (runId: string) => {
      const res = await apiFetch(`/v1/admin/pdca/${runId}/trigger`, { method: 'POST' })
      if (res.ok) {
        toast.success('Runner triggered')
        reloadAll()
      } else {
        toast.error(res.error?.message ?? 'Trigger failed')
      }
    },
    [reloadAll, toast],
  )

  const refreshSelectedRun = useCallback(async () => {
    if (!selectedRun) return
    const res = await apiFetch<PdcaRun>(`/v1/admin/pdca/${selectedRun.id}`)
    if (res.ok && res.data) setSelectedRun(res.data)
  }, [selectedRun])

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading iterate">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised/40" />
          ))}
        </div>
      </div>
    )
  }

  if (statsError) {
    return <ErrorAlert message={`Failed to load PDCA stats: ${statsError}`} onRetry={reloadStats} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'last_failed'
        ? 'danger'
        : stats.topPriority === 'active_runs'
          ? 'warn'
          : stats.topPriority === 'queued_waiting' || stats.topPriority === 'no_runs'
            ? 'brand'
            : 'ok'

  const headerBadge =
    !stats.hasAnyProject
      ? 'NO PROJECT'
      : stats.running > 0
        ? `${stats.running} RUNNING`
        : stats.queued > 0
          ? `${stats.queued} QUEUED`
          : stats.total === 0
            ? 'EMPTY'
            : stats.failed > 0 && stats.succeeded === 0
              ? 'FAILED'
              : 'IDLE'

  return (
    <div className="space-y-4" data-testid="mushi-page-iterate">
      <PageHelp
        title={copy?.help?.title ?? 'About PDCA iteration'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Each run fetches a live page, generates improved markup (producer), then scores it with an LLM critic persona until target score or max iterations.'
        }
        useCases={
          copy?.help?.useCases ?? [
            "Improve a dashboard page's visual hierarchy automatically",
            'Run a WCAG accessibility critique cycle on a live URL',
            'Use a conversion persona to suggest CTA and copy improvements',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Queue a run on New Run. Click Trigger on queued rows (Runs tab). Open a run for score timeline and critique export.'
        }
      />

      <PageHeader
        title={copy?.title ?? 'Iterate'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        contextChip={<PdcaContextHint stage="act" />}
      >
        {!ux.hideOverviewChrome && (
          <>
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'danger'
                ? 'bg-danger/10 text-danger'
                : bannerSeverity === 'warn'
                  ? 'bg-warn/10 text-warn'
                  : bannerSeverity === 'brand'
                    ? 'bg-brand/15 text-brand'
                    : 'bg-surface-overlay text-fg-muted'
          }
        >
          {headerBadge}
        </Badge>
        <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || runsValidating}>
          Refresh
        </Btn>
        <Btn
          size="sm"
          variant="primary"
          onClick={() => setActiveTab('new')}
          disabled={!activeProjectId}
          title={!activeProjectId ? 'Select a project first' : undefined}
        >
          + New Run
        </Btn>
          </>
        )}
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            'Banner + PDCA SNAPSHOT — Overview for posture, Runs to trigger/abort, New Run to queue loops.'}
        </p>
      </ContainedBlock>

      <IterateStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadAll}
        refreshing={statsValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl<IterateTabId>
        size="sm"
        ariaLabel="Iterate sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!ux.hideIterateSnapshot && (
      <Section
        title={copy?.sections?.snapshot ?? 'PDCA SNAPSHOT'}
        freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      >
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeTabMeta.description}</p>
        </ContainedBlock>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label={copy?.statLabels?.total ?? 'Total runs'} value={stats.total} accent={stats.total > 0 ? 'text-brand' : undefined} tooltip={totalRunsTooltip(stats)} detail={totalRunsDetail()} to={iterateLinks.total} />
          <StatCard
            label={copy?.statLabels?.active ?? 'Active'}
            value={stats.running + stats.queued}
            accent={stats.running + stats.queued > 0 ? 'text-warn' : undefined}
            tooltip={activeRunsTooltip(stats)}
            detail={activeRunsDetail(stats)}
            to={iterateLinks.active}
          />
          <StatCard label={copy?.statLabels?.succeeded ?? 'Succeeded'} value={stats.succeeded} accent={stats.succeeded > 0 ? 'text-ok' : undefined} tooltip={succeededRunsTooltip(stats)} detail={succeededRunsDetail()} to={iterateLinks.succeeded} />
          <StatCard label={copy?.statLabels?.failed ?? 'Failed'} value={stats.failed} accent={stats.failed > 0 ? 'text-danger' : undefined} tooltip={failedRunsTooltip(stats)} detail={failedRunsDetail()} to={iterateLinks.failed} />
          <StatCard
            label={copy?.statLabels?.avgScore ?? 'Avg score'}
            value={stats.avgFinalScorePct != null ? `${stats.avgFinalScorePct}%` : '—'}
            accent={stats.avgFinalScorePct != null && stats.avgFinalScorePct >= 70 ? 'text-ok' : stats.avgFinalScorePct != null ? 'text-warn' : undefined}
            tooltip={avgScoreTooltip(stats)}
            detail={avgScoreDetail(stats)}
            to={iterateLinks.avgScore}
          />
          <StatCard
            label={copy?.statLabels?.iterations ?? 'Iterations'}
            value={stats.totalIterations}
            accent={stats.totalIterations > 0 ? 'text-info' : undefined}
            tooltip={iterationsTooltip(stats)}
            detail={iterationsDetail()}
            to={iterateLinks.iterations}
          />
        </div>
      </Section>
      )}

      {!ux.hideOverviewChrome && stats.topPriority !== 'healthy' && stats.topPriorityTo && activeTab === 'overview' ? (
        <Card
          className={`space-y-3 p-4 ${
            stats.topPriority === 'last_failed'
              ? 'border-danger/30 bg-danger/5'
              : stats.topPriority === 'active_runs'
                ? 'border-warn/30 bg-warn/5'
                : 'border-brand/30 bg-brand/5'
          }`}
        >
          <SignalChip
            tone={
              stats.topPriority === 'last_failed'
                ? 'danger'
                : stats.topPriority === 'active_runs'
                  ? 'warn'
                  : 'brand'
            }
          >
            Needs attention
          </SignalChip>
          <ContainedBlock tone={stats.topPriority === 'last_failed' ? 'warn' : 'info'}>
            <p className="text-xs font-medium leading-snug text-fg">{stats.topPriorityLabel}</p>
          </ContainedBlock>
          <ActionPillRow>
            <ActionPill to={stats.topPriorityTo} tone="brand">
              Take action →
            </ActionPill>
          </ActionPillRow>
        </Card>
      ) : null}

      {!activeProjectId ? (
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="PDCA runs are scoped to the active project in the header."
        />
      ) : (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {!ux.hideOverviewChrome && stats.topPriority === 'healthy' && (
                <RecommendedAction
                  tone="success"
                  title="PDCA pipeline idle"
                  description={stats.topPriorityLabel ?? `${stats.succeeded} succeeded runs on ${stats.projectName ?? 'project'}.`}
                  cta={{ label: 'View runs', to: '/iterate?tab=runs' }}
                />
              )}
              {!ux.hideOverviewChrome && stats.topPriority === 'no_runs' && (
                <RecommendedAction
                  tone="info"
                  title="Queue your first PDCA run"
                  description={stats.topPriorityLabel ?? 'Pick a target URL and critic persona to start the producer/critic loop.'}
                  cta={{ label: 'New Run', to: '/iterate?tab=new' }}
                />
              )}
              {!ux.hideOverviewChrome && stats.topPriority === 'queued_waiting' && (
                <RecommendedAction
                  tone="info"
                  title="Queued runs need Trigger"
                  description={stats.topPriorityLabel ?? `${stats.queued} run(s) waiting — pdca-runner does not auto-start unless cron picks them up.`}
                  cta={{ label: 'Open Runs', to: '/iterate?tab=runs' }}
                />
              )}
              {!ux.hideOverviewChrome && stats.topPriority === 'active_runs' && (
                <RecommendedAction
                  tone="info"
                  title="Runs in progress"
                  description={stats.topPriorityLabel ?? 'This page auto-refreshes every 4s while runs are active.'}
                  cta={{ label: 'View progress', to: '/iterate?tab=runs' }}
                />
              )}
              {!ux.hideOverviewChrome && stats.topPriority === 'last_failed' && (
                <RecommendedAction
                  tone="urgent"
                  title="Inspect the failed run"
                  description={stats.topPriorityLabel ?? 'Open the run drawer for iteration-level critique, then queue a new run.'}
                  cta={{ label: 'View runs', to: '/iterate?tab=runs' }}
                />
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <Card className="space-y-2 border-edge p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Queued</p>
                    <SignalChip tone={stats.queued > 0 ? 'warn' : 'neutral'}>
                      {stats.queued > 0 ? 'Needs trigger' : 'Clear'}
                    </SignalChip>
                  </div>
                  <p className="text-lg font-semibold tabular-nums text-fg-primary">{stats.queued}</p>
                  <InlineProof>Needs manual Trigger on Runs tab</InlineProof>
                </Card>
                <Card className="space-y-2 border-edge p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Running</p>
                    <SignalChip
                      tone={stats.running > 0 ? 'brand' : 'neutral'}
                      className={stats.running > 0 ? 'motion-safe:animate-pulse' : undefined}
                    >
                      {stats.running > 0 ? 'In flight' : 'Idle'}
                    </SignalChip>
                  </div>
                  <p className="text-lg font-semibold tabular-nums text-warn">{stats.running}</p>
                  <InlineProof>Producer → critic loop active</InlineProof>
                </Card>
                <Card className="space-y-2 border-edge p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Aborted</p>
                    <SignalChip tone={stats.aborted > 0 ? 'warn' : 'neutral'}>
                      {stats.aborted > 0 ? 'Stopped' : 'None'}
                    </SignalChip>
                  </div>
                  <p className="text-lg font-semibold tabular-nums text-fg-muted">{stats.aborted}</p>
                  <InlineProof>Stopped before completion</InlineProof>
                </Card>
              </div>

              {stats.lastRunAt && (
                <ContainedBlock tone="muted">
                  <p className="text-2xs leading-relaxed text-fg-muted">
                    Last run queued <RelativeTime value={stats.lastRunAt} />
                    {stats.daysSinceLastRun != null && stats.daysSinceLastRun > 0
                      ? ` (${stats.daysSinceLastRun}d ago)`
                      : null}
                  </p>
                </ContainedBlock>
              )}
              {stats.lastFailedUrl && (
                <ContainedBlock tone="warn">
                  <p className="truncate text-2xs leading-relaxed text-danger" title={stats.lastFailedUrl}>
                    Latest failure: {stats.lastFailedUrl}
                    {stats.lastFailedAt ? (
                      <>
                        {' '}
                        · <RelativeTime value={stats.lastFailedAt} />
                      </>
                    ) : null}
                  </p>
                </ContainedBlock>
              )}
            </div>
          )}

          {activeTab === 'runs' && (
            <>
              {runsLoading && (
                <TableSkeleton rows={5} showFilters={false} label="Loading PDCA runs" />
              )}
              {runsError && (
                <ErrorAlert message={`Failed to load runs: ${runsError}`} onRetry={reloadRuns} />
              )}
              {!runsLoading && !runsError && (
                <Section title="Run history" freshness={{ at: runsFetchedAt, isValidating: runsValidating }}>
                  <PdcaRunTable
                    runs={runList}
                    projectName={stats.projectName ?? projectName}
                    onOpen={(r) => void openDetail(r)}
                    onAbort={(id) => void abortRun(id)}
                    onTrigger={(id) => void triggerRun(id)}
                  />
                </Section>
              )}
            </>
          )}

          {activeTab === 'new' && (
            <Section title="Queue new run">
              <NewRunForm
                projectId={activeProjectId}
                projectName={stats.projectName ?? projectName}
                onCreated={() => {
                  setActiveTab('runs')
                  reloadAll()
                }}
              />
            </Section>
          )}
        </>
      )}

      {drawerOpen && selectedRun && (
        <PdcaRunDrawer
          run={selectedRun}
          open={drawerOpen}
          onClose={() => {
            setDrawerOpen(false)
            setSelectedRun(null)
          }}
          onAbort={(id) => void abortRun(id)}
          onTrigger={(id) => void triggerRun(id)}
          onRefresh={() => void refreshSelectedRun()}
        />
      )}
    </div>
  )
}
