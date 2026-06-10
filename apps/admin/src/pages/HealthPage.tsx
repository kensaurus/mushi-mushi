/**
 * FILE: apps/admin/src/pages/HealthPage.tsx
 * PURPOSE: Real-time LLM + cron telemetry. Banner + HEALTH SNAPSHOT + tabs:
 *          Overview | LLM | Cron | Activity.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { useRealtime } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useToast } from '../lib/toast'
import { langfuseTraceUrl } from '../lib/env'
import {
  Card,
  Section,
  Badge,
  Btn,
  EmptyState,
  ErrorAlert,
  StatCard,
  RecommendedAction,
  SelectField,
  FilterSelect,
  RelativeTime,
  Pct,
  FreshnessPill,
  SegmentedControl,
} from '../components/ui'
import { HealthStatusBanner, isHealthStatusBannerCritical } from '../components/health/HealthStatusBanner'
import {
  ActionPill,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import {
  EMPTY_HEALTH_STATS,
  type HealthStats,
  type HealthTabId,
} from '../components/health/HealthStatsTypes'
import { statusGlowClass } from '../lib/tokens'
import { HealthSkeleton } from '../components/skeletons/HealthSkeleton'
import { HeroPulseHealth, HeroSearch } from '../components/illustrations/HeroIllustrations'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageCopy } from '../lib/copy'
import { useHealthUx, resolveQuickHealthTab } from '../lib/healthModeUx'
import {
  cronDetail,
  cronTooltip,
  errorRateDetail,
  errorRateTooltip,
  fallbackRateDetail,
  fallbackRateTooltip,
  lastCallDetail,
  lastCallTooltip,
  latencyDetail,
  latencyTooltip,
  totalCallsDetail,
  totalCallsTooltip,
} from '../lib/statTooltips/health'
import { healthLinks } from '../lib/statCardLinks'
import { PageHero } from '../components/PageHero'
import type { OperatorTraceLine } from '../components/hero-flow/operatorTrace'
import { useNextBestAction } from '../lib/useNextBestAction'
import { markJudgeBatchSeen } from '../lib/judgeFreshness'
import { PageHeaderBar } from '../components/PageHeaderBar'

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
  byModel: Record<string, { calls: number; errors: number; tokens: number }>
  byFunction: Record<string, {
    calls: number
    errors: number
    fallbacks: number
    avgLatencyMs: number
    p95LatencyMs?: number
    costUsd?: number
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

const HEALTH_TABS: Array<{ id: HealthTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture banner, workflow, and recommended next step.',
  },
  {
    id: 'llm',
    label: 'LLM',
    description: 'Per-function and per-model breakdown for the selected window.',
  },
  {
    id: 'cron',
    label: 'Cron',
    description: 'Scheduled jobs — last run, success rate, manual trigger.',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Provider probes and recent LLM calls with Langfuse deep-links.',
  },
]

function resolveHealthTab(value: string | null): HealthTabId {
  if (value === 'llm' || value === 'cron' || value === 'activity') return value
  return 'overview'
}

export function HealthPage() {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/health')
  const ux = useHealthUx()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = resolveHealthTab(tabParam)
  const activeTabMeta = HEALTH_TABS.find((t) => t.id === activeTab) ?? HEALTH_TABS[0]
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

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickHealthTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const llmQuery = usePageData<LlmHealth>(`/v1/admin/health/llm?window=${window}`, { deps: [window] })
  const cronQuery = usePageData<CronHealth>('/v1/admin/health/cron')
  const [triggering, setTriggering] = useState<string | null>(null)
  const [probing, setProbing] = useState<string | null>(null)
  const [probeResults, setProbeResults] = useState<Record<string, { status: string; latencyMs: number; detail?: string; at: string }>>({})

  const llm = llmQuery.data
  const cron = cronQuery.data

  const reloadAll = useCallback(() => {
    reloadStats()
    llmQuery.reload()
    cronQuery.reload()
  }, [reloadStats, llmQuery, cronQuery])

  useRealtime({ table: 'llm_invocations' }, reloadAll)
  useRealtime({ table: 'cron_runs' }, reloadAll)

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
        toast.error(`Probe failed for ${kind}`, res.error?.message)
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
      if (!res.ok) throw new Error(res.error?.message ?? 'Trigger failed')
      toast.success(`Triggered ${job}`)
      reloadAll()
    } catch (err) {
      toast.error(`Could not trigger ${job}`, err instanceof Error ? err.message : String(err))
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

  const tabOptions = useMemo(
    () =>
      HEALTH_TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'cron' && stats.cronErrorCount > 0
            ? stats.cronErrorCount
            : t.id === 'llm' && stats.errorRatePct > 5
              ? 1
              : undefined,
      })),
    [stats.cronErrorCount, stats.errorRatePct, copy?.tabLabels],
  )

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading health">
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
    return <ErrorAlert message={`Failed to load health stats: ${statsError}`} onRetry={reloadStats} />
  }

  if (llmQuery.loading || cronQuery.loading) return <HealthSkeleton />
  if (llmQuery.error || !llm) {
    return (
      <ErrorAlert
        message={`Failed to load health metrics: ${llmQuery.error ?? 'no data'}`}
        onRetry={reloadAll}
      />
    )
  }

  const fallbackPct = ((llm.fallbackRate ?? 0) * 100).toFixed(1)
  const errorPct = ((llm.errorRate ?? 0) * 100).toFixed(1)
  const llmTabStats: HealthStats = {
    ...EMPTY_HEALTH_STATS,
    hasAnyProject: stats.hasAnyProject,
    window,
    totalCalls: llm.totalCalls,
    errorRatePct: Math.round((llm.errorRate ?? 0) * 1000) / 10,
    fallbackRatePct: Math.round((llm.fallbackRate ?? 0) * 1000) / 10,
    avgLatencyMs: llm.avgLatencyMs ?? 0,
    p95LatencyMs: llm.p95LatencyMs ?? 0,
  }
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

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'llm_errors' || stats.topPriority === 'cron_error'
        ? 'danger'
        : stats.topPriority === 'llm_fallbacks' || stats.topPriority === 'cron_stale' || stats.topPriority === 'cron_warn'
          ? 'warn'
          : stats.topPriority === 'idle'
            ? 'brand'
            : stats.topPriority === 'healthy'
              ? 'ok'
              : 'info'

  const recommendedAction = (() => {
    const failingCron = KNOWN_JOBS.filter((j) => cron?.byJob[j]?.lastStatus === 'error')
    if (llm.errorRate > 0.05) {
      return (
        <RecommendedAction
          tone="urgent"
          title={`LLM error rate is ${errorPct}% over the last ${window}`}
          description="Anything above 5% usually points to an upstream provider outage or an expired API key. Check provider status pages and rotate keys if needed."
          cta={{ label: 'Check Anthropic status', href: 'https://status.anthropic.com' }}
        />
      )
    }
    if (llm.fallbackRate > 0.1) {
      return (
        <RecommendedAction
          tone="urgent"
          title={`Fallback rate spiked to ${fallbackPct}%`}
          description="More than 10% of calls are falling back to the secondary provider. Primary may be rate-limiting or returning errors."
          cta={{ label: 'Check Anthropic status', href: 'https://status.anthropic.com' }}
        />
      )
    }
    if (failingCron.length > 0) {
      return (
        <RecommendedAction
          tone="urgent"
          title={`${failingCron.length} cron ${failingCron.length === 1 ? 'job is' : 'jobs are'} failing`}
          description={`Last ${failingCron.length === 1 ? 'run of' : 'runs of'} ${failingCron.join(', ')} ended in error. Trigger manually to confirm it's reproducible, then open the cron logs.`}
        />
      )
    }
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
    return (
      <RecommendedAction
        tone="success"
        title="All systems nominal"
        description={`${llm.totalCalls} LLM calls · ${errorPct}% errors · ${fallbackPct}% fallbacks. No action needed.`}
      />
    )
  })()

  return (
    <div className="space-y-4" data-testid="mushi-page-health">
      <PageHeaderBar
        title={copy?.title ?? 'System Health'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        description={copy?.description ?? 'Banner + HEALTH SNAPSHOT — Overview for posture, LLM for breakdowns, Cron for jobs, Activity for traces.'}
        helpTitle={copy?.help?.title ?? 'About System Health'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'Live operational dashboard showing every LLM call routed by Mushi Mushi (Anthropic primary, OpenAI fallback) and every scheduled job (judge, intelligence, retention). Each event is written to a telemetry table and streamed here via Supabase Realtime.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Catch when Anthropic rate-limits cause a fallback storm',
          'See if scheduled jobs (cron) are actually running, succeeding, and on time',
          'Spot model-level latency regressions before they impact users',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? "No action needed for healthy state. If fallback rate spikes, check Anthropic status. If a cron job hasn't run in its expected window, trigger it manually with the buttons below. Click any LLM call to open its Langfuse trace."}
      >
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
          {!stats.hasAnyProject
            ? 'NO PROJECT'
            : stats.redCount > 0
              ? `${stats.redCount} RED`
              : stats.amberCount > 0
                ? `${stats.amberCount} WARN`
                : stats.totalCalls === 0
                  ? 'IDLE'
                  : 'OK'}
        </Badge>
        <FreshnessPill
          at={statsFetchedAt ?? llmQuery.lastFetchedAt ?? cronQuery.lastFetchedAt}
          isValidating={statsValidating || llmQuery.isValidating || cronQuery.isValidating}
        />
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

      {isHealthStatusBannerCritical(stats) && (
        <HealthStatusBanner
          stats={stats}
          onTab={setActiveTab}
          onRefresh={reloadAll}
          refreshing={statsValidating || llmQuery.isValidating || cronQuery.isValidating}
          plainBanner={ux.plainBanner}
        />
      )}

      {!ux.hideTabs && (
      <SegmentedControl<HealthTabId>
        size="sm"
        ariaLabel="Health sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {activeTab === 'overview' && !ux.hideOverviewChrome && (
        <>
          <PageHero
            scope="health"
            title={copy?.title ?? 'System Health'}
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

          {recommendedAction}
        </>
      )}

      {!ux.hideHealthSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'HEALTH SNAPSHOT'} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeTabMeta.description}</p>
        </ContainedBlock>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label={copy?.statLabels?.calls ?? 'LLM calls'}
            value={stats.totalCalls}
            accent={stats.totalCalls > 0 ? 'text-brand' : undefined}
            tooltip={totalCallsTooltip(stats)}
            detail={totalCallsDetail(stats)}
            to={healthLinks.totalCalls}
          />
          <StatCard
            label={copy?.statLabels?.errors ?? 'Error rate'}
            value={`${stats.errorRatePct}%`}
            accent={stats.errorRatePct > 5 ? 'text-danger' : stats.errorRatePct > 0 ? 'text-warn' : 'text-ok'}
            tooltip={errorRateTooltip(stats)}
            detail={errorRateDetail()}
            to={healthLinks.errorRate}
          />
          <StatCard
            label={copy?.statLabels?.fallbacks ?? 'Fallback rate'}
            value={`${stats.fallbackRatePct}%`}
            accent={stats.fallbackRatePct > 10 ? 'text-danger' : stats.fallbackRatePct > 0 ? 'text-warn' : 'text-ok'}
            tooltip={fallbackRateTooltip(stats)}
            detail={fallbackRateDetail()}
            to={healthLinks.fallbackRate}
          />
          <StatCard
            label={copy?.statLabels?.latency ?? 'Latency p50 / p95'}
            value={`${stats.avgLatencyMs} / ${stats.p95LatencyMs}ms`}
            tooltip={latencyTooltip(stats)}
            detail={latencyDetail()}
            to={healthLinks.latency}
          />
          <StatCard
            label={copy?.statLabels?.cron ?? 'Cron OK'}
            value={`${stats.cronHealthyCount}/${stats.cronJobCount}`}
            accent={stats.cronErrorCount > 0 ? 'text-danger' : stats.cronStaleCount > 0 ? 'text-warn' : 'text-ok'}
            tooltip={cronTooltip(stats)}
            detail={cronDetail(stats)}
            to={healthLinks.cron}
          />
          <StatCard
            label={copy?.statLabels?.lastCall ?? 'Last LLM call'}
            value={stats.lastLlmCallAt ? 'Recent' : '—'}
            accent={stats.lastLlmCallAt ? 'text-ok' : stats.hasAnyProject ? 'text-brand' : undefined}
            tooltip={lastCallTooltip(stats)}
            detail={lastCallDetail(stats)}
            to={healthLinks.lastCall}
          />
        </div>
      </Section>
      )}

      {activeTab === 'llm' && (
        <>
          <Section
            title={`LLM breakdown (${window})`}
            freshness={{ at: llmQuery.lastFetchedAt, isValidating: llmQuery.isValidating }}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4" data-dav-anchor="health:decide">
              <StatCard label="Total calls" value={llm.totalCalls.toString()} tooltip={totalCallsTooltip(llmTabStats)} detail={totalCallsDetail(llmTabStats)} to={healthLinks.totalCalls} />
              <StatCard
                label="Fallback rate"
                value={`${fallbackPct}%`}
                accent={llm.fallbackRate > 0.1 ? 'text-danger' : llm.fallbackRate > 0 ? 'text-warn' : 'text-ok'}
                tooltip={fallbackRateTooltip(llmTabStats)}
                detail={fallbackRateDetail()}
                to={healthLinks.fallbackRate}
              />
              <StatCard
                label="Error rate"
                value={`${errorPct}%`}
                accent={llm.errorRate > 0.05 ? 'text-danger' : llm.errorRate > 0 ? 'text-warn' : 'text-ok'}
                tooltip={errorRateTooltip(llmTabStats)}
                detail={errorRateDetail()}
                to={healthLinks.errorRate}
              />
              <StatCard
                label="Latency p50 / p95"
                value={`${llm.avgLatencyMs}ms / ${llm.p95LatencyMs ?? 0}ms`}
                tooltip={latencyTooltip(llmTabStats)}
                detail={latencyDetail()}
                to={healthLinks.latency}
              />
            </div>
          </Section>

          <Section title="Per-function breakdown">
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
              <div className="space-y-1.5">
                {fnNames.map((fn) => {
                  const f = byFunction[fn]
                  const isFiltered = fnFilter === fn
                  const costStr = `$${(f.costUsd ?? 0).toFixed((f.costUsd ?? 0) >= 1 ? 2 : 4)}`
                  return (
                    <Card key={fn} className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <code className="min-w-0 truncate font-mono text-2xs font-medium text-fg">{fn}</code>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <SignalChip tone="neutral">{f.calls} calls</SignalChip>
                        <SignalChip tone="info">avg {f.avgLatencyMs}ms</SignalChip>
                        <SignalChip tone="neutral">p95 {f.p95LatencyMs ?? 0}ms</SignalChip>
                        <SignalChip tone="brand">{costStr}</SignalChip>
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
                    </Card>
                  )
                })}
              </div>
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
              <div className="space-y-1.5">
                {Object.entries(byModel).map(([model, m]) => (
                  <Card key={model} className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <code className="min-w-0 truncate font-mono text-2xs text-fg-secondary">{model}</code>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <SignalChip tone="neutral">{m.calls} calls</SignalChip>
                      <SignalChip tone="info">{m.tokens.toLocaleString()} tokens</SignalChip>
                      {m.errors > 0 && (
                        <SignalChip tone="danger">
                          {m.errors} error{m.errors === 1 ? '' : 's'}
                        </SignalChip>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      {activeTab === 'cron' && (
        <Section
          title="Cron Jobs"
          freshness={{ at: cronQuery.lastFetchedAt, isValidating: cronQuery.isValidating }}
        >
          <div className="space-y-1" data-dav-anchor="health:verify">
            {KNOWN_JOBS.map((job) => {
              const j = cron?.byJob[job]
              const isManual = job !== 'data-retention'
              return (
                <Card key={job} className={`p-2.5 ${statusGlowClass(j?.lastStatus)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono font-medium">{job}</code>
                        {j ? (
                          <Badge className={j.lastStatus === 'success' ? 'bg-ok-muted text-ok' : j.lastStatus === 'error' ? 'bg-danger-muted text-danger' : 'bg-surface-overlay text-fg-muted'}>
                            {j.lastStatus ?? 'never'}
                          </Badge>
                        ) : (
                          <Badge className="bg-surface-overlay text-fg-muted">never run</Badge>
                        )}
                      </div>
                      {j ? (
                        <InlineProof className="mt-1.5">
                          Last: {j.lastRun ? new Date(j.lastRun).toLocaleString() : 'never'} · {j.runs} runs ·{' '}
                          <Pct
                            value={j.successRate * 100}
                            precision={0}
                            direction="higher-better"
                            hint="Share of runs that finished without errors across the full history of this job."
                          />{' '}
                          success · avg {j.avgDurationMs}ms
                          {j.staleness && j.staleness !== 'ok' && j.stalenessMinutes != null && (
                            <span className={j.staleness === 'stale' ? ' text-danger' : ' text-warn'}>
                              {' '}· {j.staleness} ({j.stalenessMinutes}m since last run)
                            </span>
                          )}
                        </InlineProof>
                      ) : (
                        <InlineProof className="mt-1.5">
                          No telemetry yet — job has not executed since the telemetry table was created.
                        </InlineProof>
                      )}
                    </div>
                    {isManual && (
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => triggerJob(job as 'judge-batch' | 'intelligence-report')}
                        loading={triggering === job}
                      >
                        Trigger now
                      </Btn>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        </Section>
      )}

      {activeTab === 'activity' && (
        <>
          <Section title="Provider probes">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2" data-dav-anchor="health:act">
              {(['anthropic', 'openai'] as const).map((kind) => {
                const r = probeResults[kind]
                const statusColor = r?.status === 'ok'
                  ? 'bg-ok-muted text-ok'
                  : r?.status === 'degraded'
                    ? 'bg-warn-muted text-warn'
                    : r?.status === 'down'
                      ? 'bg-danger-muted text-danger'
                      : 'bg-surface-overlay text-fg-muted'
                return (
                  <Card key={kind} className="p-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono font-medium capitalize">{kind}</code>
                          <Badge className={statusColor}>{r?.status ?? 'not probed'}</Badge>
                        </div>
                        <InlineProof className="mt-1 border-0 bg-transparent px-0 py-0">
                          {r
                            ? `${r.latencyMs}ms · last probed ${new Date(r.at).toLocaleTimeString()}${r.detail ? ` · ${r.detail.slice(0, 120)}` : ''}`
                            : 'Runs a 1-token round-trip against the provider\'s live API. Abort after 5s if upstream is stuck.'}
                        </InlineProof>
                      </div>
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => probeProvider(kind)}
                        loading={probing === kind}
                      >
                        Probe now
                      </Btn>
                    </div>
                  </Card>
                )
              })}
            </div>
          </Section>

          <Section
            title={fnFilter ? `Recent LLM calls · filtered to ${fnFilter}` : 'Recent LLM calls'}
            action={
              <FilterSelect
                label="Show"
                value={recentFilter}
                options={RECENT_FILTER_OPTIONS}
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
                  : 'Once Mushi processes a report, every model call lands here with the full trace one click away in Langfuse.'}
              />
            ) : (
              <div className="space-y-0.5 font-mono text-2xs">
                {filteredRecent.map((r, i) => {
                  const traceUrl = langfuseTraceUrl(r.langfuse_trace_id)
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-overlay/40"
                    >
                      <span className="text-fg-faint w-32 truncate">{new Date(r.created_at).toLocaleTimeString()}</span>
                      <span className="text-fg-secondary w-32 truncate">{r.function_name}</span>
                      <span className="text-fg w-48 truncate">{r.used_model}</span>
                      {r.fallback_used && <Badge className="bg-warn-muted text-warn">fallback</Badge>}
                      {r.status !== 'success' && <Badge className="bg-danger-muted text-danger">{r.status}</Badge>}
                      {r.key_source && r.key_source !== 'env' && <Badge className="bg-info-muted text-info">{r.key_source}</Badge>}
                      <span className="text-fg-muted ml-auto">{r.latency_ms ?? '?'}ms</span>
                      <span className="text-fg-faint w-24 text-right">{(r.input_tokens ?? 0) + (r.output_tokens ?? 0)} tok</span>
                      {r.report_id && (
                        <Link to={`/reports/${r.report_id}`} className="text-brand hover:underline shrink-0" title="Open report">
                          report
                        </Link>
                      )}
                      {traceUrl ? (
                        <a
                          href={traceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand hover:underline shrink-0"
                          title="Open Langfuse trace"
                        >
                          trace ↗
                        </a>
                      ) : (
                        <span className="text-fg-faint shrink-0" title="No Langfuse trace recorded">—</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
