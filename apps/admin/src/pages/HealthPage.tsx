/**
 * FILE: apps/admin/src/pages/HealthPage.tsx
 * PURPOSE: Real-time LLM + cron telemetry. Banner + HEALTH SNAPSHOT + one row of sections
 *          (components/health/HealthSectionsBar): Overview | AI calls | Scheduled jobs |
 *          Recent traces | Code size | Schema changes | Unusual spikes, under the page title
 *          (ADR 0066). Two stacked bars
 *          (the hub's views, then this view's tabs) were flattened into one (2026-11-18).
 */

import { Suspense, useCallback, useEffect, useMemo, useState, lazy, type ReactNode } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { useRealtime } from '../lib/realtime'
import { useVisiblePolling } from '../lib/useVisiblePolling'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useToast } from '../lib/toast'
import { langfuseTraceUrl } from '../lib/env'
import {
  Section,
  Badge,
  Btn,
  EmptyState,
  RecommendedAction,
  SelectField,
  FilterSelect,
  RelativeTime,
  Loading, } from '../components/ui'
import { HealthStatusBanner, isHealthStatusBannerCritical } from '../components/health/HealthStatusBanner'
import { HealthSnapshotStrip, healthLead } from '../components/health/HealthSnapshotStrip'
import { PipelineRecoveryPanel } from '../components/health/PipelineRecoveryPanel'
import { HealthProbesGuide } from '../components/health/HealthProbesGuide'
import {
  ActionPill,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import {
  EMPTY_HEALTH_STATS,
  type HealthStats,
  type HealthTabId,
} from '../components/health/HealthStatsTypes'
import { HealthSkeleton } from '../components/skeletons/HealthSkeleton'
import { HeroPulseHealth, HeroSearch } from '../components/illustrations/HeroIllustrations'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageCopy } from '../lib/copy'
import { useHealthUx, resolveQuickHealthTab } from '../lib/healthModeUx'
import { useQuickstartLandingTab } from '../lib/useQuickstartTab'
import { describeApiFailure } from '../lib/humanizeApiError'
import { ADMIN_ONLY_HINT } from '../lib/orgPermissions'
import { fallbackRateDetail, latencyDetail } from '../lib/statTooltips/health'
import { PageHero } from '../components/PageHero'
import type { OperatorTraceLine } from '../components/hero-flow/operatorTrace'
import { useNextBestAction } from '../lib/useNextBestAction'
import { markJudgeBatchSeen } from '../lib/judgeFreshness'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { shouldHideGuideWhenBannerActive } from '../lib/pagePostureHelpers'
import { CheckVerificationHub } from '../components/check/CheckVerificationHub'
import { HealthSectionsBar, resolveHealthView, type HealthSection } from '../components/health/HealthSectionsBar'
import { PageHeaderTabsProvider } from '../components/PageHeaderTabs'
import { useReadTimedOut } from '../lib/ciReadTimeout'
import { CiNotChecked } from '../components/ci/CiNotChecked'
import { cronJobState } from '../components/health/cronJobState'
import { groupRecentCalls } from '../components/health/recentCalls'
import { StatusGlyph, TONE_INK } from '../components/signal/StatusGlyph'
import { PageLoadError } from '../components/PageLoadError'
import { PlatformDoctorCard } from '../components/health/PlatformDoctorCard'

const CodeHealthPage = lazy(() => import('./CodeHealthPage').then((m) => ({ default: m.CodeHealthPage })))
const DriftPage = lazy(() => import('./DriftPage').then((m) => ({ default: m.DriftPage })))
const AnomaliesPage = lazy(() => import('./AnomaliesPage').then((m) => ({ default: m.AnomaliesPage })))

interface LlmRecent {
  function_name: string
  used_model: string
  primary_model: string
  fallback_used: boolean
  status: string
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
  langfuse_trace_id: string | null
  report_id: string | null
  key_source: string | null
}

interface LlmHealth {
  window: string
  totalCalls: number
  fallbacks: number
  fallbackRate: number
  errors: number
  errorRate: number
  avgLatencyMs: number
  p95LatencyMs?: number
  /** False while latency comes from the newest calls only. */
  latencyExact?: boolean
  /** The breakdowns below cover the newest `breakdownCalls` of `totalCalls`. */
  breakdownCalls?: number
  byModel: Record<string, { calls: number; errors: number; tokens: number }>
  byFunction: Record<string, {
    calls: number
    errors: number
    fallbacks: number
    avgLatencyMs: number
    p95LatencyMs?: number
    costUsd?: number
    /** Calls with no price in the price book; not in costUsd. */
    unpricedCalls?: number
    lastFailureAt?: string | null
  }>
  recent: LlmRecent[]
}

