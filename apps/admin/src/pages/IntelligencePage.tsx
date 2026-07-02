/**
 * FILE: apps/admin/src/pages/IntelligencePage.tsx
 * PURPOSE: V5.3 §2.16 — banner + INTELLIGENCE SNAPSHOT + tabs:
 *          Overview | Reports | Pipeline.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, apiFetchRaw } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageCopy } from '../lib/copy'
import { useIntelligenceUx, resolveQuickIntelligenceTab } from '../lib/intelligenceModeUx'
import { SetupNudge } from '../components/SetupNudge'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Card,
  Btn,
  Badge,
  ErrorAlert,
  EmptyState,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction,
  ProseBlock,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import {
  ActiveJobCard,
  LastFailureNote,
  RecentJobsList,
} from '../components/intelligence/IntelligenceJobs'
import { IntelligenceStatusBanner } from '../components/intelligence/IntelligenceStatusBanner'
import { IntelligenceSnapshotStrip } from '../components/intelligence/IntelligenceSnapshotStrip'
import {
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import {
  EMPTY_INTELLIGENCE_STATS,
  type IntelligenceStats,
  type IntelligenceTabId,
} from '../components/intelligence/IntelligenceStatsTypes'
import { BenchmarkOptInCard } from '../components/intelligence/BenchmarkOptInCard'
import { ModernizationFindings } from '../components/intelligence/ModernizationFindings'
import { IntelligenceReportCard } from '../components/intelligence/IntelligenceReportCard'
import { usePublishPageContext } from '../lib/pageContext'
import { useEntitlements } from '../lib/useEntitlements'
import { UpgradePrompt } from '../components/billing/UpgradePrompt'
import { IconIntelligence } from '../components/icons'
import type {
  BenchmarkSettings,
  IntelligenceJob,
  IntelligenceReport,
  ModernizationFinding,
} from '../components/intelligence/types'
import { CHIP_TONE } from '../lib/chipTone'

const TABS: Array<{ id: IntelligenceTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture banner, this week\'s narrative, benchmarking opt-in, and generation status.',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Archived weekly digests with stats and exportable HTML summaries.',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'Generation job history and pending library modernization findings.',
  },
]

function resolveIntelligenceTab(value: string | null): IntelligenceTabId {
  if (value === 'reports' || value === 'pipeline') return value
  return 'overview'
}

export function IntelligencePage() {
  const copy = usePageCopy('/intelligence')
  const ux = useIntelligenceUx()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveIntelligenceTab(searchParams.get('tab'))
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const toast = useToast()
  const entitlements = useEntitlements()
  const intelligenceUnlocked = entitlements.has('intelligence_reports')

  const [generating, setGenerating] = useState(false)
  const [benchmark, setBenchmark] = useState<BenchmarkSettings>({ optIn: false, optInAt: null })
  const [dispatchingId, setDispatchingId] = useState<string | null>(null)

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<IntelligenceStats>('/v1/admin/intelligence/stats')
  usePublishPageHeroStats('/intelligence', statsData)
  const stats = { ...EMPTY_INTELLIGENCE_STATS, ...statsData }

  const reportsPath = activeProjectId && (activeTab === 'reports' || activeTab === 'overview') ? '/v1/admin/intelligence' : null
  const jobsPath = activeProjectId && (activeTab === 'overview' || activeTab === 'pipeline') ? '/v1/admin/intelligence/jobs' : null
  const findingsPath = activeProjectId && (activeTab === 'overview' || activeTab === 'pipeline') ? '/v1/admin/modernization?status=pending' : null

  const {
    data: reportsPayload,
    loading: reportsLoading,
    error: reportsError,
    reload: reloadReports,
    isValidating: reportsValidating,
  } = usePageData<{ reports: IntelligenceReport[] }>(reportsPath, { deps: [activeProjectId, activeTab] })

  const {
    data: jobsPayload,
    loading: jobsLoading,
    error: jobsError,
    reload: reloadJobs,
    isValidating: jobsValidating,
  } = usePageData<{ jobs: IntelligenceJob[] }>(jobsPath, { deps: [activeProjectId, activeTab] })

  const {
    data: findingsPayload,
    loading: findingsLoading,
    error: findingsError,
    reload: reloadFindings,
  } = usePageData<{ findings: ModernizationFinding[] }>(findingsPath, { deps: [activeProjectId, activeTab] })

  const { data: settingsPayload } = usePageData<{
    benchmarking_optin?: boolean
    benchmarking_optin_at?: string | null
  }>('/v1/admin/settings')

  useEffect(() => {
    if (settingsPayload) {
      setBenchmark({
        optIn: settingsPayload.benchmarking_optin === true,
        optInAt: settingsPayload.benchmarking_optin_at ?? null,
      })
    }
  }, [settingsPayload])

  const reloadAll = useCallback(() => {
    reloadStats()
    reloadReports()
    reloadJobs()
    reloadFindings()
  }, [reloadStats, reloadReports, reloadJobs, reloadFindings])

  useRealtimeReload(
    ['intelligence_reports', 'intelligence_generation_jobs', 'modernization_findings'],
    reloadAll,
  )

  const reports = reportsPayload?.reports ?? []
  const jobs = jobsPayload?.jobs ?? []
  const findings = findingsPayload?.findings ?? []

  const activeJob = jobs.find((j) => j.status === 'queued' || j.status === 'running') ?? null
  const recentJobs = jobs.slice(0, 8)

  const setActiveTab = useCallback(
    (tab: IntelligenceTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'overview') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickIntelligenceTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  useEffect(() => {
    if (!activeJob) return
    const id = window.setInterval(() => {
      reloadJobs()
      reloadReports()
      reloadStats()
    }, 3000)
    return () => clearInterval(id)
  }, [activeJob, reloadJobs, reloadReports, reloadStats])

  const generateNow = useCallback(async () => {
    if (!activeProjectId) {
      toast.error('Select a project first')
      return
    }
    setGenerating(true)
    try {
      const res = await apiFetch<{ jobId: string; deduplicated?: boolean }>(
        '/v1/admin/intelligence',
        { method: 'POST' },
      )
      if (res.ok && res.data) {
        if (res.data.deduplicated) {
          toast.push({ tone: 'info', message: 'A generation job is already running for this project' })
        } else {
          toast.push({ tone: 'success', message: 'Generation started — watch Pipeline for progress' })
        }
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Failed to enqueue job' })
      }
      reloadAll()
    } finally {
      setGenerating(false)
    }
  }, [activeProjectId, reloadAll, toast])

  const cancelJob = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/intelligence/jobs/${id}/cancel`, { method: 'POST' })
    if (res.ok) {
      toast.push({ tone: 'info', message: 'Job cancelled' })
      reloadAll()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Cancel failed' })
    }
  }, [reloadAll, toast])

  const dispatchFinding = useCallback(async (id: string) => {
    setDispatchingId(id)
    try {
      const res = await apiFetch<{ dispatchId: string }>(
        `/v1/admin/modernization/${id}/dispatch`,
        { method: 'POST' },
      )
      if (res.ok) {
        toast.push({ tone: 'success', message: 'Modernization fix dispatched — track on Fixes' })
        reloadFindings()
        reloadStats()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Dispatch failed' })
      }
    } finally {
      setDispatchingId(null)
    }
  }, [reloadFindings, reloadStats, toast])

  const dismissFinding = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/modernization/${id}/dismiss`, { method: 'POST' })
    if (res.ok) {
      toast.push({ tone: 'info', message: 'Finding dismissed' })
      reloadFindings()
      reloadStats()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Dismiss failed' })
    }
  }, [reloadFindings, reloadStats, toast])

  const toggleOptIn = useCallback(async (next: boolean) => {
    const prev = benchmark
    setBenchmark({ optIn: next, optInAt: next ? new Date().toISOString() : null })
    const res = await apiFetch('/v1/admin/settings/benchmarking', {
      method: 'PUT',
      body: JSON.stringify({ optIn: next }),
    })
    if (!res.ok) {
      setBenchmark(prev)
      toast.push({ tone: 'error', message: 'Failed to update benchmarking opt-in' })
    } else {
      toast.push({
        tone: 'success',
        message: next ? 'Benchmarking opted in' : 'Benchmarking opted out',
      })
      reloadStats()
    }
  }, [benchmark, reloadStats, toast])

  const downloadPdf = useCallback(async (id: string, weekStart: string) => {
    try {
      const res = await apiFetchRaw(`/v1/admin/intelligence/${id}/html`)
      if (!res.ok) {
        toast.push({ tone: 'error', message: `Failed to load report (${res.status})` })
        return
      }
      const html = await res.text()
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank')
      if (!win) {
        const a = document.createElement('a')
        a.href = url
        a.download = `bug-intelligence-${weekStart}.html`
        a.click()
      } else {
        win.addEventListener('load', () => setTimeout(() => win.print(), 200))
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      toast.push({ tone: 'error', message: `Could not open report: ${String(e)}` })
    }
  }, [toast])

  const tabOptions = useMemo(
    () =>
      TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'reports' && stats.reportCount > 0
            ? stats.reportCount
            : t.id === 'pipeline' && (stats.pendingFindings > 0 || stats.activeJobCount > 0)
              ? stats.pendingFindings + stats.activeJobCount
              : undefined,
      })),
    [copy?.tabLabels, stats.reportCount, stats.pendingFindings, stats.activeJobCount],
  )

  usePublishPageContext({
    route: '/intelligence',
    title: projectName ? `Intelligence · ${projectName}` : 'Intelligence',
    summary: statsLoading
      ? 'Loading intelligence…'
      : stats.activeJobCount > 0
        ? 'Digest generation running'
        : stats.reportCount === 0
          ? 'No digests yet'
          : `${stats.reportCount} digest${stats.reportCount === 1 ? '' : 's'} on file`,
    criticalCount: stats.pendingFindings + stats.activeJobCount,
  })

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading intelligence">
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
    return <ErrorAlert message={`Failed to load intelligence stats: ${statsError}`} onRetry={reloadStats} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'job_failed'
        ? 'danger'
        : stats.topPriority === 'job_running'
          ? 'brand'
          : stats.topPriority === 'feature_locked' || stats.topPriority === 'stale_digest' || stats.topPriority === 'pending_findings'
            ? 'warn'
            : stats.topPriority === 'no_reports'
              ? 'brand'
              : 'ok'

  const latestForOverview = reports[0] ?? null

  return (
    <div className="space-y-4" data-testid="mushi-page-intelligence">
      <PageHeaderBar
        title={copy?.title ?? 'Bug Intelligence'}
        projectScope={stats.projectName ?? projectName ?? undefined}

        helpTitle={copy?.help?.title ?? 'About Bug Intelligence'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'Weekly LLM-authored digest of your bug pipeline — trends, fix velocity, hotspots, and recommendations.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Share a one-page status with stakeholders every Monday',
          'Spot regressions early — week-over-week category and severity drift',
          'Compare fix velocity against anonymised industry benchmarks (opt-in)',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Reports generate automatically every Monday by cron. Click Generate to run for the current project — Pipeline shows live status.'}
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
                        ? 'border border-edge-subtle bg-surface-raised text-fg-secondary'
                        : 'bg-surface-overlay text-fg-muted'
              }
            >
              {!stats.hasAnyProject
                ? 'NO PROJECT'
                : stats.activeJobCount > 0
                  ? 'RUNNING'
                  : stats.topPriority === 'job_failed'
                    ? 'FAILED'
                    : stats.reportCount === 0
                      ? 'EMPTY'
                      : `${stats.reportCount} DIGEST${stats.reportCount === 1 ? '' : 'S'}`}
            </Badge>
            <FreshnessPill at={statsFetchedAt} isValidating={statsValidating} />
            <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || reportsValidating || jobsValidating}>
              Refresh
            </Btn>
            <Btn
              size="sm"
              variant="primary"
              onClick={() => void generateNow()}
              disabled={
                !activeProjectId ||
                generating ||
                stats.activeJobCount > 0 ||
                (!intelligenceUnlocked && !entitlements.loading)
              }
              loading={generating || stats.activeJobCount > 0}
              leadingIcon={<IconIntelligence className="h-3.5 w-3.5" aria-hidden="true" />}
              title={
                !activeProjectId
                  ? 'Select a project first'
                  : !intelligenceUnlocked && !entitlements.loading
                    ? 'Locked on your current plan'
                    : undefined
              }
            >
              {stats.activeJobCount > 0 ? 'Generating…' : 'Generate this week'}
            </Btn>
          </>
        )}
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <IntelligenceStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onRefresh={reloadAll}
                refreshing={statsValidating}
                onGenerate={() => void generateNow()}
                generating={generating}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideIntelligenceSnapshot,
            children: (
              <IntelligenceSnapshotStrip
                stats={stats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'INTELLIGENCE SNAPSHOT'}
                hint={activeTabMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
        ]}
      />

      {!intelligenceUnlocked && !entitlements.loading && (
        <UpgradePrompt flag="intelligence_reports" currentPlan={entitlements.planName} />
      )}

      {!ux.hideTabs && (
      <SegmentedControl<IntelligenceTabId>
        size="sm"
        scrollable
        ariaLabel="Intelligence sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!activeProjectId ? (
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Intelligence digests, jobs, and modernization findings are scoped to the active project. Pick one in the header."
        />
      ) : (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {!ux.hideOverviewChrome && (
              <>
              {stats.topPriority === 'healthy' && (
                <RecommendedAction
                  tone="success"
                  title="Intelligence pipeline healthy"
                  description={stats.topPriorityLabel ?? `${stats.reportCount} digests archived with reporter trend analysis.`}
                />
              )}
              {stats.topPriority === 'job_failed' && (
                <RecommendedAction
                  tone="urgent"
                  title="Fix generation before retrying"
                  description={stats.lastJobError ?? 'Check BYOK LLM keys in Settings, then retry generation.'}
                  cta={{ label: 'Open Pipeline', to: '/intelligence?tab=pipeline' }}
                />
              )}
              {(stats.topPriority === 'no_reports' || stats.topPriority === 'stale_digest') && (
                <RecommendedAction
                  tone="info"
                  title="Generate a weekly digest"
                  description={stats.topPriorityLabel ?? 'AI summarizes report volume, fix velocity, and severity drift.'}
                  cta={{ label: 'Generate this week', to: '/intelligence?tab=overview' }}
                />
              )}
              {stats.topPriority === 'pending_findings' && (
                <RecommendedAction
                  tone="info"
                  title="Triage modernization findings"
                  description={stats.topPriorityLabel ?? 'Dispatch dependency upgrades or dismiss false positives.'}
                  cta={{ label: 'Open Pipeline', to: '/intelligence?tab=pipeline' }}
                />
              )}
              </>
              )}

              <ThisWeekNarrative latest={latestForOverview} projectName={projectName} stats={stats} />

              {jobsLoading ? (
                <TableSkeleton rows={2} columns={3} showFilters={false} label="Loading job status" />
              ) : (
                <>
                  {activeJob && (
                    <ActiveJobCard job={activeJob} onCancel={() => void cancelJob(activeJob.id)} />
                  )}
                  {!activeJob && (
                    <LastFailureNote
                      jobs={recentJobs}
                      onRetry={() => void generateNow()}
                      retrying={generating}
                    />
                  )}
                </>
              )}

              <BenchmarkOptInCard benchmark={benchmark} onToggle={(v) => void toggleOptIn(v)} />
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-3">
              {reportsLoading ? (
                <TableSkeleton rows={4} columns={4} showFilters={false} label="Loading reports" />
              ) : reportsError ? (
                <ErrorAlert message={reportsError} onRetry={reloadReports} />
              ) : reports.length === 0 ? (
                <EmptyState
                  title="No intelligence reports yet"
                  description={
                    projectName
                      ? `No digests archived for ${projectName}. Generate this week or wait for Monday cron.`
                      : 'Generate a weekly digest to see archived reports here.'
                  }
                  hints={[
                    'Each digest includes report volume, fix velocity, and AI narrative',
                    'Open / Print PDF exports via the browser print dialog',
                    'Benchmark comparison requires opt-in on Overview',
                  ]}
                  action={
                    <Btn
                      size="sm"
                      variant="primary"
                      onClick={() => void generateNow()}
                      disabled={generating || stats.activeJobCount > 0 || !intelligenceUnlocked}
                      loading={generating}
                    >
                      Generate this week
                    </Btn>
                  }
                />
              ) : (
                reports.map((r) => (
                  <IntelligenceReportCard
                    key={r.id}
                    report={r}
                    onDownload={() => void downloadPdf(r.id, r.week_start)}
                  />
                ))
              )}
            </div>
          )}

          {activeTab === 'pipeline' && (
            <div className="space-y-4">
              {findingsError && <ErrorAlert message={findingsError} onRetry={reloadFindings} />}
              <ModernizationFindings
                findings={findings}
                dispatchingId={dispatchingId}
                projectName={projectName}
                loading={findingsLoading}
                onDispatch={(id) => void dispatchFinding(id)}
                onDismiss={(id) => void dismissFinding(id)}
              />
              <RecentJobsList jobs={recentJobs} projectName={projectName} loading={jobsLoading} />
              {jobsError && <ErrorAlert message={jobsError} onRetry={reloadJobs} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface ThisWeekNarrativeProps {
  latest: IntelligenceReport | null
  projectName: string | null
  stats: IntelligenceStats
}

function ThisWeekNarrative({ latest, projectName, stats }: ThisWeekNarrativeProps) {
  if (!latest && stats.reportCount === 0) {
    return (
      <Card className="space-y-3 p-4">
        <SignalChip tone="brand">This week</SignalChip>
        <EmptySectionMessage
          text={
            projectName
              ? `No intelligence digest for ${projectName} yet.`
              : 'No intelligence digest yet.'
          }
          hint="Monday cron writes automatically, or use Generate this week for an immediate run."
        />
        {stats.lastJobStatus === 'failed' && stats.lastJobError && (
          <ContainedBlock tone="warn">
            <p className="text-2xs text-danger">Last job failed: {stats.lastJobError}</p>
          </ContainedBlock>
        )}
      </Card>
    )
  }

  if (!latest?.summary_md) {
    return (
      <Card className="space-y-3 border border-brand/30 bg-surface-raised p-4">
        <SignalChip tone="brand">
          {latest?.week_start ? `Week of ${latest.week_start}` : 'Latest digest'}
        </SignalChip>
        <InlineProof>Digest archived — open Reports tab for full narrative and export.</InlineProof>
      </Card>
    )
  }

  return (
    <Card className="border border-brand/30 bg-surface-raised p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand">Week of {latest.week_start}</h3>
        {latest.llm_model && (
          <SignalChip tone="brand" className="font-mono">
            {latest.llm_model}
          </SignalChip>
        )}
      </div>
      <ContainedBlock tone="muted" className="mt-2">
        <ProseBlock value={latest.summary_md} mode="excerpt" tone="muted" />
      </ContainedBlock>
    </Card>
  )
}
