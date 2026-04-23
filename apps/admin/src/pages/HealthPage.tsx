/**
 * FILE: apps/admin/src/pages/HealthPage.tsx
 * PURPOSE: Real-time LLM + cron telemetry. Switch the time window, see per-
 *          model and per-function breakdowns, manually trigger cron jobs, and
 *          deep-link individual LLM calls into Langfuse for full trace
 *          inspection.
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
  PageHeader,
  PageHelp,
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
} from '../components/ui'
import { HealthSkeleton } from '../components/skeletons/HealthSkeleton'
import { HeroPulseHealth, HeroSearch } from '../components/illustrations/HeroIllustrations'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageCopy } from '../lib/copy'
import { PageActionBar } from '../components/PageActionBar'
import { PageHero } from '../components/PageHero'
import { useNextBestAction } from '../lib/useNextBestAction'
import { markJudgeBatchSeen } from '../components/PipelineStatusRibbon'

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
  // added p95LatencyMs to the API. Optional here so older deployed
  // Edge Functions (or partial-rollout staging envs) don't crash the page —
  // the render uses `?? 0` everywhere this is read.
  p95LatencyMs?: number
  byModel: Record<string, { calls: number; errors: number; tokens: number }>
  byFunction: Record<string, {
    calls: number
    errors: number
    fallbacks: number
    avgLatencyMs: number
    // Same rollout: optional so a stale Edge Function doesn't break
    // the per-function rows. Render with `?? 0`.
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
  /** Minutes since last run; optional for older Edge Function deployments
   *  that haven't picked up the staleness fields yet. */
  stalenessMinutes?: number | null
  /** Staleness tier. Optional for the same rollout reason. */
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

