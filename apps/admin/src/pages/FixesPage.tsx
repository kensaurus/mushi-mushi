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
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { usePlatformIntegrations } from '../lib/usePlatformIntegrations'
import { pluralize, pluralizeWithCount } from '../lib/format'
import { PageHeader, PageHelp, SegmentedControl, ErrorAlert, FreshnessPill } from '../components/ui'
import { ActiveFiltersRail, type ActiveFilter } from '../components/ActiveFiltersRail'
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
  const [isValidating, setIsValidating] = useState(true)
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null)
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
    setIsValidating(true)
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
      if (!cancelledRef.current) setLastFetchedAt(new Date().toISOString())
    } catch {
      if (!cancelledRef.current) setError(true)
    } finally {
      inFlightRef.current = false
      if (!cancelledRef.current) {
        setLoading(false)
        setIsValidating(false)
      }
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
    return () => {
      cancelledRef.current = true
    }
  }, [loadFixes])

  // Realtime replaces the 5s poll. `fix_attempts` flips when an agent
  // moves through queued → running → succeeded/failed; `fix_events` fires
  // on every downstream GitHub webhook (push, pull_request, check_run).
  // We debounce because a single PR merge commonly emits 3–4 events within
  // the same second — collapsing them into one refresh keeps the list
  // stable for users who are reading while things land.
  const { channelState } = useRealtimeReload(['fix_attempts', 'fix_events', 'fix_dispatch_jobs'], () => {
    if (cancelledRef.current) return
    void loadFixes()
  })

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

  // Publish page context so the AI sidebar and command palette can react
  // to the current bucket + counts (e.g. "Retry all failed fixes" only
  // makes sense when `failedFixes.length > 0`).
  usePublishPageContext({
    route: '/fixes',
    title: projectName ? `Fixes · ${projectName}` : 'Fixes',
    summary: loading
      ? 'Loading fix pipeline…'
      : `${pluralizeWithCount(fixes.length, 'fix', 'fixes')} · ${bucketCounts.inflight} in flight · ${bucketCounts.failed} failed`,
    filters: {
      bucket: statusBucket,
    },
    selection: expanded
      ? { kind: 'fix', id: expanded, label: fixes.find((f) => f.id === expanded)?.report_id ?? expanded.slice(0, 8) }
      : undefined,
    questions: [
      bucketCounts.failed > 0
        ? `Why did the ${pluralizeWithCount(bucketCounts.failed, 'failed fix', 'failed fixes')} fail?`
        : 'Is the auto-fix pipeline healthy right now?',
      bucketCounts.inflight > 0
        ? `What is taking the longest among the ${bucketCounts.inflight} in-flight fixes?`
        : 'Which report should I dispatch next?',
      'Which fixes are waiting on a human review?',
    ],
  })

  // Capped at 12 entries so a freshly-loaded list of 100+ fixes still finishes
  // its entrance animation in well under half a second
  const stagger = useStaggeredAppear({ stepMs: 28, max: 12 })

  // Optimistic-only dispatch rows: inserted synchronously when the user
  // clicks retry so the InflightDispatches panel updates within a frame
  // instead of waiting for the POST + realtime round-trip (typically
  // 300–800ms). Each optimistic row has an `optimistic_` id prefix so
  // `mergeDispatches` below can tell it apart from real ones returned by
  // the server and swap it out once the backend confirms. Failed POSTs
  // also flip the row to status=failed so the user sees why.
  const [optimisticDispatches, setOptimisticDispatches] = useState<DispatchJob[]>([])

  const pushOptimistic = useCallback((reportId: string): string => {
    const id = `optimistic_${reportId}_${Date.now().toString(36)}`
    setOptimisticDispatches((prev) => [
      {
        id,
        project_id: activeProjectId ?? 'unknown',
        report_id: reportId,
        status: 'queued',
        created_at: new Date().toISOString(),
      },
      ...prev,
    ])
    return id
  }, [activeProjectId])

  const settleOptimistic = useCallback((id: string, outcome: 'ok' | 'error', message?: string) => {
    if (outcome === 'ok') {
      // Drop immediately — loadFixes will replace it with the real row.
      setOptimisticDispatches((prev) => prev.filter((d) => d.id !== id))
      return
    }
    setOptimisticDispatches((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, status: 'failed' as const, error: message, finished_at: new Date().toISOString() } : d,
      ),
    )
    // Clear failed optimistic rows after a short grace period so the panel
    // doesn't accumulate stale error rows if the user ignores them.
    setTimeout(() => {
      setOptimisticDispatches((prev) => prev.filter((d) => d.id !== id))
    }, 8000)
  }, [])

  const retryOne = useCallback(
    async (reportId: string) => {
      const optimisticId = pushOptimistic(reportId)
      const res = await apiFetch('/v1/admin/fixes/dispatch', {
        method: 'POST',
        body: JSON.stringify({ reportId }),
      })
      if (res.ok) {
        toast.push({ tone: 'success', message: 'Fix re-dispatched' })
        settleOptimistic(optimisticId, 'ok')
        void loadFixes()
      } else {
        toast.push({ tone: 'error', message: res.error?.message ?? 'Re-dispatch failed' })
        settleOptimistic(optimisticId, 'error', res.error?.message)
      }
    },
    [loadFixes, pushOptimistic, settleOptimistic, toast],
  )

  const retryAllFailed = useCallback(async () => {
    if (failedFixes.length === 0) return
    setRetryingAll(true)
    const optimisticIds = failedFixes.map((f) => ({ reportId: f.report_id, id: pushOptimistic(f.report_id) }))
    const results = await Promise.allSettled(
      optimisticIds.map(({ reportId }) =>
        apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: JSON.stringify({ reportId }),
        }),
      ),
    )
    setRetryingAll(false)
    results.forEach((r, idx) => {
      const { id } = optimisticIds[idx]
      const ok = r.status === 'fulfilled' && (r.value as { ok: boolean }).ok
      const msg = r.status === 'fulfilled' ? (r.value as { error?: { message?: string } }).error?.message : 'Request failed'
      settleOptimistic(id, ok ? 'ok' : 'error', msg)
    })
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length
    const failed = results.length - ok
    if (failed === 0) {
      toast.push({ tone: 'success', message: `Re-dispatched ${ok} failed ${pluralize(ok, 'fix', 'fixes')}` })
    } else {
      toast.push({ tone: 'warning', message: `Re-dispatched ${ok} \u00b7 ${failed} failed` })
    }
    void loadFixes()
  }, [failedFixes, loadFixes, pushOptimistic, settleOptimistic, toast])

  // Merge optimistic rows with server rows — server wins if the same
  // report_id + status appears in both, keeping the list non-duplicative
  // once the real dispatch record lands via realtime.
  const mergedDispatches = useMemo(() => {
    if (optimisticDispatches.length === 0) return dispatches
    const realReportIds = new Set(dispatches.map((d) => d.report_id))
    const keptOptimistic = optimisticDispatches.filter((d) => !realReportIds.has(d.report_id))
    return [...keptOptimistic, ...dispatches]
  }, [dispatches, optimisticDispatches])

  if (loading) return <TableSkeleton rows={6} columns={5} showFilters label="Loading fixes" />
  if (error) return <ErrorAlert message="Failed to load fix attempts." onRetry={loadFixes} />

  return (
    <div className="space-y-3">
      <PageHeader
        title={copy?.title ?? 'Auto-Fix Pipeline'}
        projectScope={projectName}
        description={copy?.description ?? 'Every auto-fix attempt and the PR it produced. Each card is one PDCA loop you can verify end-to-end.'}
      >
        <FreshnessPill at={lastFetchedAt} isValidating={isValidating} channel={channelState} />
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

      <FixRecommendation fixes={fixes} dispatches={mergedDispatches} />

      <InflightDispatches dispatches={mergedDispatches} />

      {fixes.length === 0 ? (
        <SetupNudge
          requires={['github_connected', 'first_report_received', 'byok_anthropic']}
          emptyTitle="No fix attempts yet"
          emptyDescription="Open a classified report and click “Dispatch fix” to start the auto-fix loop. Mushi opens a draft PR you review and merge — nothing ships without you."
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
          {(() => {
            const activeFilters: ActiveFilter[] = statusBucket !== 'all'
              ? [{
                  key: 'status',
                  label: 'Status',
                  value: STATUS_BUCKETS.find((b) => b.id === statusBucket)?.label ?? statusBucket,
                  onClear: () => setStatusBucket('all'),
                  tone: 'info' as const,
                }]
              : []
            return (
              <ActiveFiltersRail
                filters={activeFilters}
                onClearAll={() => setStatusBucket('all')}
                ariaLabel="Active fix filters"
              />
            )
          })()}
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