interface CronJobHealth {
  lastRun: string | null
  lastStatus: string | null
  successRate: number
  avgDurationMs: number
  runs: number
  stalenessMinutes?: number | null
  staleness?: 'ok' | 'warn' | 'stale' | 'never'
}

interface CronHealth {
  byJob: Record<string, CronJobHealth>
  recent: Array<{
    id: string
    job_name: string
    trigger: string
    status: string
    started_at: string
    finished_at: string | null
    duration_ms: number | null
    rows_affected: number | null
    error_message: string | null
  }>
}

const KNOWN_JOBS = ['judge-batch', 'intelligence-report', 'data-retention'] as const
const WINDOW_OPTIONS = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
]
const RECENT_FILTER_OPTIONS = ['', 'errors', 'fallbacks']


function resolveHealthTab(value: string | null): HealthTabId {
  if (value === 'llm' || value === 'cron' || value === 'activity') return value
  return 'overview'
}


/** How often the open Health page re-reads cron health (it polls cron_runs instead of subscribing). */
const CRON_POLL_MS = 60_000
export function HealthPage() {
  const [hubParams] = useSearchParams()
  if (hubParams.get('hub') === 'check') {
    return <CheckVerificationHub />
  }
  // Mushi health (Plan 021; renamed from App health, P6): Code size, Schema changes and Unusual spikes are views here now,
  // each a section of the one bar (HealthSectionsBar) next to the AI & jobs sections.
  const view = resolveHealthView(hubParams)
  if (view === 'integrations') return <HealthPageContent />
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {/* The one bar sits under the view's page title (ADR 0066). */}
      <PageHeaderTabsProvider tabs={<HealthSectionsBar tabLabels={HEALTH_TAB_LABELS} />}>
        <Suspense fallback={<Loading text="Loading…" />}>
          {view === 'code' ? <CodeHealthPage /> : view === 'schema' ? <DriftPage /> : <AnomaliesPage />}
        </Suspense>
      </PageHeaderTabsProvider>
    </div>
  )
}

/** The AI & jobs section names the page copy gives, so the bar reads the same on every view. */
const HEALTH_TAB_LABELS: Record<string, string> = { overview: 'Overview', llm: 'AI calls', cron: 'Scheduled jobs', activity: 'Recent traces' }

