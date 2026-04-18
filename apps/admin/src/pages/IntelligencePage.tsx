/**
 * FILE: apps/admin/src/pages/IntelligencePage.tsx
 * PURPOSE: V5.3 §2.16 — weekly LLM-authored bug intelligence digests.
 *          Generation is async (jobs queue) so the UI no longer hangs
 *          for 30s+ when the LLM call is slow. Shows live progress card
 *          and lets the user cancel a stuck job.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiFetchRaw } from '../lib/supabase'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  Loading,
  ErrorAlert,
  EmptyState,
  Toggle,
  Badge,
  RelativeTime,
} from '../components/ui'
import { useToast } from '../lib/toast'

interface IntelligenceReport {
  id: string
  project_id: string
  week_start: string
  summary_md: string
  stats: {
    reports?: { total?: number; byCategory?: Record<string, number>; bySeverity?: Record<string, number> }
    fixes?: { total?: number; completed?: number; completionRate?: number; avgDurationSeconds?: number | null }
  } | null
  benchmarks: { optedIn?: boolean; reason?: string; buckets?: unknown[] } | null
  llm_model: string | null
  generated_by: string
  created_at: string
}

interface IntelligenceJob {
  id: string
  project_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  trigger: string
  report_id: string | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

interface BenchmarkSettings {
  optIn: boolean
  optInAt: string | null
}

interface ModernizationFinding {
  id: string
  project_id: string
  repo_id: string | null
  dep_name: string
  current_version: string | null
  suggested_version: string | null
  manifest_path: string | null
  summary: string
  severity: 'major' | 'minor' | 'security' | 'deprecated'
  changelog_url: string | null
  related_report_id: string | null
  status: 'pending' | 'dispatched' | 'dismissed'
  detected_at: string
}

const SEVERITY_TONE: Record<ModernizationFinding['severity'], string> = {
  security: 'bg-danger/15 text-danger border border-danger/30',
  deprecated: 'bg-warn/15 text-warn border border-warn/30',
  major: 'bg-warn/10 text-warn border border-warn/30',
  minor: 'bg-fg-faint/10 text-fg-muted border border-edge-subtle',
}

const JOB_STATUS_TONE: Record<IntelligenceJob['status'], string> = {
  queued: 'bg-info/15 text-info border border-info/30',
  running: 'bg-brand/15 text-brand border border-brand/30',
  completed: 'bg-ok/15 text-ok border border-ok/30',
  failed: 'bg-danger/15 text-danger border border-danger/30',
  cancelled: 'bg-fg-faint/15 text-fg-muted border border-edge-subtle',
}

export function IntelligencePage() {
  const [reports, setReports] = useState<IntelligenceReport[]>([])
  const [jobs, setJobs] = useState<IntelligenceJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [benchmark, setBenchmark] = useState<BenchmarkSettings>({ optIn: false, optInAt: null })
  const [findings, setFindings] = useState<ModernizationFinding[]>([])
  const [dispatchingId, setDispatchingId] = useState<string | null>(null)
  const toast = useToast()
  const pollRef = useRef<number | null>(null)

  const fetchData = useCallback(async () => {
    setError(false)
    const [reportsRes, settingsRes, jobsRes, findingsRes] = await Promise.all([
      apiFetch<{ reports: IntelligenceReport[] }>('/v1/admin/intelligence'),
      apiFetch<{ benchmarking_optin?: boolean; benchmarking_optin_at?: string | null }>('/v1/admin/settings'),
      apiFetch<{ jobs: IntelligenceJob[] }>('/v1/admin/intelligence/jobs'),
      apiFetch<{ findings: ModernizationFinding[] }>('/v1/admin/modernization?status=pending'),
    ])
    if (reportsRes.ok && reportsRes.data) setReports(reportsRes.data.reports)
    else setError(true)
    if (settingsRes.ok && settingsRes.data) {
      setBenchmark({
        optIn: settingsRes.data.benchmarking_optin === true,
        optInAt: settingsRes.data.benchmarking_optin_at ?? null,
      })
    }
    if (jobsRes.ok && jobsRes.data) setJobs(jobsRes.data.jobs)
    if (findingsRes.ok && findingsRes.data) setFindings(findingsRes.data.findings)
    setLoading(false)
  }, [])

  const dispatchFinding = async (id: string) => {
    setDispatchingId(id)
    try {
      const res = await apiFetch<{ dispatchId: string }>(`/v1/admin/modernization/${id}/dispatch`, { method: 'POST' })
      if (res.ok) {
        toast.push({ tone: 'success', message: 'Modernization fix dispatched — track on Fixes page' })
        await fetchData()
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
      setFindings((prev) => prev.filter((f) => f.id !== id))
      toast.push({ tone: 'info', message: 'Dismissed' })
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Dismiss failed' })
    }
  }

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // Auto-poll while any job is queued/running so the progress card stays
  // honest. Stop polling when nothing is in flight to avoid wasted requests.
  useEffect(() => {
    const inFlight = jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (!inFlight) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    if (pollRef.current) return
    pollRef.current = window.setInterval(() => {
      void fetchData()
    }, 3000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [jobs, fetchData])

  const generateNow = async () => {
    setGenerating(true)
    try {
      const res = await apiFetch<{ jobId: string; deduplicated?: boolean }>(
        '/v1/admin/intelligence',
        { method: 'POST' },
      )
      if (res.ok && res.data) {
        if (res.data.deduplicated) {
          toast.push({ tone: 'info', message: 'A generation job is already running' })
        } else {
          toast.push({ tone: 'success', message: 'Generation started — watch the progress card below' })
        }
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Failed to enqueue job' })
      }
      await fetchData()
    } finally {
      setGenerating(false)
    }
  }

  const cancelJob = async (id: string) => {
    const res = await apiFetch(`/v1/admin/intelligence/jobs/${id}/cancel`, {
      method: 'POST',
    })
    if (res.ok) {
      toast.push({ tone: 'info', message: 'Job cancelled' })
      await fetchData()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Cancel failed' })
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

  const activeJob = jobs.find((j) => j.status === 'queued' || j.status === 'running')
  const recentJobs = jobs.slice(0, 5)

  return (
    <div className="space-y-3">
      <PageHeader title="Bug Intelligence">
        <Btn onClick={generateNow} disabled={generating || !!activeJob}>
          {activeJob ? 'Generating…' : generating ? 'Enqueuing…' : 'Generate this week'}
        </Btn>
      </PageHeader>

      <PageHelp
        title="About Bug Intelligence"
        whatIsIt="Weekly LLM-authored digest of your bug pipeline — trends, fix velocity, hotspots, and recommendations. Each report is persisted, versioned, and exportable as PDF."
        useCases={[
          'Share a one-page status with stakeholders every Monday',
          'Spot regressions early — week-over-week category and severity drift',
          'Compare your fix velocity against anonymised industry benchmarks (opt-in)',
        ]}
        howToUse="Reports are generated automatically every Monday by cron. Click Generate to run for the current week — the job runs in the background and the progress card below stays live. If a job is wedged you can cancel it."
      />

      {activeJob && (
        <Card elevated className="p-3 border border-brand/30">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-fg">
                  Generation in progress
                </span>
                <Badge className={JOB_STATUS_TONE[activeJob.status]}>
                  {activeJob.status}
                </Badge>
              </div>
              <p className="text-2xs text-fg-muted">
                Started <RelativeTime value={activeJob.started_at ?? activeJob.created_at} />
                {' · '}LLM call typically takes 20–60s
              </p>
              <div className="mt-2 h-1 rounded-full bg-edge-subtle overflow-hidden">
                <div className="h-full w-1/3 bg-brand animate-pulse rounded-full" />
              </div>
            </div>
            <Btn variant="ghost" size="sm" onClick={() => void cancelJob(activeJob.id)}>
              Cancel
            </Btn>
          </div>
        </Card>
      )}

      {!activeJob && recentJobs.some((j) => j.status === 'failed') && (
        <Card className="p-3 border border-danger/30 bg-danger/5">
          <div className="text-xs font-semibold text-danger mb-1">
            Last generation failed
          </div>
          <p className="text-2xs text-fg-muted">
            {recentJobs.find((j) => j.status === 'failed')?.error ??
              'Unknown error.'}
            {' '}Check Settings → LLM Keys to confirm your BYOK key is valid, then retry.
          </p>
        </Card>
      )}

      <Card className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-fg uppercase tracking-wider mb-1">Cross-customer benchmarking</div>
            <p className="text-2xs text-fg-muted max-w-xl leading-relaxed">
              Opt in to share aggregated, anonymised report metrics with other Mushi Mushi tenants. We enforce
              k-anonymity (≥ 5 contributing projects per bucket) — no project IDs, names, or report content
              ever leak. Opt out any time.
              {benchmark.optInAt && (
                <span className="block mt-1 text-fg-faint">
                  Opted in {new Date(benchmark.optInAt).toLocaleString()}.
                </span>
              )}
            </p>
          </div>
          <Toggle checked={benchmark.optIn} onChange={toggleOptIn} label={benchmark.optIn ? 'Sharing on' : 'Sharing off'} />
        </div>
      </Card>

      {findings.length > 0 && (
        <Card className="p-3">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-2xs uppercase tracking-wider text-fg-muted">
              Library Modernization
              <span className="ml-2 text-fg-faint normal-case tracking-normal">
                {findings.length} pending finding{findings.length === 1 ? '' : 's'}
              </span>
            </h3>
            <span className="text-2xs text-fg-faint">Weekly cron · Firecrawl-augmented</span>
          </div>
          <ul className="space-y-1.5">
            {findings.map((f) => (
              <li
                key={f.id}
                className="flex items-start justify-between gap-3 border-t border-edge-subtle pt-1.5 first:border-0 first:pt-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge className={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                    <span className="text-xs font-mono text-fg">{f.dep_name}</span>
                    {f.current_version && f.suggested_version && (
                      <span className="text-2xs text-fg-muted font-mono">
                        {f.current_version} → {f.suggested_version}
                      </span>
                    )}
                  </div>
                  <p className="text-2xs text-fg-secondary leading-relaxed">{f.summary}</p>
                  <div className="mt-1 flex items-center gap-2 text-2xs text-fg-faint">
                    <RelativeTime value={f.detected_at} />
                    {f.changelog_url && (
                      <>
                        <span>·</span>
                        <a
                          href={f.changelog_url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-fg-secondary underline"
                        >
                          changelog
                        </a>
                      </>
                    )}
                    {f.manifest_path && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{f.manifest_path}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Btn
                    size="sm"
                    onClick={() => void dispatchFinding(f.id)}
                    disabled={!f.related_report_id || dispatchingId === f.id}
                    title={f.related_report_id ? 'Dispatch fix-worker' : 'Minor finding — no auto-dispatch'}
                  >
                    {dispatchingId === f.id ? 'Dispatching…' : 'Dispatch fix'}
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void dismissFinding(f.id)}>
                    Dismiss
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {recentJobs.length > 0 && (
        <Card className="p-3">
          <div className="flex items-baseline justify-between mb-1.5">
            <h3 className="text-2xs uppercase tracking-wider text-fg-muted">
              Recent generation jobs
            </h3>
          </div>
          <ul className="space-y-1 text-2xs">
            {recentJobs.map((j) => (
              <li
                key={j.id}
                className="flex items-center justify-between gap-2 border-t border-edge-subtle pt-1 first:border-0 first:pt-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge className={JOB_STATUS_TONE[j.status]}>{j.status}</Badge>
                  <span className="text-fg-muted">
                    Started <RelativeTime value={j.started_at ?? j.created_at} />
                  </span>
                  {j.finished_at && j.started_at && (
                    <span className="text-fg-faint font-mono">
                      {Math.round(
                        (new Date(j.finished_at).getTime() -
                          new Date(j.started_at).getTime()) /
                          1000,
                      )}
                      s
                    </span>
                  )}
                </div>
                {j.error && (
                  <span
                    className="text-danger truncate max-w-md"
                    title={j.error}
                  >
                    {j.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {loading ? <Loading /> : error ? <ErrorAlert message="Failed to load intelligence reports." onRetry={fetchData} /> : reports.length === 0 ? (
        <EmptyState
          title="No intelligence reports yet"
          description="Reports are generated weekly by the cron job. Click Generate above to produce one immediately."
        />
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <Card key={r.id} className="p-3">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-xs font-medium text-fg">Week of {r.week_start}</span>
                  <span className="text-2xs text-fg-faint">{r.generated_by}</span>
                  {r.benchmarks?.optedIn && (
                    <span className="text-2xs text-success">benchmarks ✓</span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" onClick={() => downloadPdf(r.id, r.week_start)}>
                    Download PDF
                  </Btn>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-2xs">
                <Stat label="Reports" value={r.stats?.reports?.total?.toString() ?? '—'} />
                <Stat label="Fix attempts" value={r.stats?.fixes?.total?.toString() ?? '—'} />
                <Stat
                  label="Completion"
                  value={
                    r.stats?.fixes?.completionRate != null
                      ? `${Math.round(r.stats.fixes.completionRate * 100)}%`
                      : '—'
                  }
                />
                <Stat
                  label="Avg fix"
                  value={
                    r.stats?.fixes?.avgDurationSeconds != null && r.stats.fixes.avgDurationSeconds > 0
                      ? `${(r.stats.fixes.avgDurationSeconds / 60).toFixed(1)} min`
                      : '—'
                  }
                />
              </div>

              <details className="group">
                <summary className="cursor-pointer text-2xs text-fg-muted hover:text-fg-secondary">
                  Read summary
                </summary>
                <div className="mt-2 p-2 rounded-sm bg-surface-raised/50 border border-edge-subtle text-xs text-fg-secondary whitespace-pre-wrap leading-relaxed">
                  {r.summary_md}
                </div>
              </details>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-fg-faint">{label}</div>
      <div className="text-fg font-mono tabular-nums">{value}</div>
    </div>
  )
}
