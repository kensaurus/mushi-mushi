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
import { PageHeader, PageHelp, Loading, ErrorAlert } from '../components/ui'
import { SetupNudge } from '../components/SetupNudge'
import { useToast } from '../lib/toast'
import type { FixTimelineEvent } from '../components/FixGitGraph'
import { FixSummaryRow } from '../components/fixes/FixSummaryRow'
import { FixRecommendation } from '../components/fixes/FixRecommendation'
import { InflightDispatches } from '../components/fixes/InflightDispatches'
import { FixCard } from '../components/fixes/FixCard'
import type { FixAttempt, DispatchJob, FixSummary } from '../components/fixes/types'

export function FixesPage() {
  const [fixes, setFixes] = useState<FixAttempt[]>([])
  const [dispatches, setDispatches] = useState<DispatchJob[]>([])
  const [summary, setSummary] = useState<FixSummary | null>(null)
  const [timelines, setTimelines] = useState<Record<string, FixTimelineEvent[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)
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
      toast.push({ tone: 'success', message: `Re-dispatched ${ok} failed ${ok === 1 ? 'fix' : 'fixes'}` })
    } else {
      toast.push({ tone: 'warning', message: `Re-dispatched ${ok} \u00b7 ${failed} failed` })
    }
    void loadFixes()
  }, [failedFixes, loadFixes, toast])

  if (loading) return <Loading text="Loading fixes..." />
  if (error) return <ErrorAlert message="Failed to load fix attempts." onRetry={loadFixes} />

  return (
    <div className="space-y-3">
      <PageHeader title="Auto-Fix Pipeline">
        <span className="text-2xs text-fg-faint font-mono">{fixes.length} attempts</span>
        {failedFixes.length > 0 && (
          <button
            type="button"
            onClick={retryAllFailed}
            disabled={retryingAll}
            className="text-xs px-2.5 py-1 rounded-md border border-edge-subtle bg-surface-overlay hover:bg-surface-raised text-fg-secondary disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors"
            title={`Re-dispatch every fix attempt currently in failed state (${failedFixes.length} job${failedFixes.length === 1 ? '' : 's'}).`}
          >
            {retryingAll ? 'Retrying\u2026' : `Retry ${failedFixes.length} failed`}
          </button>
        )}
      </PageHeader>

      <PageHelp
        title="About the Auto-Fix Pipeline"
        whatIsIt="When a bug report is high-confidence and reproducible, the LLM fix agent uses your BYOK key to draft a fix on a feature branch and open a draft pull request. A human always reviews before merging."
        useCases={[
          'Track the full PDCA loop — Plan (LLM proposal), Do (PR), Check (CI), Act (review)',
          'Audit cost: every attempt logs the model used, token spend, and a Langfuse trace',
          'Spot patterns of failure so prompts and scope rules can be tightened',
        ]}
        howToUse="Dispatch a fix from any classified report. Each card shows the LLM model, token usage, branch, PR, and CI status. Expand a card to read the agent's rationale and see the live branch graph."
      />

      {summary && <FixSummaryRow summary={summary} successRate={successRate} />}

      <FixRecommendation fixes={fixes} dispatches={dispatches} />

      <InflightDispatches dispatches={dispatches} />

      {fixes.length === 0 ? (
        <SetupNudge
          requires={['github_connected', 'first_report_received', 'byok_anthropic']}
          emptyTitle="No fix attempts yet"
          emptyDescription="Open a classified report and click \u201cDispatch fix\u201d to start the auto-fix loop."
        />
      ) : (
        <div className="space-y-1.5">
          {fixes.map((fix) => (
            <FixCard
              key={fix.id}
              fix={fix}
              isOpen={expanded === fix.id}
              timeline={timelines[fix.id]}
              traceUrl={platform.traceUrl(fix.langfuse_trace_id)}
              onToggle={() => setExpanded(expanded === fix.id ? null : fix.id)}
              onRetry={() => retryOne(fix.report_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