export function HealthPage() {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/health')
  const [searchParams, setSearchParams] = useSearchParams()
  const window = searchParams.get('window') ?? '24h'
  const recentFilter = searchParams.get('recent') ?? ''
  const fnFilter = searchParams.get('fn') ?? ''

  const llmQuery = usePageData<LlmHealth>(`/v1/admin/health/llm?window=${window}`, { deps: [window] })
  const cronQuery = usePageData<CronHealth>('/v1/admin/health/cron')
  const [triggering, setTriggering] = useState<string | null>(null)
  const [probing, setProbing] = useState<string | null>(null)
  const [probeResults, setProbeResults] = useState<Record<string, { status: string; latencyMs: number; detail?: string; at: string }>>({})

  const llm = llmQuery.data
  const cron = cronQuery.data

  const reloadAll = useCallback(() => {
    llmQuery.reload()
    cronQuery.reload()
  }, [llmQuery, cronQuery])

  useRealtime({ table: 'llm_invocations' }, llmQuery.reload)
  useRealtime({ table: 'cron_runs' }, cronQuery.reload)

  // Feed the PipelineStatusRibbon's Check tile. HealthPage is the only
  // place today that knows when judge-batch last finished; stamping it
  // into localStorage lets every other page show a freshness badge
  // without re-querying the cron summary.
  useEffect(() => {
    const lastRun = cron?.byJob['judge-batch']?.lastRun
    if (!lastRun) return
    const ts = Date.parse(lastRun)
    if (!Number.isFinite(ts)) return
    markJudgeBatchSeen(ts)
  }, [cron])

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

  // Publish page context so the browser tab reads e.g.
  // "Health · All systems nominal — Mushi Mushi" or
  // "Health · 2 errors · 1 cron down — Mushi Mushi" from another tab.
  const healthRed =
    (llm?.errorRate ?? 0) > 0.05
      ? 1
      : 0 + KNOWN_JOBS.filter((j) => cron?.byJob[j]?.lastStatus === 'error').length
  const healthAmber =
    (llm?.fallbackRate ?? 0) > 0.1
      ? 1
      : 0 + KNOWN_JOBS.filter((j) => cron?.byJob[j]?.lastStatus === 'warn').length
  usePublishPageContext({
    route: '/health',
    title: projectName ? `Health · ${projectName}` : 'Health',
    summary: llmQuery.loading
      ? 'Loading health metrics…'
      : !llm
        ? undefined
        : healthRed > 0
          ? `${healthRed} red · ${llm.totalCalls} calls · ${((llm.errorRate ?? 0) * 100).toFixed(1)}% errors`
          : healthAmber > 0
            ? `${healthAmber} warning · ${llm.totalCalls} calls`
            : `All systems nominal · ${llm.totalCalls} calls`,
    criticalCount: healthRed,
  })

  if (llmQuery.loading || cronQuery.loading) return <HealthSkeleton />
  if (llmQuery.error || !llm) return <ErrorAlert message={`Failed to load health metrics: ${llmQuery.error ?? 'no data'}`} onRetry={reloadAll} />

  const fallbackPct = ((llm.fallbackRate ?? 0) * 100).toFixed(1)
  const errorPct = ((llm.errorRate ?? 0) * 100).toFixed(1)
  const byFunction = llm.byFunction ?? {}
  const byModel = llm.byModel ?? {}
  const fnNames = Object.keys(byFunction).sort()

  // Shared NBA inputs for the hero + action bar (one hook call per render).
  const redCount =
    (llm.errorRate > 0.05 ? 1 : 0) +
    KNOWN_JOBS.filter((j) => cron?.byJob[j]?.lastStatus === 'error').length
  const amberCount =
    (llm.fallbackRate > 0.1 ? 1 : 0) +
    KNOWN_JOBS.filter((j) => cron?.byJob[j]?.lastStatus === 'warn').length
  const healthAction = useNextBestAction({ scope: 'health', redCount, amberCount })
  const healthSeverity: 'ok' | 'warn' | 'crit' | 'neutral' =
    redCount > 0 ? 'crit' : amberCount > 0 ? 'warn' : 'ok'
  const lastLlmCall = llm.recent?.[0]

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'System Health'}
        projectScope={projectName}
        description={copy?.description ?? 'Real-time LLM and scheduled-job telemetry. Updates as events arrive.'}
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
        <Btn variant="ghost" size="sm" onClick={reloadAll}>Refresh</Btn>
      </PageHeader>

      <PageHero
        scope="health"
        title={copy?.title ?? 'System Health'}
        kicker="Pipeline pulse"
        decide={{
          label: redCount > 0
            ? 'Critical probes failing'
            : amberCount > 0
              ? 'Degraded probes'
              : 'All systems nominal',
          metric: `${llm.totalCalls} calls · ${errorPct}% err`,
          summary: redCount > 0
            ? `${redCount} red probe${redCount === 1 ? '' : 's'} — blocking the pipeline. Act now.`
            : amberCount > 0
              ? `${amberCount} amber probe${amberCount === 1 ? '' : 's'} — fallbacks or slow jobs, not yet blocking.`
              : `Fallback rate ${fallbackPct}% · avg ${Math.round(llm.avgLatencyMs)}ms (${window}).`,
          severity: healthSeverity,
        }}
        act={healthAction}
        verify={{
          label: lastLlmCall ? `Last LLM call · ${lastLlmCall.used_model}` : 'Awaiting first call',
          detail: lastLlmCall
            ? `${lastLlmCall.function_name} · ${new Date(lastLlmCall.created_at).toISOString().slice(11, 19)}Z`
            : '—',
          to: lastLlmCall?.report_id ? `/reports/${lastLlmCall.report_id}` : '/reports',
          secondaryTo: '/audit',
          secondaryLabel: 'Open audit log',
        }}
      />

      <PageActionBar scope="health" action={healthAction} />

      <PageHelp
        title={copy?.help?.title ?? 'About System Health'}
        whatIsIt={copy?.help?.whatIsIt ?? 'Live operational dashboard showing every LLM call routed by Mushi Mushi (Anthropic primary, OpenAI fallback) and every scheduled job (judge, intelligence, retention). Each event is written to a telemetry table and streamed here via Supabase Realtime.'}
        useCases={copy?.help?.useCases ?? [
          'Catch when Anthropic rate-limits cause a fallback storm',
          'See if scheduled jobs (cron) are actually running, succeeding, and on time',
          'Spot model-level latency regressions before they impact users',
        ]}
        howToUse={copy?.help?.howToUse ?? "No action needed for healthy state. If fallback rate spikes, check Anthropic status. If a cron job hasn't run in its expected window, trigger it manually with the buttons below. Click any LLM call to open its Langfuse trace."}
      />

      {(() => {
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
      })()}

      <Section title={`LLM Health (${window})`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard
            label="Total calls"
            value={llm.totalCalls.toString()}
            hint={`Number of LLM calls made in the last ${window}. Includes every provider and every function.`}
          />
          <StatCard
            label="Fallback rate"
            value={`${fallbackPct}%`}
            accent={llm.fallbackRate > 0.1 ? 'text-danger' : llm.fallbackRate > 0 ? 'text-warn' : 'text-ok'}
            hint="Share of calls that hit the secondary provider because the primary failed. Above 10 % suggests the primary is flaky or rate-limiting."
          />
          <StatCard
            label="Error rate"
            value={`${errorPct}%`}
            accent={llm.errorRate > 0.05 ? 'text-danger' : llm.errorRate > 0 ? 'text-warn' : 'text-ok'}
            hint="Share of calls that ended in a non-recoverable error. Above 5 % usually means an outage or bad API key."
          />
          <StatCard
            label="Latency p50 / p95"
            value={`${llm.avgLatencyMs}ms / ${llm.p95LatencyMs ?? 0}ms`}
            hint="Median / 95th-percentile round-trip latency across all LLM calls. p95 is the worst typical case a user will feel."
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
          <div className="space-y-1">
            {fnNames.map((fn) => {
              const f = byFunction[fn]
              const isFiltered = fnFilter === fn
              return (
                <Card key={fn} className="p-2.5 flex items-center justify-between text-xs gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="font-mono text-2xs text-fg font-medium truncate">{fn}</code>
                  </div>
                  <div className="flex items-center gap-3 text-2xs text-fg-muted shrink-0 flex-wrap justify-end">
                    <span>{f.calls} calls</span>
                    <span title="Average call latency">avg {f.avgLatencyMs}ms</span>
                    <span title="95th percentile latency over the window">p95 {f.p95LatencyMs ?? 0}ms</span>
                    <span title="Estimated USD spend over the window">${(f.costUsd ?? 0).toFixed((f.costUsd ?? 0) >= 1 ? 2 : 4)}</span>
                    {f.fallbacks > 0 && <Badge className="bg-warn-muted text-warn">{f.fallbacks} fallback{f.fallbacks === 1 ? '' : 's'}</Badge>}
                    {f.errors > 0 && <Badge className="bg-danger-muted text-danger">{f.errors} error{f.errors === 1 ? '' : 's'}</Badge>}
                    {f.lastFailureAt && (
                      <span className="text-danger" title={`Last failure ${new Date(f.lastFailureAt).toLocaleString()}`}>
                        last failure <RelativeTime value={f.lastFailureAt} />
                      </span>
                    )}
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => updateParam('fn', isFiltered ? '' : fn)}
                    >
                      {isFiltered ? 'Clear filter' : 'Filter recent'}
                    </Btn>
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
          <div className="space-y-1">
            {Object.entries(byModel).map(([model, m]) => (
              <Card key={model} className="p-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-2xs text-fg-secondary truncate">{model}</code>
                </div>
                <div className="flex items-center gap-3 text-2xs text-fg-muted flex-shrink-0">
                  <span>{m.calls} calls</span>
                  <span>{m.tokens.toLocaleString()} tokens</span>
                  {m.errors > 0 && <Badge className="bg-danger-muted text-danger">{m.errors} errors</Badge>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Provider probes">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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
                    <p className="mt-1 text-2xs text-fg-faint">
                      {r
                        ? `${r.latencyMs}ms · last probed ${new Date(r.at).toLocaleTimeString()}${r.detail ? ` · ${r.detail.slice(0, 120)}` : ''}`
                        : 'Runs a 1-token round-trip against the provider\'s live API. Abort after 5s if upstream is stuck.'}
                    </p>
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

      <Section title="Cron Jobs">
        <div className="space-y-1">
          {KNOWN_JOBS.map(job => {
            const j = cron?.byJob[job]
            const isManual = job !== 'data-retention'
            return (
              <Card key={job} className="p-2.5">
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
                      <p className="mt-1 text-2xs text-fg-faint">
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
                      </p>
                    ) : (
                      <p className="mt-1 text-2xs text-fg-faint">No telemetry yet — job has not executed since the telemetry table was created.</p>
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
    </div>
  )
}
