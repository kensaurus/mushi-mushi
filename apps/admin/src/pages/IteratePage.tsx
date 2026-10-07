/**
 * FILE: apps/admin/src/pages/IteratePage.tsx
 * PURPOSE: Banner + PDCA SNAPSHOT + tabs: Overview | Runs | New Run.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { pdcaRunsFromEnvelope, type PdcaRunsEnvelope } from '../lib/pdcaRuns'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageCopy } from '../lib/copy'
import { useIterateUx, resolveQuickIterateTab } from '../lib/iterateModeUx'
import { useQuickstartLandingTab } from '../lib/useQuickstartTab'
import { NextStep } from '../components/NextStep'
import { useToast } from '../lib/toast'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Card,
  Section,
  Btn,
  Badge,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction,
  RelativeTime, } from '../components/ui'
import {
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PdcaContextHint } from '../components/PdcaContextHint'
import { IterateStatusBanner } from '../components/iterate/IterateStatusBanner'
import { IterateSnapshotStrip } from '../components/iterate/IterateSnapshotStrip'
import { IterateReadout } from '../components/iterate/IterateReadout'
import { PdcaRunTable } from '../components/iterate/PdcaRunTable'
import { NewRunForm } from '../components/iterate/NewRunForm'
import { PdcaRunDrawer } from '../components/iterate/PdcaRunDrawer'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageLoadError } from '../components/PageLoadError'
import { ListPager } from '../components/ListPager'
import type { PdcaRun } from '../components/iterate/types'
import {
  EMPTY_ITERATE_STATS,
  type IterateStats,
  type IterateTabId,
} from '../components/iterate/IterateStatsTypes'
import { CHIP_TONE, HEADER_BADGE_TONE } from '../lib/chipTone'

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

/** Runs per page on the Runs tab (the list route allows up to 100). */
const RUNS_PAGE_SIZE = 50

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
  const [runsPage, setRunsPage] = useState(1)
  // Abort is irreversible: it goes through a confirm dialog (console QA 21).
  const [abortTarget, setAbortTarget] = useState<PdcaRun | null>(null)
  // Runs with a Trigger or Abort request in flight, so a second click cannot
  // queue a second paid runner call.
  const [busyRunIds, setBusyRunIds] = useState<ReadonlySet<string>>(new Set())
  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyRunIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<IterateStats>('/v1/admin/pdca/stats')
  usePublishPageHeroStats('/iterate', statsData)
  const stats = { ...EMPTY_ITERATE_STATS, ...statsData }

  const listPath =
    activeProjectId && activeTab === 'runs'
      ? `/v1/admin/pdca?project_id=${activeProjectId}&limit=${RUNS_PAGE_SIZE}&page=${runsPage}`
      : null

  const {
    data: runs,
    loading: runsLoading,
    error: runsError,
    reload: reloadRuns,
    lastFetchedAt: runsFetchedAt,
    isValidating: runsValidating,
  } = usePageData<PdcaRunsEnvelope<PdcaRun>>(listPath, { deps: [activeProjectId, activeTab] })

  // The list route is flat-paginated and coerceApiResult re-nests it under
  // `data.data`. Reading the hook value as an array threw
  // `runs.filter is not a function` on every Runs-tab visit and, via the
  // route boundary, blanked the whole console (2026-09-23).
  const runsEnvelope = pdcaRunsFromEnvelope(runs)
  const runList = runsEnvelope.runs
  const runsTotal = runsEnvelope.total ?? runList.length

  useEffect(() => {
    setRunsPage(1)
  }, [activeProjectId])
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

  // Quick mode opens the posture tab once; links and clicks then win.
  useQuickstartLandingTab({
    enabled: ux.isQuickstart,
    ready: !statsLoading,
    tabParam: searchParams.get('tab'),
    activeTab: activeTab,
    quickTab: resolveQuickIterateTab(stats),
    setActiveTab: setActiveTab,
  })

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

  // After Abort or Trigger the open drawer must show the new state, not the
  // one it opened with (console QA 21: it kept "Running" and an enabled Abort).
  const refetchRun = useCallback(async (runId: string) => {
    const res = await apiFetch<PdcaRun>(`/v1/admin/pdca/${runId}`, { cache: 'no-store' })
    if (res.ok && res.data) setSelectedRun((cur) => (cur?.id === runId ? res.data! : cur))
  }, [])

  const requestAbort = useCallback(
    (runId: string) => {
      const run = runList.find((r) => r.id === runId) ?? (selectedRun?.id === runId ? selectedRun : null)
      if (run) setAbortTarget(run)
    },
    [runList, selectedRun],
  )

  const abortRun = useCallback(
    async (runId: string) => {
      markBusy(runId, true)
      try {
        const res = await apiFetch(`/v1/admin/pdca/${runId}`, { method: 'DELETE' })
        if (!res.ok) {
          toast.error("Couldn't abort this run", res.error?.message ?? 'Try again in a moment.')
          return
        }
        toast.success('Run aborted', 'No more iterations will start.')
        reloadAll()
        await refetchRun(runId)
      } finally {
        markBusy(runId, false)
        setAbortTarget(null)
      }
    },
    [markBusy, refetchRun, reloadAll, toast],
  )

  const triggerRun = useCallback(
    async (runId: string) => {
      if (busyRunIds.has(runId)) return
      markBusy(runId, true)
      try {
        const res = await apiFetch(`/v1/admin/pdca/${runId}/trigger`, { method: 'POST' })
        if (res.ok) {
          toast.success('Runner started', 'The first iteration is on its way.')
        } else {
          toast.error("Couldn't start this run", res.error?.message ?? 'Try again in a moment.')
        }
        reloadAll()
        await refetchRun(runId)
      } finally {
        markBusy(runId, false)
      }
    },
    [busyRunIds, markBusy, refetchRun, reloadAll, toast],
  )

  const refreshSelectedRun = useCallback(async () => {
    if (!selectedRun) return
    await refetchRun(selectedRun.id)
  }, [refetchRun, selectedRun])

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading iterate">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised" />
          ))}
        </div>
      </div>
    )
  }

  if (statsError) {
    return <PageLoadError error={statsError} resource="PDCA runs" onRetry={reloadStats} />
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
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-iterate">
      <PageHeaderBar
        title={copy?.title ?? 'Iterate'}
        projectScope={stats.projectName ?? projectName ?? undefined}

        contextChip={<PdcaContextHint stage="act" />}
        helpTitle={copy?.help?.title ?? 'About PDCA iteration'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Each run fetches a live page, generates improved markup (producer), then scores it with an LLM critic persona until target score or max iterations.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            "Improve a dashboard page's visual hierarchy automatically",
            'Run a WCAG accessibility critique cycle on a live URL',
            'Use a conversion persona to suggest CTA and copy improvements',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Queue a run on New Run. Click Trigger on queued rows (Runs tab). Open a run for score timeline and critique export.'
        }
      >
        {!ux.hideOverviewChrome && (
          <>
        <Badge
          className={
            bannerSeverity === 'ok'
              ? CHIP_TONE.okSubtle
              : bannerSeverity === 'danger'
                ? CHIP_TONE.dangerSubtle
                : bannerSeverity === 'warn'
                  ? CHIP_TONE.warnSubtle
                  : bannerSeverity === 'brand'
                    ? HEADER_BADGE_TONE.brand
                    : HEADER_BADGE_TONE.neutral
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
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <IterateStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onRefresh={reloadAll}
                refreshing={statsValidating}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideIterateSnapshot,
            children: (
              <IterateSnapshotStrip
                stats={stats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'PDCA SNAPSHOT'}
                hint={activeTabMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
        ]}
      />

      {!ux.hideTabs && (
      <SegmentedControl<IterateTabId>
        size="sm"
        scrollable
        ariaLabel="Iterate sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!activeProjectId ? (
        <NextStep
          variant="inline"
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="PDCA runs are scoped to the active project in the header."
        />
      ) : (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <IterateReadout
                stats={stats}
                fetchedAt={statsFetchedAt}
                isValidating={statsValidating}
              />
              {stats.topPriority === 'healthy' && (
                <RecommendedAction
                  tone="success"
                  title="PDCA pipeline idle"
                  description={stats.topPriorityLabel ?? `${stats.succeeded} succeeded runs on ${stats.projectName ?? 'project'}.`}
                  cta={{ label: 'View runs', to: '/iterate?tab=runs' }}
                />
              )}
              {stats.topPriority === 'no_runs' && (
                <RecommendedAction
                  tone="info"
                  title="Queue your first PDCA run"
                  description={stats.topPriorityLabel ?? 'Pick a target URL and critic persona to start the producer/critic loop.'}
                  cta={{ label: 'New Run', to: '/iterate?tab=new' }}
                />
              )}
              {stats.topPriority === 'queued_waiting' && (
                <RecommendedAction
                  tone="info"
                  title="Queued runs need Trigger"
                  description={stats.topPriorityLabel ?? `${stats.queued} run(s) waiting — pdca-runner does not auto-start unless cron picks them up.`}
                  cta={{ label: 'Open Runs', to: '/iterate?tab=runs' }}
                />
              )}
              {stats.topPriority === 'active_runs' && (
                <RecommendedAction
                  tone="info"
                  title="Runs in progress"
                  description={stats.topPriorityLabel ?? 'This page auto-refreshes every 4s while runs are active.'}
                  cta={{ label: 'View progress', to: '/iterate?tab=runs' }}
                />
              )}
              {stats.topPriority === 'last_failed' && (
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
                <PageLoadError error={runsError} resource="the run list" onRetry={reloadRuns} />
              )}
              {!runsLoading && !runsError && (
                <Section title="Run history" freshness={{ at: runsFetchedAt, isValidating: runsValidating }}>
                  <PdcaRunTable
                    runs={runList}
                    projectName={stats.projectName ?? projectName}
                    onOpen={(r) => void openDetail(r)}
                    onAbort={requestAbort}
                    onTrigger={(id) => void triggerRun(id)}
                    busyIds={busyRunIds}
                  />
                  <ListPager
                    page={runsPage}
                    pageSize={RUNS_PAGE_SIZE}
                    total={runsTotal}
                    noun="runs"
                    onPage={setRunsPage}
                    busy={runsValidating}
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
          onAbort={requestAbort}
          onTrigger={(id) => void triggerRun(id)}
          onRefresh={() => void refreshSelectedRun()}
          busy={busyRunIds.has(selectedRun.id)}
        />
      )}

      {abortTarget && (
        <ConfirmDialog
          title="Abort this PDCA run?"
          body={`Mushi stops the run on ${abortTarget.target_url} after the current step. Iterations already scored stay in history. An aborted run cannot be resumed: queue a new one to try again.`}
          confirmLabel="Abort run"
          cancelLabel="Keep running"
          tone="danger"
          loading={busyRunIds.has(abortTarget.id)}
          onConfirm={() => abortRun(abortTarget.id)}
          onCancel={() => {
            if (!busyRunIds.has(abortTarget.id)) setAbortTarget(null)
          }}
        />
      )}
    </div>
  )
}
