import { useCallback, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { useRealtime } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { PageHeader, PageHelp, Card, Badge, Btn, EmptyState, Loading, ErrorAlert, StatCard, RecommendedAction } from '../components/ui'

interface LlmHealth {
  window: string
  totalCalls: number
  fallbacks: number
  fallbackRate: number
  errors: number
  errorRate: number
  avgLatencyMs: number
  p95LatencyMs: number
  byModel: Record<string, { calls: number; errors: number; tokens: number }>
  recent: Array<{
    function_name: string
    used_model: string
    primary_model: string
    fallback_used: boolean
    status: string
    latency_ms: number | null
    input_tokens: number | null
    output_tokens: number | null
    created_at: string
  }>
}

interface CronJobHealth {
  lastRun: string | null
  lastStatus: string | null
  successRate: number
  avgDurationMs: number
  runs: number
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

export function HealthPage() {
  const toast = useToast()
  const llmQuery = usePageData<LlmHealth>('/v1/admin/health/llm')
  const cronQuery = usePageData<CronHealth>('/v1/admin/health/cron')
  const [triggering, setTriggering] = useState<string | null>(null)

  const llm = llmQuery.data
  const cron = cronQuery.data

  const reloadAll = useCallback(() => {
    llmQuery.reload()
    cronQuery.reload()
  }, [llmQuery, cronQuery])

  useRealtime({ table: 'llm_invocations' }, llmQuery.reload)
  useRealtime({ table: 'cron_runs' }, cronQuery.reload)

  async function triggerJob(job: 'judge-batch' | 'intelligence-report') {
    setTriggering(job)
    const res = await apiFetch(`/v1/admin/health/cron/${job}/trigger`, { method: 'POST' })
    setTriggering(null)
    if (!res.ok) {
      toast.error(`Could not trigger ${job}`, res.error?.message)
      return
    }
    toast.success(`Triggered ${job}`)
    reloadAll()
  }

  if (llmQuery.loading || cronQuery.loading) return <Loading text="Loading health metrics..." />
  if (llmQuery.error || !llm) return <ErrorAlert message={`Failed to load health metrics: ${llmQuery.error ?? 'no data'}`} onRetry={reloadAll} />

  const fallbackPct = (llm.fallbackRate * 100).toFixed(1)
  const errorPct = (llm.errorRate * 100).toFixed(1)

  return (
    <div className="space-y-4">
      <PageHeader title="System Health" description="Real-time LLM and scheduled-job telemetry. Updates as events arrive." />

      <PageHelp
        title="About System Health"
        whatIsIt="Live operational dashboard showing every LLM call routed by Mushi Mushi (Anthropic primary, OpenAI fallback) and every scheduled job (judge, intelligence, retention). Each event is written to a telemetry table and streamed here via Supabase Realtime."
        useCases={[
          'Catch when Anthropic rate-limits cause a fallback storm',
          'See if scheduled jobs (cron) are actually running, succeeding, and on time',
          'Spot model-level latency regressions before they impact users',
        ]}
        howToUse="No action needed for healthy state. If fallback rate spikes, check Anthropic status. If a cron job hasn't run in its expected window, trigger it manually with the buttons below."
      />

      {(() => {
        const failingCron = KNOWN_JOBS.filter((j) => cron?.byJob[j]?.lastStatus === 'error')
        if (llm.errorRate > 0.05) {
          return (
            <RecommendedAction
              tone="urgent"
              title={`LLM error rate is ${errorPct}% over the last 24h`}
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
              title="No LLM activity in the last 24 hours"
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

      <section>
        <h2 className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">LLM Health (24h)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard label="Total calls" value={llm.totalCalls.toString()} />
          <StatCard
            label="Fallback rate"
            value={`${fallbackPct}%`}
            accent={llm.fallbackRate > 0.1 ? 'text-danger' : llm.fallbackRate > 0 ? 'text-warn' : 'text-ok'}
          />
          <StatCard
            label="Error rate"
            value={`${errorPct}%`}
            accent={llm.errorRate > 0.05 ? 'text-danger' : llm.errorRate > 0 ? 'text-warn' : 'text-ok'}
          />
          <StatCard label="Latency p50 / p95" value={`${llm.avgLatencyMs}ms / ${llm.p95LatencyMs}ms`} />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">Per-model breakdown</h3>
        {Object.keys(llm.byModel).length === 0 ? (
          <EmptyState title="No LLM activity in the last 24 hours" />
        ) : (
          <div className="space-y-1">
            {Object.entries(llm.byModel).map(([model, m]) => (
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
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Cron Jobs</h2>
        </div>
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
                        Last: {j.lastRun ? new Date(j.lastRun).toLocaleString() : 'never'} · {j.runs} runs · {(j.successRate * 100).toFixed(0)}% success · avg {j.avgDurationMs}ms
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
                      disabled={triggering === job}
                    >
                      {triggering === job ? 'Triggering...' : 'Trigger now'}
                    </Btn>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">Recent LLM calls</h3>
        {llm.recent.length === 0 ? (
          <EmptyState title="No recent calls" />
        ) : (
          <div className="space-y-0.5 font-mono text-2xs">
            {llm.recent.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-overlay/40">
                <span className="text-fg-faint w-32 truncate">{new Date(r.created_at).toLocaleTimeString()}</span>
                <span className="text-fg-secondary w-32 truncate">{r.function_name}</span>
                <span className="text-fg w-48 truncate">{r.used_model}</span>
                {r.fallback_used && <Badge className="bg-warn-muted text-warn">fallback</Badge>}
                {r.status !== 'success' && <Badge className="bg-danger-muted text-danger">{r.status}</Badge>}
                <span className="text-fg-muted ml-auto">{r.latency_ms ?? '?'}ms</span>
                <span className="text-fg-faint w-24 text-right">{(r.input_tokens ?? 0) + (r.output_tokens ?? 0)} tok</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