function HealthPageContent() {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/health')
  const ux = useHealthUx()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = resolveHealthTab(tabParam)
  const window = searchParams.get('window') ?? '24h'
  const recentFilter = searchParams.get('recent') ?? ''
  const fnFilter = searchParams.get('fn') ?? ''

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<HealthStats>(`/v1/admin/health/stats?window=${window}`, { deps: [window] })
  const stats = { ...EMPTY_HEALTH_STATS, ...statsData }

  const setActiveTab = useCallback(
    (tab: HealthTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'overview') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  // Quick mode opens the posture tab once; links and clicks then win.
  useQuickstartLandingTab({
    enabled: ux.isQuickstart,
    ready: !statsLoading,
    // A status shortcut (?status=) picks a tab too, so it counts as a deep link.
    tabParam: tabParam ?? searchParams.get('status'),
    activeTab: activeTab,
    quickTab: resolveQuickHealthTab(stats),
    setActiveTab: setActiveTab,
  })

  const llmQuery = usePageData<LlmHealth>(`/v1/admin/health/llm?window=${window}`, { deps: [window] })
  const cronQuery = usePageData<CronHealth>('/v1/admin/health/cron')
  const [triggering, setTriggering] = useState<string | null>(null)
  const [probing, setProbing] = useState<string | null>(null)
  const [probeResults, setProbeResults] = useState<Record<string, { status: string; latencyMs: number; detail?: string; at: string }>>({})

  const llm = llmQuery.data
  const cron = cronQuery.data
  // Never an endless skeleton: a read that has not answered in 10 s says "not checked" with Retry.
  const statsWait = useReadTimedOut(statsLoading && !statsData)
  const detailWait = useReadTimedOut(llmQuery.loading || cronQuery.loading)

  const reloadAll = useCallback(() => {
    reloadStats()
    llmQuery.reload()
    cronQuery.reload()
  }, [reloadStats, llmQuery, cronQuery])

  useRealtime({ table: 'llm_invocations' }, reloadAll)
  // cron_runs is polled, not subscribed: it takes a write every few seconds
  // (every cron tick) and this page was its only listener, so it left the
  // Realtime publication on 2026-11-11 (cost audit). A minute matches the
  // fastest job's cadence.
  useVisiblePolling(reloadAll, CRON_POLL_MS)

  useEffect(() => {
    const lastRun = cron?.byJob['judge-batch']?.lastRun
    if (!lastRun) return
    const ts = Date.parse(lastRun)
    if (!Number.isFinite(ts)) return
    markJudgeBatchSeen(ts)
  }, [cron])

  const statusParam = searchParams.get('status')
  useEffect(() => {
    if (!statusParam) return
    const next = new URLSearchParams(searchParams)
    next.delete('status')
    if (statusParam === 'red') {
      next.set('tab', stats.cronErrorCount > 0 ? 'cron' : 'llm')
    } else if (statusParam === 'amber') {
      next.set('tab', stats.cronStaleCount > 0 || stats.cronWarnCount > 0 ? 'cron' : 'llm')
    }
    setSearchParams(next, { replace: true })
  }, [statusParam, stats.cronErrorCount, stats.cronStaleCount, stats.cronWarnCount, searchParams, setSearchParams])

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const filteredRecent = useMemo<LlmRecent[]>(() => {
    if (!llm) return []
    let rows = llm.recent ?? []
    if (recentFilter === 'errors') rows = rows.filter((r) => r.status !== 'success')
    if (recentFilter === 'fallbacks') rows = rows.filter((r) => r.fallback_used)
    if (fnFilter) rows = rows.filter((r) => r.function_name === fnFilter)
    return rows
  }, [llm, recentFilter, fnFilter])

  async function probeProvider(kind: 'anthropic' | 'openai') {
    setProbing(kind)
    try {
      const res = await apiFetch<{ status: string; latencyMs: number; detail?: string }>(
        `/v1/admin/health/integration/${kind}`,
        { method: 'POST' },
      )
      if (!res.ok || !res.data) {
        const t = describeApiFailure(res.error, `Could not test ${kind === 'anthropic' ? 'Anthropic' : 'OpenAI'}`)
        toast.error(t.title, t.description)
        setProbeResults((prev) => ({
          ...prev,
          [kind]: { status: 'down', latencyMs: 0, detail: res.error?.message, at: new Date().toISOString() },
        }))
        return
      }
      setProbeResults((prev) => ({
        ...prev,
        [kind]: { ...res.data!, at: new Date().toISOString() },
      }))
      if (res.data.status === 'ok') toast.success(`${kind} healthy`, `${res.data.latencyMs}ms`)
      else toast.error(`${kind} probe ${res.data.status}`, res.data.detail)
    } finally {
      setProbing(null)
    }
  }

  async function triggerJob(job: 'judge-batch' | 'intelligence-report') {
    setTriggering(job)
    try {
      const res = await apiFetch(`/v1/admin/health/cron/${job}/trigger`, { method: 'POST' })
      if (!res.ok) {
        const t = describeApiFailure(res.error, `Could not run ${job}`)
        toast.error(t.title, t.description)
        return
      }
      toast.success(`Ran ${job}`, 'Its result shows in the job card below.')
      reloadAll()
    } catch {
      toast.error(`Could not run ${job}`, 'Could not reach Mushi Mushi. Check your connection and retry.')
    } finally {
      setTriggering(null)
    }
  }

  const healthRed = stats.redCount
  const healthAmber = stats.amberCount

  usePublishPageContext({
    route: '/health',
    title: projectName ? `Health · ${projectName}` : 'Health',
    summary: statsLoading
      ? 'Loading health metrics…'
      : healthRed > 0
        ? `${healthRed} red · ${stats.totalCalls} calls · ${stats.errorRatePct}% errors`
        : healthAmber > 0
          ? `${healthAmber} warning · ${stats.totalCalls} calls`
          : `All systems nominal · ${stats.totalCalls} calls`,
    criticalCount: healthRed,
    questions: stats.hasAnyProject
      ? [
          healthRed > 0
            ? 'Which red signal should I investigate first and why?'
            : 'Are there any worrying trends I might be missing?',
          'Show me the most expensive LLM functions over the last 24h.',
          stats.fallbackRatePct > 5
            ? 'Why are we falling back to OpenAI so often?'
            : 'Which models are doing the heavy lifting right now?',
        ]
      : undefined,
    actions: [
      {
        id: 'reload-health',
        label: 'Refresh metrics',
        hint: 'Re-pull LLM + cron health data',
        run: () => { void reloadAll() },
      },
    ],
  })

  const healthAction = useNextBestAction({
    scope: 'health',
    redCount: stats.redCount,
    amberCount: stats.amberCount,
  })

  const sectionCounts = useMemo<Partial<Record<HealthSection, number>>>(
    () => ({
      cron: stats.cronErrorCount > 0 ? stats.cronErrorCount : undefined,
      llm: stats.errorRatePct > 5 ? 1 : undefined,
    }),
    [stats.cronErrorCount, stats.errorRatePct],
  )
  const tabLabels = { ...HEALTH_TAB_LABELS, ...copy?.tabLabels }
  // The one bar is on every state of the page, loading and errors too: under
  // the page title once it renders (ADR 0066), above the content until then.
  const withBar = (node: ReactNode) => (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <PageHeaderTabsProvider tabs={ux.hideTabs ? null : <HealthSectionsBar tabLabels={tabLabels} counts={sectionCounts} />}>
        {node}
      </PageHeaderTabsProvider>
    </div>
  )
  const retryAll = () => {
    statsWait.restart()
    detailWait.restart()
    reloadAll()
  }

  if (statsLoading && !statsData && statsWait.timedOut) {
    return withBar(<CiNotChecked what="Mushi Mushi health" testId="health-not-checked" onRetry={retryAll} />)
  }
  if (statsLoading && !statsData) {
    return withBar(
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading health">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised" />
          ))}
        </div>
      </div>,
    )
  }

  if (statsError) {
    return withBar(<PageLoadError error={statsError} resource="health stats" onRetry={reloadStats} />)
  }

  if ((llmQuery.loading || cronQuery.loading) && detailWait.timedOut && !llm) {
    return withBar(<CiNotChecked what="AI calls and scheduled jobs" testId="health-detail-not-checked" onRetry={retryAll} />)
  }
  if (llmQuery.loading || cronQuery.loading) return withBar(<HealthSkeleton />)
  if (llmQuery.error || !llm) {
    return withBar(
      <PageLoadError error={llmQuery.error ?? 'No data came back.'} resource="health metrics" onRetry={reloadAll} />,
    )
  }

  const fallbackPct = ((llm.fallbackRate ?? 0) * 100).toFixed(1)
  const errorPct = ((llm.errorRate ?? 0) * 100).toFixed(1)
  const byFunction = llm.byFunction ?? {}
  const byModel = llm.byModel ?? {}
  const fnNames = Object.keys(byFunction).sort()

  const healthSeverity: 'ok' | 'warn' | 'crit' | 'neutral' =
    stats.redCount > 0 ? 'crit' : stats.amberCount > 0 ? 'warn' : 'ok'
  const lastLlmCall = llm.recent?.[0]

  const healthDebugLines: OperatorTraceLine[] = [
    { level: 'debug', source: 'window', message: `telemetry window=${window}` },
    { level: stats.redCount > 0 ? 'error' : 'info', source: 'probes', message: `red=${stats.redCount} amber=${stats.amberCount}` },
    ...(lastLlmCall
      ? [{ level: 'info' as const, source: 'llm.last', message: `${lastLlmCall.function_name} · ${lastLlmCall.used_model}`, ts: lastLlmCall.created_at }]
      : []),
  ]

  // An overdue or late job is a problem too: never "All systems nominal" beside it. One count for
  // the overdue card and the summary's tone, so the summary is never green beside it (2026-11-18).
  // Round 3: the rows, the overdue card and the strip's "Jobs on time" all read cronJobState, so a
  // row is never green beside "1 job is overdue". The stats route stands in only without the rows.
  const cronStates = KNOWN_JOBS.map((j) => ({ job: j, state: cronJobState(cron?.byJob[j]) }))
  const overdueCron = cron ? cronStates.filter((c) => c.state.overdue).map((c) => c.job) : []
  const failingCron = cron ? cronStates.filter((c) => c.state.failed).map((c) => c.job) : []
  const lateCount = cron ? overdueCron.length : stats.cronStaleCount + stats.cronWarnCount
  const jobsOnTime = cron
    ? { ok: cronStates.filter((c) => c.state.tone === 'ok').length, total: KNOWN_JOBS.length, failed: failingCron.length }
    : undefined

  // A failed or overdue job, and a failing share of AI calls, lead the status line below with
  // their one button ("Run now", "See failed calls"); the cards that said them again are gone
  // (console UX overhaul, 2026-11-19).
  // Quick mode hides the strip, but never while it carries a problem and its button.
  const leadProblem = healthLead({ stats, failing: failingCron, overdue: overdueCron, window }).sentence != null
  const showStrip = !ux.hideHealthSnapshot || leadProblem
  const jobMarks = cronStates.map(({ job, state }) => ({ job, tone: state.tone, label: state.label }))
  const recommendedAction = (() => {
    if (llm.totalCalls === 0) {
      return (
        <RecommendedAction
          tone="info"
          title={`No LLM activity in the last ${window}`}
          description="The pipeline is idle. Submit a test report from the onboarding wizard to verify routing end-to-end."
          cta={{ label: 'Open setup wizard', to: '/onboarding' }}
        />
      )
    }
    // Healthy: the status sentence above already says so. A second
    // "All systems nominal" card beside an amber error rate read as a
    // contradiction (console journeys 2026-10-27).
    return null
  })()

  return withBar(
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-health">
      <PageHeaderBar
        title={copy?.title ?? 'Mushi Mushi health'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        withPageHero={!ux.hideOverviewChrome}

        helpTitle={copy?.help?.title ?? 'About Mushi Mushi health'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'Live operational dashboard showing every LLM call routed by Mushi Mushi (Anthropic primary, OpenAI fallback) and every scheduled job (judge, intelligence, retention). Each event is written to a telemetry table and streamed here via Supabase Realtime.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Catch when Anthropic rate-limits cause a fallback storm',
          'See if scheduled jobs (cron) are actually running, succeeding, and on time',
          'Spot model-level latency regressions before they impact users',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? "No action needed for healthy state. If fallback rate spikes, check Anthropic status. If a cron job hasn't run in its expected window, trigger it manually with the buttons below. Click any LLM call to open its Langfuse trace."}
      >
        <SelectField
          label="Window"
          value={window}
          onChange={(e) => updateParam('window', e.currentTarget.value)}
          className="w-32"
        >
          {WINDOW_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </SelectField>
        <Btn
          variant="ghost"
          size="sm"
          onClick={reloadAll}
          loading={statsValidating || llmQuery.isValidating || cronQuery.isValidating}
        >
          Refresh
        </Btn>
      </PageHeaderBar>

      {/* The sections are the one bar above the page (HealthSectionsBar); the overview's problem comes before the numbers. */}

      {/* RecommendedAction is always shown on the overview tab — it gives every
          mode (quickstart/beginner/advanced) an actionable next step rather than
          leaving the page blank below the KPI snapshot. PageHero (PDCA chrome)
          is still advanced-only. */}
      {activeTab === 'overview' && recommendedAction}
      {/* Reports stuck before triage, with the button that recovers them (console 2026-11-19). */}
      {activeTab === 'overview' && <PipelineRecoveryPanel canRun={stats.canRunJobs !== false} variant="alert" />}

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            // The status sentence below says the same thing; the banner stands in only when it is hidden.
            show: isHealthStatusBannerCritical(stats) && (!showStrip || !stats.hasAnyProject),
            children: (
              <HealthStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onRefresh={reloadAll}
                refreshing={statsValidating || llmQuery.isValidating || cronQuery.isValidating}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: showStrip,
            children: (
              <HealthSnapshotStrip
                stats={stats}
                lateJobs={lateCount}
                jobs={jobsOnTime}
                jobMarks={cron ? jobMarks : undefined}
                failingJobs={failingCron}
                overdueJobs={overdueCron}
                window={window}
                onRunJob={(job) => void triggerJob(job)}
                runningJob={triggering}
                onTab={setActiveTab}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                statLabels={copy?.statLabels}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show:
              activeTab === 'overview' &&
              !shouldHideGuideWhenBannerActive(
                isHealthStatusBannerCritical(stats),
                ['healthy', 'idle'],
                stats.topPriority,
              ),
            children: <HealthProbesGuide topPriority={stats.topPriority} stats={stats} />,
          },
        ]}
      />

      {activeTab === 'overview' && !ux.hideOverviewChrome && (
        <>
          <PageHero
            scope="health"
            title={copy?.title ?? 'Mushi Mushi health'}
            kicker="Pipeline vitals"
            decide={{
              label: stats.redCount > 0
                ? 'Critical probes failing'
                : stats.amberCount > 0
                  ? 'Degraded probes'
                  : 'All systems nominal',
              metric: `${llm.totalCalls} calls · ${errorPct}% err`,
              summary: stats.redCount > 0
                ? `${stats.redCount} red probe${stats.redCount === 1 ? '' : 's'} — blocking the pipeline. Act now.`
                : stats.amberCount > 0
                  ? `${stats.amberCount} amber probe${stats.amberCount === 1 ? '' : 's'} — fallbacks or slow jobs, not yet blocking.`
                  : `Fallback rate ${fallbackPct}% · avg ${Math.round(llm.avgLatencyMs)}ms (${window}).`,
              severity: healthSeverity,
              anchor: 'health:decide',
              evidence: {
                kind: 'metric-breakdown',
                whyNow: stats.redCount > 0
                  ? `${stats.redCount} red probe${stats.redCount === 1 ? '' : 's'} are blocking the pipeline — error rate ${errorPct}% exceeds the 5% threshold.`
                  : `Pipeline is nominal: ${errorPct}% errors · ${fallbackPct}% fallbacks · ${Math.round(llm.avgLatencyMs)}ms avg latency.`,
                items: [
                  { label: 'Total calls', value: llm.totalCalls, tone: 'neutral' },
                  { label: 'Error rate', value: `${errorPct}%`, tone: llm.errorRate > 0.05 ? 'crit' : llm.errorRate > 0 ? 'warn' : 'ok' },
                  { label: 'Fallback rate', value: `${fallbackPct}%`, tone: llm.fallbackRate > 0.1 ? 'crit' : llm.fallbackRate > 0 ? 'warn' : 'ok' },
                  { label: 'Avg latency', value: `${Math.round(llm.avgLatencyMs)}ms`, tone: 'neutral' },
                ],
              },
              debugLines: healthDebugLines,
            }}
            act={healthAction}
            actAnchor="health:act"
            actEvidence={healthAction ? { kind: 'rule-trace', why: healthAction.reason ?? healthAction.title, threshold: stats.redCount > 0 ? 'errorRate > 5% or probes failing' : undefined } : undefined}
            verify={{
              label: lastLlmCall ? `Last LLM call · ${lastLlmCall.used_model}` : 'Awaiting first call',
              detail: lastLlmCall
                ? `${lastLlmCall.function_name} · ${new Date(lastLlmCall.created_at).toISOString().slice(11, 19)}Z`
                : '—',
              to: lastLlmCall?.report_id ? `/reports/${lastLlmCall.report_id}` : '/reports',
              secondaryTo: '/audit',
              secondaryLabel: 'Open audit log',
              anchor: 'health:verify',
              evidence: lastLlmCall ? {
                kind: 'last-event',
                at: lastLlmCall.created_at,
                by: lastLlmCall.used_model ?? 'unknown',
                payloadSummary: lastLlmCall.function_name ?? 'llm call',
                status: lastLlmCall.status === 'success' ? 'ok' : 'warn',
              } : undefined,
            }}
          />

        </>
      )}

      {activeTab === 'llm' && (
        <>
          {/* Round 3: calls and the error rate are in the strip above, once; the strip has the one
              "Updated". What is left are the two figures the strip does not show, flat. */}
          <Section title={`LLM breakdown (${window})`}>
            <dl className="grid grid-cols-2 gap-3" data-dav-anchor="health:decide" data-testid="health-llm-figures">
              <div className="min-w-0">
                <dt className="text-2xs text-fg-muted">Fallback rate</dt>
                <dd className={`text-base font-semibold tabular-nums ${llm.fallbackRate > 0 ? TONE_INK.warn : 'text-fg'}`}>{fallbackPct}%</dd>
                <dd className="text-2xs text-fg-muted">{fallbackRateDetail()}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-2xs text-fg-muted">Latency avg / p95</dt>
                <dd className="text-base font-semibold tabular-nums text-fg">
                  {llm.avgLatencyMs}ms / {llm.p95LatencyMs ?? 0}ms
                </dd>
                <dd className="text-2xs text-fg-muted">{llm.latencyExact === false ? 'From the newest calls only' : latencyDetail()}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Per-function breakdown">
            {llm.breakdownCalls != null && llm.breakdownCalls < llm.totalCalls && (
              <InlineProof className="mb-2">
                Covers the newest {llm.breakdownCalls.toLocaleString()} of {llm.totalCalls.toLocaleString()} calls in
                this window. The totals above count every call.
              </InlineProof>
            )}
            {fnNames.length === 0 ? (
              <EmptyState
                icon={<HeroPulseHealth />}
                title={`No LLM activity in the last ${window}`}
                description="Once your project starts classifying, fixing, or judging reports, every model call will land here with latency, cost, and a Langfuse trace deep-link."
                hints={[
                  'Send a demo bug from the Dashboard to light up Classify and Fix in real time.',
                  'Switch the time window above to look back further if your traffic is bursty.',
                ]}
              />
            ) : (
              <ul className="divide-y divide-edge-subtle">
                {fnNames.map((fn) => {
                  const f = byFunction[fn]
                  const isFiltered = fnFilter === fn
                  const costStr = `$${(f.costUsd ?? 0).toFixed((f.costUsd ?? 0) >= 1 ? 2 : 4)}`
                  return (
                    <li key={fn} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <code className="min-w-0 break-all font-mono text-2xs font-medium text-fg">{fn}</code>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <SignalChip tone="neutral">{f.calls} calls</SignalChip>
                        <SignalChip tone="info">avg {f.avgLatencyMs}ms</SignalChip>
                        <SignalChip tone="neutral">p95 {f.p95LatencyMs ?? 0}ms</SignalChip>
                        <SignalChip tone="brand">{costStr}</SignalChip>
                        {(f.unpricedCalls ?? 0) > 0 && (
                          <SignalChip tone="warn" title="No price in the price book for these calls; they are not in the cost.">
                            {f.unpricedCalls} unpriced
                          </SignalChip>
                        )}
                        {f.fallbacks > 0 && (
                          <SignalChip tone="warn">
                            {f.fallbacks} fallback{f.fallbacks === 1 ? '' : 's'}
                          </SignalChip>
                        )}
                        {f.errors > 0 && (
                          <SignalChip tone="danger">
                            {f.errors} error{f.errors === 1 ? '' : 's'}
                          </SignalChip>
                        )}
                        {f.lastFailureAt && (
                          <span title={`Last failure ${new Date(f.lastFailureAt).toLocaleString()}`}>
                            <SignalChip tone="danger">
                              failed <RelativeTime value={f.lastFailureAt} />
                            </SignalChip>
                          </span>
                        )}
                        <ActionPill
                          tone={isFiltered ? 'brand' : 'neutral'}
                          onClick={() => {
                            updateParam('fn', isFiltered ? '' : fn)
                            if (!isFiltered) setActiveTab('activity')
                          }}
                        >
                          {isFiltered ? 'Clear filter' : 'Filter activity'}
                        </ActionPill>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          <Section title="Per-model breakdown">
            {Object.keys(byModel).length === 0 ? (
              <EmptyState
                icon={<HeroPulseHealth accent="text-info" />}
                title={`No LLM activity in the last ${window}`}
                description="When models start serving traffic, you'll see Haiku, Sonnet, and the judge each broken out with their own latency and cost."
              />
            ) : (
              <ul className="divide-y divide-edge-subtle">
                {Object.entries(byModel).map(([model, m]) => (
                  <li key={model} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <code className="min-w-0 break-all font-mono text-2xs text-fg-secondary">{model}</code>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <SignalChip tone="neutral">{m.calls} calls</SignalChip>
                      <SignalChip tone="info">{m.tokens.toLocaleString()} tokens</SignalChip>
                      {m.errors > 0 && (
                        <SignalChip tone="danger">
                          {m.errors} error{m.errors === 1 ? '' : 's'}
                        </SignalChip>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {activeTab === 'cron' && (
        // One status per job from its last run AND its schedule (cronJobState): a job that ran
        // fine 9 days ago on a weekly schedule is "overdue 9d", never a green "success" (round 3).
        // Flat rows, the tab's own name, and no second "Updated": the strip above has it.
        <>
        <Section title="Stuck reports">
          <PipelineRecoveryPanel canRun={stats.canRunJobs !== false} variant="row" />
        </Section>
        <Section title="Scheduled jobs">
          <ul className="divide-y divide-edge-subtle" data-dav-anchor="health:verify" data-testid="health-cron-jobs">
            {KNOWN_JOBS.map((job) => {
              const j = cron?.byJob[job]
              const s = cronJobState(j)
              const isManual = job !== 'data-retention'
              return (
                <li key={job} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" data-testid={`health-cron-${job}`} data-tone={s.tone}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-xs font-medium text-fg">{job}</code>
                      <span className={`inline-flex items-center gap-1 text-2xs font-semibold ${TONE_INK[s.tone]}`}>
                        <StatusGlyph tone={s.tone} />
                        {s.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-2xs text-fg-secondary" title={j?.lastRun ? `Last run ${new Date(j.lastRun).toLocaleString()}` : undefined}>
                      {s.detail}
                    </p>
                  </div>
                  {isManual && (
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => triggerJob(job as 'judge-batch' | 'intelligence-report')}
                      loading={triggering === job}
                      disabled={stats.canRunJobs === false}
                      title={stats.canRunJobs === false ? ADMIN_ONLY_HINT : 'Runs this job now; it spends AI budget.'}
                    >
                      Trigger now
                    </Btn>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
        </>
      )}

      {activeTab === 'activity' && (
        <>
          {/* Round 3: the how-it-works sentence once, not under each "not probed" row. */}
          <Section title="Provider probes">
            <p className="mb-1 text-2xs text-fg-muted">A 1-token round-trip against each provider's live API, stopped after 5 s.</p>
            <ul className="divide-y divide-edge-subtle" data-dav-anchor="health:act" data-testid="health-probes">
              {(['anthropic', 'openai'] as const).map((kind) => {
                const r = probeResults[kind]
                const tone = r?.status === 'ok' ? 'ok' : r?.status === 'degraded' ? 'warn' : r?.status === 'down' ? 'danger' : 'off'
                return (
                  <li key={kind} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-fg">{kind === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
                        <span className={`inline-flex items-center gap-1 text-2xs font-semibold ${TONE_INK[tone]}`}>
                          <StatusGlyph tone={tone} />
                          {r?.status ?? 'not probed'}
                        </span>
                      </div>
                      {r && (
                        <p className="mt-0.5 text-2xs text-fg-secondary">
                          {`${r.latencyMs}ms · last probed ${new Date(r.at).toLocaleTimeString()}${r.detail ? ` · ${r.detail.slice(0, 120)}` : ''}`}
                        </p>
                      )}
                    </div>
                    <Btn size="sm" variant="ghost" onClick={() => probeProvider(kind)} loading={probing === kind}>
                      Probe now
                    </Btn>
                  </li>
                )
              })}
            </ul>
          </Section>

          <Section
            title={fnFilter ? `Recent LLM calls · filtered to ${fnFilter}` : 'Recent LLM calls'}
            action={
              <FilterSelect
                label="calls"
                value={recentFilter}
                options={RECENT_FILTER_OPTIONS}
                optionLabel={(o) => (o === 'errors' ? 'Errors only' : o === 'fallbacks' ? 'Fallbacks only' : o)}
                onChange={(e) => updateParam('recent', e.currentTarget.value)}
              />
            }
          >
            {filteredRecent.length === 0 ? (
              <EmptyState
                icon={recentFilter || fnFilter ? <HeroSearch accent="text-fg-faint" /> : <HeroPulseHealth />}
                title={recentFilter || fnFilter ? 'No calls match these filters' : 'No recent calls'}
                description={recentFilter || fnFilter
                  ? 'Try clearing filters or widening the time window.'
                  : 'Once Mushi Mushi processes a report, every model call lands here with the full trace one click away in Langfuse.'}
              />
            ) : (
              // Grouped by what the calls share, named once in full; one header row (round 3).
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full text-2xs" data-testid="health-recent-calls">
                  <caption className="sr-only">Recent LLM calls, newest first, grouped by function and model</caption>
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th scope="col" className="py-1 pr-3 font-medium">Time</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">Latency</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">Tokens</th>
                      <th scope="col" className="py-1 font-medium">
                        <span className="sr-only">Links</span>
                      </th>
                    </tr>
                  </thead>
                  {groupRecentCalls(filteredRecent).map((g) => (
                    <tbody key={g.key} className="border-t border-edge-subtle">
                      <tr>
                        <th scope="rowgroup" colSpan={4} className="pt-2 pb-1 text-left font-normal">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <code className="break-all font-mono font-semibold text-fg">{g.fn}</code>
                            <span className="break-all font-mono text-fg-secondary">{g.model}</span>
                            {g.fallback && <Badge tone="warnSubtle">fallback</Badge>}
                            {g.status !== 'success' && <Badge tone="dangerSubtle">{g.status}</Badge>}
                            {g.keySource && <Badge tone="infoSubtle">{g.keySource}</Badge>}
                            <span className="text-fg-muted tabular-nums">
                              {g.rows.length} {g.rows.length === 1 ? 'call' : 'calls'}
                            </span>
                          </span>
                        </th>
                      </tr>
                      {g.rows.map((r, i) => {
                        const traceUrl = langfuseTraceUrl(r.langfuse_trace_id)
                        const tokens = (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
                        return (
                          <tr key={`${r.created_at}-${i}`} className="font-mono hover:bg-surface-overlay/40">
                            <td className="py-0.5 pr-3 text-fg-secondary tabular-nums whitespace-nowrap">{new Date(r.created_at).toLocaleTimeString()}</td>
                            <td className="py-0.5 pr-3 text-right text-fg tabular-nums">{r.latency_ms != null ? `${r.latency_ms}ms` : ''}</td>
                            <td className="py-0.5 pr-3 text-right text-fg tabular-nums">{tokens > 0 ? tokens.toLocaleString() : ''}</td>
                            <td className="py-0.5 whitespace-nowrap">
                              <span className="flex items-center gap-3">
                                {r.report_id && (
                                  <Link to={`/reports/${r.report_id}`} className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity" title="Open report">
                                    report
                                  </Link>
                                )}
                                {traceUrl && (
                                  <a
                                    href={traceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity"
                                    title="Open Langfuse trace"
                                  >
                                    trace ↗
                                  </a>
                                )}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {/* Super-admins only: the server doctor with the platform secrets. */}
      <PlatformDoctorCard />
    </div>
  )
}
