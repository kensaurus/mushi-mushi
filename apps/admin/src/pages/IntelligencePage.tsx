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
import { PageHeader, PageHelp, Btn, Loading, ErrorAlert, EmptyState } from '../components/ui'
import { useToast } from '../lib/toast'
import {
  ActiveJobCard,
  LastFailureNote,
  RecentJobsList,
} from '../components/intelligence/IntelligenceJobs'
import { BenchmarkOptInCard } from '../components/intelligence/BenchmarkOptInCard'
import { ModernizationFindings } from '../components/intelligence/ModernizationFindings'
import { IntelligenceReportCard } from '../components/intelligence/IntelligenceReportCard'
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
        <Loading />
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
