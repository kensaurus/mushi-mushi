/**
 * FILE: apps/admin/src/pages/FixesPage.tsx
 * PURPOSE: V5.3 §2.10 + §2.18 — the auto-fix pipeline dashboard.
 *          Page-level orchestration only: data loading, polling, retry-all.
 *          Presentation lives in components/fixes/* so each piece (KPIs,
 *          recommendation banner, in-flight list, per-fix card) can evolve
 *          and be reasoned about in isolation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePlatformIntegrations } from '../lib/usePlatformIntegrations'
import { pluralize, pluralizeWithCount } from '../lib/format'
import { PageHeader, PageHelp, SegmentedControl, ErrorAlert } from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { SetupNudge } from '../components/SetupNudge'
import { HeroFixWrench } from '../components/illustrations/HeroIllustrations'
import { useToast } from '../lib/toast'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import type { FixTimelineEvent } from '../components/FixGitGraph'
import { FixSummaryRow } from '../components/fixes/FixSummaryRow'
import { FixRecommendation } from '../components/fixes/FixRecommendation'
import { InflightDispatches } from '../components/fixes/InflightDispatches'
import { FixCard } from '../components/fixes/FixCard'
import type { FixAttempt, DispatchJob, FixSummary } from '../components/fixes/types'
import { usePageCopy } from '../lib/copy'
import { useStaggeredAppear } from '../lib/useStaggeredAppear'

type StatusBucket = 'all' | 'inflight' | 'pr_open' | 'merged' | 'failed'

const STATUS_BUCKETS: { id: StatusBucket; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'inflight', label: 'In flight' },
  { id: 'pr_open', label: 'PR open' },
  { id: 'merged', label: 'CI passing' },
  { id: 'failed', label: 'Failed' },
]

function bucketize(fix: FixAttempt): StatusBucket {
  const status = fix.status?.toLowerCase()
  if (status === 'queued' || status === 'running') return 'inflight'
  if (status === 'failed') return 'failed'
  const conclusion = fix.check_run_conclusion?.toLowerCase()
  if (conclusion === 'success') return 'merged'
  if (fix.pr_url) return 'pr_open'
  return 'all'
}

interface CodebaseStats {
  codebase_index_enabled: boolean
  indexed_files: number
}

export function FixesPage() {
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/fixes')
  const [fixes, setFixes] = useState<FixAttempt[]>([])
  const [codebaseStats, setCodebaseStats] = useState<CodebaseStats | null>(null)
  const [dispatches, setDispatches] = useState<DispatchJob[]>([])
  const [summary, setSummary] = useState<FixSummary | null>(null)
  const [timelines, setTimelines] = useState<Record<string, FixTimelineEvent[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)
  const [statusBucket, setStatusBucket] = useState<StatusBucket>('all')
  const toast = useToast()
  // Guard refs prevent overlapping polls and post-unmount state writes —
  // both happen often in StrictMode dev because effects mount twice.
  const inFlightRef = useRef(false)
  const cancelledRef = useRef(false)

  const loadFixes = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setError(false)
    try {
      const [fixRes, dispRes, sumRes] = await Promise.all([
        apiFetch<{ fixes: FixAttempt[] }>('/v1/admin/fixes'),
        apiFetch<{ dispatches: DispatchJob[] }>('/v1/admin/fixes/dispatches'),
        apiFetch<FixSummary>('/v1/admin/fixes/summary'),
      ])
      if (cancelledRef.current) return
      if (fixRes.ok && fixRes.data) setFixes(fixRes.data.fixes)
      else setError(true)
      if (dispRes.ok && dispRes.data) setDispatches(dispRes.data.dispatches)
      if (sumRes.ok && sumRes.data) setSummary(sumRes.data)
    } catch {
      if (!cancelledRef.current) setError(true)
    } finally {
      inFlightRef.current = false
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  // Codebase-index state drives the "you'll get stub PRs" banner. Loaded
  // once per project switch; cheap single-row + count read on the backend.
  useEffect(() => {
    if (!activeProjectId) {
      setCodebaseStats(null)
      return
    }
    let cancelled = false
    apiFetch<CodebaseStats>(`/v1/admin/projects/${activeProjectId}/codebase/stats`)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) setCodebaseStats(res.data)
      })
      .catch(() => { /* banner just won't render — not fatal */ })
    return () => { cancelled = true }
  }, [activeProjectId])

  useEffect(() => {
    cancelledRef.current = false
    void loadFixes()
    // Pause polling when the tab is hidden — there's no point burning the
    // free-tier API quota refreshing a page nobody is looking at.
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      void loadFixes()
    }
    const t = setInterval(tick, 5000)
    return () => {
      cancelledRef.current = true
      clearInterval(t)
    }
  }, [loadFixes])

  // Lazily fetch the per-fix PDCA timeline only once a card is expanded.
  // Cached by fix.id so re-opening is instant; refetched if status flips so
  // running fixes get a live update without polling every fix on the page.
  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    apiFetch<{ events: FixTimelineEvent[] }>(`/v1/admin/fixes/${expanded}/timeline`)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) {
          setTimelines((prev) => ({ ...prev, [expanded]: res.data!.events }))
        }
      })
      .catch(() => {
        /* timeline is best-effort; the card still renders without it */
      })
    return () => {
      cancelled = true
    }
  }, [expanded, fixes])

  const platform = usePlatformIntegrations()

  const successRate = useMemo(() => {
    if (!summary) return null
    const finished = summary.completed + summary.failed
    if (finished === 0) return null
    return summary.completed / finished
  }, [summary])

  const failedFixes = useMemo(() => fixes.filter((f) => f.status === 'failed'), [fixes])

  // Pre-bucket every fix once so the segmented filter and the per-bucket
  // counts in the segmented control stay in sync without re-scanning the
  // list per render. closes the missing FixesPage status
  // filter finding.
  const bucketCounts = useMemo(() => {
    const counts: Record<StatusBucket, number> = { all: fixes.length, inflight: 0, pr_open: 0, merged: 0, failed: 0 }
    for (const f of fixes) {
      const b = bucketize(f)
      if (b !== 'all') counts[b] += 1
    }
    return counts
  }, [fixes])

  const visibleFixes = useMemo(() => {
    if (statusBucket === 'all') return fixes
    return fixes.filter((f) => bucketize(f) === statusBucket)
  }, [fixes, statusBucket])

  // Capped at 12 entries so a freshly-loaded list of 100+ fixes still finishes
  // its entrance animation in well under half a second
  const stagger = useStaggeredAppear({ stepMs: 28, max: 12 })

  const retryOne = useCallback(
    async (reportId: string) => {
      const res = await apiFetch('/v1/admin/fixes/dispatch', {
        method: 'POST',
        body: JSON.stringify({ reportId }),
      })
      if (res.ok) {
        toast.push({ tone: 'success', message: 'Fix re-dispatched' })
        void loadFixes()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Re-dispatch failed' })
      }
    },
    [loadFixes, toast],
  )

  const retryAllFailed = useCallback(async () => {
    if (failedFixes.length === 0) return
    setRetryingAll(true)
    const results = await Promise.allSettled(
      failedFixes.map((f) =>
        apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: JSON.stringify({ reportId: f.report_id }),
        }),
      ),
    )
    setRetryingAll(false)
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length
    const failed = results.length - ok
    if (failed === 0) {
      toast.push({ tone: 'success', message: `Re-dispatched ${ok} failed ${pluralize(ok, 'fix', 'fixes')}` })
    } else {
      toast.push({ tone: 'warning', message: `Re-dispatched ${ok} \u00b7 ${failed} failed` })
    }
    void loadFixes()
  }, [failedFixes, loadFixes, toast])

  if (loading) return <TableSkeleton rows={6} columns={5} showFilters label="Loading fixes" />
  if (error) return <ErrorAlert message="Failed to load fix attempts." onRetry={loadFixes} />

  return (
    <div className="space-y-3">
      <PageHeader
        title={copy?.title ?? 'Auto-Fix Pipeline'}
        projectScope={projectName}
        description={copy?.description ?? 'Every auto-fix attempt and the PR it produced. Each card is one PDCA loop you can verify end-to-end.'}
      >
        <span className="text-2xs text-fg-faint font-mono">{pluralizeWithCount(fixes.length, 'attempt')}</span>
        {failedFixes.length > 0 && (
          <button
            type="button"
            onClick={retryAllFailed}
            disabled={retryingAll}
            className="text-xs px-2.5 py-1 rounded-md border border-edge-subtle bg-surface-overlay hover:bg-surface-raised text-fg-secondary disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors"
            title={`Re-dispatch every fix attempt currently in failed state (${pluralizeWithCount(failedFixes.length, 'job')}).`}
          >
            {retryingAll ? 'Retrying\u2026' : `Retry ${failedFixes.length} failed`}
          </button>
        )}
      </PageHeader>

      <PageHelp
        title={copy?.help?.title ?? 'About the Auto-Fix Pipeline'}
        whatIsIt={copy?.help?.whatIsIt ?? 'When a bug report is high-confidence and reproducible, the LLM fix agent uses your BYOK key to draft a fix on a feature branch and open a draft pull request. A human always reviews before merging.'}
        useCases={copy?.help?.useCases ?? [
          'Track the full PDCA loop — Plan (LLM proposal), Do (PR), Check (CI), Act (review)',
          'Audit cost: every attempt logs the model used, token spend, and a Langfuse trace',
          'Spot patterns of failure so prompts and scope rules can be tightened',
        ]}
        howToUse={copy?.help?.howToUse ?? "Dispatch a fix from any classified report. Each card shows the LLM model, token usage, branch, PR, and CI status. Expand a card to read the agent's rationale and see the live branch graph."}
      />

      {codebaseStats && (!codebaseStats.codebase_index_enabled || codebaseStats.indexed_files === 0) && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-muted/30 px-3 py-2 text-2xs text-warn"
          data-testid="fixes-codebase-unindexed-banner"
        >
          <span aria-hidden="true" className="mt-[1px]">⚠</span>
          <div className="flex-1">
            <strong className="font-semibold">Auto-fix will produce stub PRs</strong> —{' '}
            {codebaseStats.codebase_index_enabled
              ? 'your codebase index is empty, so the LLM has nothing to read.'
              : 'codebase indexing is off, so the LLM has nothing to read.'}
            {' '}
            <a href="/integrations" className="underline hover:no-underline">Enable it now →</a>
          </div>
        </div>
      )}

      {summary && <FixSummaryRow summary={summary} successRate={successRate} />}

      <FixRecommendation fixes={fixes} dispatches={dispatches} />

      <InflightDispatches dispatches={dispatches} />

      {fixes.length === 0 ? (
        <SetupNudge
          requires={['github_connected', 'first_report_received', 'byok_anthropic']}
          emptyTitle="No fix attempts yet"
          emptyDescription="Open a classified report and click \u201cDispatch fix\u201d to start the auto-fix loop. Mushi opens a draft PR you review and merge — nothing ships without you."
          emptyIcon={<HeroFixWrench />}
          blockedIcon={<HeroFixWrench accent="text-fg-faint" />}
          emptyHints={[
            'Each dispatch creates one branch + one draft PR per attempt.',
            'The judge scores every attempt before it appears in green here.',
          ]}
        />
      ) : (
        <>
          <SegmentedControl<StatusBucket>
            ariaLabel="Filter fixes by status"
            value={statusBucket}
            options={STATUS_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: bucketCounts[b.id] }))}
            onChange={setStatusBucket}
          />
          {visibleFixes.length === 0 ? (
            <p className="text-2xs text-fg-muted px-2 py-3">
              No fixes in this state right now.{' '}
              <button
                type="button"
                onClick={() => setStatusBucket('all')}
                className="text-brand hover:underline"
              >
                Show all
              </button>
            </p>
          ) : (
            <div className="space-y-1.5">
              {visibleFixes.map((fix, idx) => (
                <div
                  key={fix.id}
                  data-tour-id={idx === 0 ? 'fix-card' : undefined}
                  className="motion-safe:animate-mushi-fade-in"
                  style={stagger(idx)}
                >
                  <FixCard
                    fix={fix}
                    isOpen={expanded === fix.id}
                    timeline={timelines[fix.id]}
                    traceUrl={platform.traceUrl(fix.langfuse_trace_id)}
                    onToggle={() => setExpanded(expanded === fix.id ? null : fix.id)}
                    onRetry={() => retryOne(fix.report_id)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

