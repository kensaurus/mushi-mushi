/**
 * FILE: apps/admin/src/pages/IntelligencePage.tsx
 * PURPOSE: V5.3 §2.16 — weekly LLM-authored bug intelligence digests.
 *          Page-level orchestration only — data load, polling, mutation
 *          handlers. Visual pieces live in components/intelligence/* so the
 *          job card, modernization findings, opt-in toggle, and report card
 *          can each evolve in isolation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiFetchRaw } from '../lib/supabase'
import { PageHeader, PageHelp, Card, Btn, ErrorAlert, EmptyState } from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { useToast } from '../lib/toast'
import {
  ActiveJobCard,
  LastFailureNote,
  RecentJobsList,
} from '../components/intelligence/IntelligenceJobs'
import { BenchmarkOptInCard } from '../components/intelligence/BenchmarkOptInCard'
import { ModernizationFindings } from '../components/intelligence/ModernizationFindings'
import { IntelligenceReportCard } from '../components/intelligence/IntelligenceReportCard'
import { PageActionBar } from '../components/PageActionBar'
import { useNextBestAction } from '../lib/useNextBestAction'
import { PageHero } from '../components/PageHero'
import { usePublishPageContext } from '../lib/pageContext'
import type {
  BenchmarkSettings,
  IntelligenceJob,
  IntelligenceReport,
  ModernizationFinding,
} from '../components/intelligence/types'

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

  const dispatchFinding = async (id: string) => {
    setDispatchingId(id)
    try {
      const res = await apiFetch<{ dispatchId: string }>(
        `/v1/admin/modernization/${id}/dispatch`,
        { method: 'POST' },
      )
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
    const res = await apiFetch(`/v1/admin/intelligence/jobs/${id}/cancel`, { method: 'POST' })
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

  usePublishPageContext({
    route: '/intelligence',
    title: 'Intelligence',
    summary: loading
      ? 'Loading digests…'
      : activeJob
        ? `Generating this week · ${activeJob.status}`
        : reports.length === 0
          ? 'No digests yet'
          : `${reports.length} digest${reports.length === 1 ? '' : 's'}${findings.length > 0 ? ` · ${findings.length} modernization finding${findings.length === 1 ? '' : 's'}` : ''}`,
    criticalCount: findings.length,
  })

  // IA-4 (Wave S): derive hero inputs once so the Decide / Act / Verify
  // tiles and the PageActionBar share the same rule engine state. Done
  // at the top of the render body to keep `useNextBestAction` unconditional.
  const lastDigestHoursAgo = reports[0]?.created_at
    ? Math.floor((Date.now() - new Date(reports[0].created_at).getTime()) / 3_600_000)
    : null
  const intelligenceAction = useNextBestAction({
    scope: 'intelligence',
    lastDigestHoursAgo,
    topCategory: null,
    weekReports: reports.length,
  })
  const intelligenceSeverity: 'ok' | 'info' | 'warn' =
    lastDigestHoursAgo == null || lastDigestHoursAgo > 7 * 24
      ? 'warn'
      : findings.length > 0
        ? 'info'
        : 'ok'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bug Intelligence"
        description="Aggregate signals across reports — hotspot components, regression patterns, and shifting severity trends."
      >
        <Btn onClick={generateNow} disabled={generating || !!activeJob} loading={generating || !!activeJob}>
          {activeJob ? 'Generating' : 'Generate this week'}
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
          metric:
            findings.length > 0
              ? `${findings.length} finding${findings.length === 1 ? '' : 's'}`
              : `${reports.length}`,
          summary:
            lastDigestHoursAgo == null
              ? 'Generate the first digest to seed trend analysis.'
              : lastDigestHoursAgo > 7 * 24
                ? 'Weekly digests drift without a fresh run — Monday cron may be paused.'
                : findings.length > 0
                  ? 'Modernization findings are waiting for triage below.'
                  : 'This week\u2019s digest is fresh. Check hotspots and category drift.',
          severity: intelligenceSeverity,
        }}
        act={intelligenceAction}
        verify={{
          label: 'Latest report',
          detail: reports[0]
            ? `${new Date(reports[0].created_at).toLocaleDateString()} · ${reports[0].week_start ?? 'week unknown'}`
            : 'no reports yet',
          to: '/intelligence#reports',
          secondaryTo: activeJob ? '/intelligence#job' : undefined,
          secondaryLabel: activeJob ? 'View active job' : undefined,
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
        howToUse="Reports are generated automatically every Monday by cron. Click Generate to run for the current week — the job runs in the background and the progress card below stays live. If a job is wedged you can cancel it."
      />

      <ThisWeekNarrative
        latest={reports[0] ?? null}
        loading={loading}
        onGenerate={generateNow}
        generating={generating || !!activeJob}
      />

      {activeJob && <ActiveJobCard job={activeJob} onCancel={() => void cancelJob(activeJob.id)} />}

      {!activeJob && <LastFailureNote jobs={recentJobs} />}

      <BenchmarkOptInCard benchmark={benchmark} onToggle={toggleOptIn} />

      <ModernizationFindings
        findings={findings}
        dispatchingId={dispatchingId}
        onDispatch={(id) => void dispatchFinding(id)}
        onDismiss={(id) => void dismissFinding(id)}
      />

      <RecentJobsList jobs={recentJobs} />

      {loading ? (
        <TableSkeleton rows={4} columns={4} showFilters={false} label="Loading intelligence reports" />
      ) : error ? (
        <ErrorAlert message="Failed to load intelligence reports." onRetry={fetchData} />
      ) : reports.length === 0 ? (
        <EmptyState
          title="No intelligence reports yet"
          description="Reports are generated weekly by the cron job. Click Generate above to produce one immediately."
        />
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <IntelligenceReportCard
              key={r.id}
              report={r}
              onDownload={() => void downloadPdf(r.id, r.week_start)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ThisWeekNarrativeProps {
  latest: IntelligenceReport | null
  loading: boolean
  generating: boolean
  onGenerate: () => void
}

// Surface the most-recent generated report as a one-paragraph "this week"
// strip so the Intelligence page leads with insight, not a wall of buttons.
// Falls back to NN/G-shape empty state (status + learning cue + CTA) when
// no report exists yet. .
function ThisWeekNarrative({ latest, loading, generating, onGenerate }: ThisWeekNarrativeProps) {
  if (loading) return null

  if (!latest) {
    return (
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-fg">This week</h3>
          <p className="text-xs text-fg-muted mt-1 max-w-prose">
            No intelligence digest has been generated yet. The cron writes one every Monday,
            but you can fire one immediately to see this week's hotspots, fix velocity, and
            severity drift in narrative form.
          </p>
        </div>
        <div>
          <Btn size="sm" variant="primary" onClick={onGenerate} disabled={generating} loading={generating}>
            Generate this week
          </Btn>
        </div>
      </Card>
    )
  }

  const headline = firstParagraph(latest.summary_md)
  return (
    <Card className="p-5 space-y-4 border-brand/20 bg-brand/5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-brand">Week of {latest.week_start}</h3>
        <span className="text-3xs text-fg-faint font-mono">{latest.llm_model ?? ''}</span>
      </div>
      <p className="text-xs text-fg-secondary leading-relaxed max-w-prose whitespace-pre-line">
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
