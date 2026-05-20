/**
 * FILE: apps/admin/src/pages/IntelligencePage.tsx
 * PURPOSE: V5.3 §2.16 — weekly LLM-authored bug intelligence digests.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, apiFetchRaw } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { SetupNudge } from '../components/SetupNudge'
import {
  PageHeader,
  PageHelp,
  Card,
  Section,
  Btn,
  ErrorAlert,
  EmptyState,
  StatCard,
  SegmentedControl,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import {
  ActiveJobCard,
  LastFailureNote,
  PipelineStatusBanner,
  RecentJobsList,
} from '../components/intelligence/IntelligenceJobs'
import { BenchmarkOptInCard } from '../components/intelligence/BenchmarkOptInCard'
import { ModernizationFindings } from '../components/intelligence/ModernizationFindings'
import { IntelligenceReportCard } from '../components/intelligence/IntelligenceReportCard'
import { PageActionBar } from '../components/PageActionBar'
import { useNextBestAction } from '../lib/useNextBestAction'
import { PageHero } from '../components/PageHero'
import type { OperatorTraceLine } from '../components/hero-flow/operatorTrace'
import { usePublishPageContext } from '../lib/pageContext'
import { useEntitlements } from '../lib/useEntitlements'
import { UpgradePrompt } from '../components/billing/UpgradePrompt'
import { IconSparkle } from '../components/icons'
import type {
  BenchmarkSettings,
  IntelligenceJob,
  IntelligenceReport,
  ModernizationFinding,
} from '../components/intelligence/types'

type TabId = 'overview' | 'reports' | 'pipeline'

const TABS: Array<{ id: TabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'This week\'s narrative, pipeline health, and benchmarking opt-in.',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Archived weekly digests with stats and exportable summaries.',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'Generation job history and pending library modernization findings.',
  },
]

function isTabId(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v)
}

export function IntelligencePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const activeTab: TabId = isTabId(param) ? param : 'overview'
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const toast = useToast()
  const entitlements = useEntitlements()
  const intelligenceUnlocked = entitlements.has('intelligence_reports')

  const [generating, setGenerating] = useState(false)
  const [benchmark, setBenchmark] = useState<BenchmarkSettings>({ optIn: false, optInAt: null })
  const [dispatchingId, setDispatchingId] = useState<string | null>(null)

  const reportsPath = activeProjectId ? '/v1/admin/intelligence' : null
  const jobsPath = activeProjectId ? '/v1/admin/intelligence/jobs' : null
  const findingsPath = activeProjectId ? '/v1/admin/modernization?status=pending' : null

  const {
    data: reportsPayload,
    loading: reportsLoading,
    error: reportsError,
    reload: reloadReports,
    lastFetchedAt,
    isValidating,
  } = usePageData<{ reports: IntelligenceReport[] }>(reportsPath, { deps: [activeProjectId] })

  const {
    data: jobsPayload,
    loading: jobsLoading,
    error: jobsError,
    reload: reloadJobs,
  } = usePageData<{ jobs: IntelligenceJob[] }>(jobsPath, { deps: [activeProjectId] })

  const {
    data: findingsPayload,
    loading: findingsLoading,
    reload: reloadFindings,
  } = usePageData<{ findings: ModernizationFinding[] }>(findingsPath, { deps: [activeProjectId] })

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
    reloadReports()
    reloadJobs()
    reloadFindings()
  }, [reloadReports, reloadJobs, reloadFindings])

  useRealtimeReload(
    ['intelligence_reports', 'intelligence_generation_jobs', 'modernization_findings'],
    reloadAll,
  )

  const reports = reportsPayload?.reports ?? []
  const jobs = jobsPayload?.jobs ?? []
  const findings = findingsPayload?.findings ?? []

  const activeJob = jobs.find((j) => j.status === 'queued' || j.status === 'running') ?? null
  const lastFailed = jobs.find((j) => j.status === 'failed') ?? null
  const recentJobs = jobs.slice(0, 8)

  const loading = reportsLoading || jobsLoading
  const fetchError = reportsError ?? jobsError

  useEffect(() => {
    if (!activeJob) return
    const id = window.setInterval(() => {
      reloadJobs()
      reloadReports()
    }, 3000)
    return () => clearInterval(id)
  }, [activeJob, reloadJobs, reloadReports])

  const setTab = useCallback((tab: TabId) => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'overview') next.delete('tab')
    else next.set('tab', tab)
    setSearchParams(next, { replace: true, preventScrollReset: true })
  }, [searchParams, setSearchParams])

  const generateNow = async () => {
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
          toast.push({ tone: 'success', message: 'Generation started — watch the progress card below' })
        }
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Failed to enqueue job' })
      }
      reloadAll()
    } finally {
      setGenerating(false)
    }
  }

  const cancelJob = async (id: string) => {
    const res = await apiFetch(`/v1/admin/intelligence/jobs/${id}/cancel`, { method: 'POST' })
    if (res.ok) {
      toast.push({ tone: 'info', message: 'Job cancelled' })
      reloadAll()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Cancel failed' })
    }
  }

  const dispatchFinding = async (id: string) => {
    setDispatchingId(id)
    try {
      const res = await apiFetch<{ dispatchId: string }>(
        `/v1/admin/modernization/${id}/dispatch`,
        { method: 'POST' },
      )
      if (res.ok) {
        toast.push({ tone: 'success', message: 'Modernization fix dispatched — track on Fixes' })
        reloadFindings()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Dispatch failed' })
      }
    } finally {
      setDispatchingId(null)
    }
  }

  const dismissFinding = async (id: string) => {
    const res = await apiFetch(`/v1/admin/modernization/${id}/dismiss`, { method: 'POST' })
    if (res.ok) {
      toast.push({ tone: 'info', message: 'Finding dismissed' })
      reloadFindings()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Dismiss failed' })
    }
  }

  const toggleOptIn = async (next: boolean) => {
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
    }
  }

  const downloadPdf = async (id: string, weekStart: string) => {
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
  }

  const lastDigestHoursAgo = reports[0]?.created_at
    ? Math.floor((Date.now() - new Date(reports[0].created_at).getTime()) / 3_600_000)
    : null

  usePublishPageContext({
    route: '/intelligence',
    title: `${activeMeta.label} · Intelligence`,
    summary: activeMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: findings.length,
  })

  const intelligenceAction = useNextBestAction({
    scope: 'intelligence',
    lastDigestHoursAgo,
    topCategory: null,
    weekReports: reports.length,
  })

  const intelligenceSeverity: 'ok' | 'info' | 'warn' =
    activeJob
      ? 'info'
      : lastDigestHoursAgo == null || lastDigestHoursAgo > 7 * 24
        ? 'warn'
        : findings.length > 0
          ? 'info'
          : 'ok'

  const tabOptions = useMemo(() => [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'reports' as const, label: 'Reports', count: reports.length },
    { id: 'pipeline' as const, label: 'Pipeline', count: findings.length + (activeJob ? 1 : 0) },
  ], [reports.length, findings.length, activeJob])

  const totalFixAttempts = reports.reduce((sum, r) => sum + (r.stats?.fixes?.total ?? 0), 0)

  const decideDebugLines: OperatorTraceLine[] = [
    {
      level: 'debug',
      source: 'pipeline',
      message: `reports=${reports.length} findings=${findings.length} fixAttempts=${totalFixAttempts}`,
    },
    ...(activeJob
      ? [
          {
            level: 'info' as const,
            source: 'job.active',
            message: `${activeJob.status} · ${activeJob.id.slice(0, 8)}…`,
            ts: activeJob.started_at ?? activeJob.created_at,
          },
          {
            level: 'debug' as const,
            source: 'job.trigger',
            message: activeJob.trigger,
          },
        ]
      : []),
    ...(lastFailed && !activeJob
      ? [
          {
            level: 'error' as const,
            source: 'job.last_fail',
            message: lastFailed.error ?? 'Generation failed',
            ts: lastFailed.finished_at ?? lastFailed.created_at,
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bug Intelligence"
        description="Aggregate signals across reports — hotspot components, regression patterns, and shifting severity trends."
      >
        <Btn
          variant="primary"
          onClick={() => void generateNow()}
          disabled={
            !activeProjectId ||
            generating ||
            !!activeJob ||
            (!intelligenceUnlocked && !entitlements.loading)
          }
          loading={generating || !!activeJob}
          leadingIcon={<IconSparkle className="h-3.5 w-3.5" aria-hidden="true" />}
          title={
            !activeProjectId
              ? 'Select a project first'
              : !intelligenceUnlocked && !entitlements.loading
                ? 'Locked on your current plan'
                : undefined
          }
        >
          {activeJob ? 'Generating…' : 'Generate this week'}
        </Btn>
      </PageHeader>

      <PageHero
        scope="intelligence"
        title="Bug Intelligence"
        kicker="Weekly LLM digest"
        decide={{
          label:
            lastDigestHoursAgo == null
              ? 'No digest yet'
              : lastDigestHoursAgo > 7 * 24
                ? `Last digest ${Math.floor(lastDigestHoursAgo / 24)}d ago`
                : `${reports.length} digest${reports.length === 1 ? '' : 's'} on file`,
          metric: findings.length > 0 ? `${findings.length} finding${findings.length === 1 ? '' : 's'}` : `${reports.length}`,
          summary:
            activeJob
              ? 'A digest job is running — results land in Reports when complete.'
              : lastDigestHoursAgo == null
                ? 'Generate the first digest to seed trend analysis.'
                : findings.length > 0
                  ? 'Modernization findings are waiting for triage in Pipeline.'
                  : 'This week\'s digest is fresh. Check hotspots and category drift.',
          severity: intelligenceSeverity,
          anchor: 'intelligence:decide',
          evidence: {
            kind: 'metric-breakdown',
            items: [
              { label: 'Digests', value: reports.length, tone: reports.length === 0 ? 'neutral' : 'ok' },
              { label: 'Findings', value: findings.length, tone: findings.length > 0 ? 'warn' : 'ok' },
              { label: 'Jobs', value: jobs.length, tone: activeJob ? 'info' : 'neutral' },
            ],
          },
          missingConfigIds: lastDigestHoursAgo == null ? ['intelligence.benchmarking_optin'] : [],
          debugLines: decideDebugLines,
        }}
        act={intelligenceAction}
        actAnchor="intelligence:act"
        actEvidence={intelligenceAction ? { kind: 'rule-trace', why: intelligenceAction.reason ?? intelligenceAction.title } : undefined}
        actDebugLines={
          intelligenceAction
            ? [{ level: 'debug', source: 'nba', message: `tone=${intelligenceAction.tone}` }]
            : undefined
        }
        verify={{
          label: 'Latest report',
          detail: reports[0]
            ? `${new Date(reports[0].created_at).toLocaleDateString()} · ${reports[0].week_start ?? 'week unknown'}`
            : 'no reports yet',
          to: '/intelligence?tab=reports',
          secondaryTo: activeJob ? '/intelligence?tab=pipeline' : undefined,
          secondaryLabel: activeJob ? 'View active job' : undefined,
          anchor: 'intelligence:verify',
          evidence: reports[0] ? {
            kind: 'last-event',
            at: reports[0].created_at,
            by: 'intelligence-report cron',
            payloadSummary: `Week of ${reports[0].week_start ?? 'unknown'} · ${findings.length} finding${findings.length === 1 ? '' : 's'}`,
            status: 'ok',
          } : undefined,
          debugLines: reports[0]
            ? [{ level: 'debug', source: 'report.id', message: reports[0].id }]
            : undefined,
        }}
      />

      <PageActionBar scope="intelligence" action={intelligenceAction} />

      <PageHelp
        title="About Bug Intelligence"
        whatIsIt="Weekly LLM-authored digest of your bug pipeline — trends, fix velocity, hotspots, and recommendations. Each report is persisted, versioned, and exportable as PDF."
        useCases={[
          'Share a one-page status with stakeholders every Monday',
          'Spot regressions early — week-over-week category and severity drift',
          'Compare your fix velocity against anonymised industry benchmarks (opt-in)',
        ]}
        howToUse="Reports generate automatically every Monday by cron. Click Generate to run for the current project — the job runs in the background and Pipeline shows live status."
      />

      {!intelligenceUnlocked && !entitlements.loading && (
        <UpgradePrompt flag="intelligence_reports" currentPlan={entitlements.planName} />
      )}

      <Section
        title="Intelligence pipeline"
        freshness={{ at: lastFetchedAt, isValidating }}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Digests" value={reports.length} />
          <StatCard label="Pending findings" value={findings.length} accent={findings.length > 0 ? 'text-warn' : undefined} />
          <StatCard
            label="Fix attempts (all digests)"
            value={totalFixAttempts}
            hint="Sum of fix attempts across archived weekly digests"
          />
          <StatCard
            label="Project"
            value={projectName ?? '—'}
            hint={activeProjectId ? 'Lists filter to the active project in the header' : 'Select a project to load intelligence data'}
          />
        </div>

        <div className="mb-4">
          <PipelineStatusBanner
            activeJob={activeJob}
            lastFailed={lastFailed}
            reportCount={reports.length}
            projectName={projectName}
            benchmarkOptIn={benchmark.optIn}
          />
        </div>

        <SegmentedControl
          value={activeTab}
          onChange={(v) => setTab(v)}
          options={tabOptions}
          ariaLabel="Intelligence sections"
          className="mb-4"
        />

        <p className="mb-4 text-2xs text-fg-muted">{activeMeta.description}</p>

        {!activeProjectId ? (
          <SetupNudge
            requires={['project']}
            emptyTitle="Select a project"
            emptyDescription="Intelligence digests, jobs, and modernization findings are scoped to the active project. Pick one in the header."
          />
        ) : loading ? (
          <TableSkeleton rows={4} columns={4} showFilters={false} label="Loading intelligence data" />
        ) : fetchError ? (
          <ErrorAlert message={fetchError} onRetry={reloadAll} />
        ) : (
          <>
            {activeTab === 'overview' && (
              <div className="space-y-4">
                <ThisWeekNarrative latest={reports[0] ?? null} projectName={projectName} />
                {activeJob && (
                  <div data-dav-anchor="intelligence:act">
                    <ActiveJobCard job={activeJob} onCancel={() => void cancelJob(activeJob.id)} />
                  </div>
                )}
                {!activeJob && (
                  <LastFailureNote
                    jobs={recentJobs}
                    onRetry={() => void generateNow()}
                    retrying={generating}
                  />
                )}
                <BenchmarkOptInCard benchmark={benchmark} onToggle={(v) => void toggleOptIn(v)} />
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="space-y-3" data-dav-anchor="intelligence:verify">
                {reports.length === 0 ? (
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
                        disabled={generating || !!activeJob || !intelligenceUnlocked}
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
              <div className="space-y-4" data-dav-anchor="intelligence:decide">
                <ModernizationFindings
                  findings={findings}
                  dispatchingId={dispatchingId}
                  projectName={projectName}
                  loading={findingsLoading}
                  onDispatch={(id) => void dispatchFinding(id)}
                  onDismiss={(id) => void dismissFinding(id)}
                />
                <RecentJobsList jobs={recentJobs} projectName={projectName} loading={jobsLoading} />
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  )
}

interface ThisWeekNarrativeProps {
  latest: IntelligenceReport | null
  projectName: string | null
}

function ThisWeekNarrative({ latest, projectName }: ThisWeekNarrativeProps) {
  if (!latest) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-fg">This week</h3>
        <p className="mt-1 max-w-prose text-xs text-fg-muted">
          {projectName
            ? `No intelligence digest for ${projectName} yet. Monday cron writes automatically, or use Generate this week for an immediate run.`
            : 'No intelligence digest yet. Generate one to see hotspots, fix velocity, and severity drift in narrative form.'}
        </p>
      </Card>
    )
  }

  const headline = firstParagraph(latest.summary_md)
  return (
    <Card className="border-brand/20 bg-brand/5 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand">Week of {latest.week_start}</h3>
        {latest.llm_model && (
          <span className="font-mono text-3xs text-fg-faint">{latest.llm_model}</span>
        )}
      </div>
      <p className="max-w-prose text-xs leading-relaxed whitespace-pre-line text-fg-secondary">
        {headline}
      </p>
    </Card>
  )
}

function firstParagraph(md: string | null | undefined): string {
  if (!md) return 'Report generated, but no summary text was captured.'
  const trimmed = md.trim()
  const split = trimmed.split(/\n\s*\n/, 2)
  const first = (split[0] ?? trimmed).replace(/^#+\s*/gm, '').trim()
  return first.length > 380 ? `${first.slice(0, 380)}…` : first
}
