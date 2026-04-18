/**
 * FILE: apps/admin/src/pages/FixesPage.tsx
 * PURPOSE: V5.3 §2.10 + §2.18 — the auto-fix pipeline dashboard.
 *          Each card surfaces the full PDCA loop in one glance:
 *            - status badge (queued/running/completed/failed)
 *            - LLM model + token usage so cost is never invisible
 *            - Langfuse trace link (one click to inspect prompts + cost)
 *            - GitHub PR link + CI check-run badge
 *            - rationale + files changed for fast review triage
 *            - inline branch-graph timeline (Plan → Do → Check → Act)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePlatformIntegrations } from '../lib/usePlatformIntegrations'
import { PIPELINE_STATUS, pipelineStatusLabel } from '../lib/tokens'
import { PageHeader, PageHelp, Card, Badge, EmptyState, Loading, ErrorAlert, RelativeTime, RecommendedAction } from '../components/ui'
import { KpiRow, KpiTile, BarSparkline, formatTokens, type Tone } from '../components/charts'
import { FixGitGraph, type FixTimelineEvent } from '../components/FixGitGraph'
import { useToast } from '../lib/toast'

interface FixAttempt {
  id: string
  report_id: string
  agent: string
  status: string
  branch?: string
  pr_url?: string
  pr_number?: number
  files_changed?: string[]
  lines_changed?: number
  summary?: string
  rationale?: string
  review_passed?: boolean
  error?: string
  started_at: string
  completed_at?: string
  langfuse_trace_id?: string | null
  llm_model?: string | null
  llm_input_tokens?: number | null
  llm_output_tokens?: number | null
  check_run_status?: string | null
  check_run_conclusion?: string | null
}

interface DispatchJob {
  id: string
  project_id: string
  report_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  pr_url?: string
  error?: string
  created_at: string
  started_at?: string
  finished_at?: string
}

interface FixSummary {
  total: number
  completed: number
  failed: number
  inProgress: number
  prsOpen: number
  prsMerged: number
  days: { day: string; total: number; completed: number; failed: number }[]
}

const DISPATCH_STATUS: Record<DispatchJob['status'], string> = {
  queued: 'bg-surface-overlay text-fg-muted',
  running: 'bg-info-subtle text-info',
  completed: 'bg-ok-subtle text-ok',
  failed: 'bg-danger-subtle text-danger',
  cancelled: 'bg-surface-overlay text-fg-faint',
}

const DISPATCH_STATUS_LABEL: Record<DispatchJob['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const CHECK_RUN_TONE: Record<string, string> = {
  success: 'bg-ok-subtle text-ok',
  failure: 'bg-danger-subtle text-danger',
  cancelled: 'bg-surface-overlay text-fg-muted',
  timed_out: 'bg-warning-subtle text-warning',
  action_required: 'bg-warning-subtle text-warning',
  neutral: 'bg-surface-overlay text-fg-muted',
  in_progress: 'bg-info-subtle text-info',
  queued: 'bg-info-subtle text-info',
  pending: 'bg-info-subtle text-info',
}

function ciBadge(fix: FixAttempt): { label: string; className: string } | null {
  // Surface what we actually know. The webhook syncs check_run_status +
  // check_run_conclusion; until then we leave the slot empty rather than
  // faking a "passed" we can't prove.
  const conclusion = fix.check_run_conclusion?.toLowerCase()
  const status = fix.check_run_status?.toLowerCase()
  if (conclusion) {
    return { label: `CI: ${conclusion}`, className: CHECK_RUN_TONE[conclusion] ?? 'bg-surface-overlay text-fg-muted' }
  }
  if (status) {
    return { label: `CI: ${status.replace(/_/g, ' ')}`, className: CHECK_RUN_TONE[status] ?? 'bg-surface-overlay text-fg-muted' }
  }
  return null
}

export function FixesPage() {
  const [fixes, setFixes] = useState<FixAttempt[]>([])
  const [dispatches, setDispatches] = useState<DispatchJob[]>([])
  const [summary, setSummary] = useState<FixSummary | null>(null)
  const [timelines, setTimelines] = useState<Record<string, FixTimelineEvent[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
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

  const sparkValues = useMemo(
    () => summary?.days.map((d) => d.total) ?? [],
    [summary],
  )

  const successRate = useMemo(() => {
    if (!summary) return null
    const finished = summary.completed + summary.failed
    if (finished === 0) return null
    return summary.completed / finished
  }, [summary])

  if (loading) return <Loading text="Loading fixes..." />
  if (error) return <ErrorAlert message="Failed to load fix attempts." onRetry={loadFixes} />

  return (
    <div className="space-y-3">
      <PageHeader title="Auto-Fix Pipeline">
        <span className="text-2xs text-fg-faint font-mono">{fixes.length} attempts</span>
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

      {summary && (
        <KpiRow cols={5}>
          <KpiTile
            label="Attempts (30d)"
            value={summary.total}
            sublabel="dispatched in last 30 days"
          />
          <KpiTile
            label="Completed"
            value={summary.completed}
            accent={summary.completed > 0 ? 'ok' : 'muted'}
            sublabel={successRate != null ? `${(successRate * 100).toFixed(0)}% success` : 'no finished runs'}
          />
          <KpiTile
            label="Failed"
            value={summary.failed}
            accent={summary.failed > 0 ? 'danger' : 'muted'}
            sublabel="needs prompt or scope tuning"
          />
          <KpiTile
            label="In flight"
            value={summary.inProgress}
            accent={summary.inProgress > 0 ? 'info' : 'muted'}
            sublabel="queued or running"
          />
          <KpiTile
            label="PRs open"
            value={summary.prsOpen}
            accent={(summary.prsOpen > 0 ? 'brand' : 'muted') as Tone}
            sublabel={`${summary.prsMerged} CI ✓`}
          />
        </KpiRow>
      )}

      {summary && sparkValues.some((v) => v > 0) && (
        <Card elevated className="p-3">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-2xs uppercase tracking-wider text-fg-muted">
              Daily fix volume · last 30d
            </h3>
            <span className="text-2xs font-mono text-fg-faint">
              {summary.days[0]?.day} → {summary.days[summary.days.length - 1]?.day}
            </span>
          </div>
          <BarSparkline values={sparkValues} accent="bg-brand/70" height={36} />
        </Card>
      )}

      {(() => {
        const inFlight = dispatches.filter((d) => d.status === 'queued' || d.status === 'running').length
        const recentFailed = fixes.filter((f) => f.status === 'failed').length
        const openPRs = fixes.filter((f) => f.pr_url && f.status === 'completed').length
        if (inFlight > 0) {
          return (
            <RecommendedAction
              tone="info"
              title={`${inFlight} fix ${inFlight === 1 ? 'job is' : 'jobs are'} running`}
              description="The LLM agent is generating a structured patch and opening a draft PR. Cards refresh every 5s — no action needed."
            />
          )
        }
        if (recentFailed >= 3) {
          return (
            <RecommendedAction
              tone="urgent"
              title={`${recentFailed} recent fix attempts failed`}
              description="A pattern of failures usually means a brittle agent prompt, missing GitHub credentials, or an unsupported bug category. Open the failed cards and click Langfuse to see the raw LLM output."
            />
          )
        }
        if (openPRs > 0) {
          const firstPr = fixes.find((f) => f.pr_url && f.status === 'completed')
          return (
            <RecommendedAction
              tone="success"
              title={`${openPRs} ${openPRs === 1 ? 'PR is' : 'PRs are'} ready for review`}
              description="Auto-fix completed and pushed a draft branch. Read the rationale + diff before marking the PR ready — the agent flags low-confidence fixes for extra scrutiny."
              cta={firstPr?.pr_url ? { label: 'Open latest PR', href: firstPr.pr_url } : undefined}
            />
          )
        }
        return null
      })()}

      {dispatches.filter(d => d.status === 'queued' || d.status === 'running').length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">In-flight dispatches</h3>
          {dispatches.filter(d => d.status === 'queued' || d.status === 'running').map(d => (
            <Card key={d.id} className="p-3 space-y-1">
              <div className="flex justify-between items-center">
                <Badge className={DISPATCH_STATUS[d.status]}>{DISPATCH_STATUS_LABEL[d.status]}</Badge>
                <Link
                  to={`/reports/${d.report_id}`}
                  className="text-2xs font-mono text-fg-muted hover:text-fg-secondary"
                >
                  Report {d.report_id.slice(0, 8)}…
                </Link>
              </div>
              <p className="text-2xs text-fg-muted">
                Queued <RelativeTime value={d.created_at} />
                {d.started_at && <> · started <RelativeTime value={d.started_at} /></>}
              </p>
            </Card>
          ))}
        </div>
      )}

      {fixes.length === 0 ? (
        <EmptyState
          title="No fix attempts yet"
          description="Fix attempts appear here when an admin dispatches a fix from a classified report. Configure your LLM key in Settings → LLM Keys first."
        />
      ) : (
        <div className="space-y-1.5">
          {fixes.map(fix => {
            const traceUrl = platform.traceUrl(fix.langfuse_trace_id)
            const ci = ciBadge(fix)
            const isOpen = expanded === fix.id
            const totalTokens = (fix.llm_input_tokens ?? 0) + (fix.llm_output_tokens ?? 0)
            const timeline = timelines[fix.id]
            return (
              <Card key={fix.id} className="p-3 space-y-1.5">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={PIPELINE_STATUS[fix.status] ?? 'bg-surface-overlay text-fg-muted'}>
                      {pipelineStatusLabel(fix.status)}
                    </Badge>
                    <span className="text-2xs text-fg-muted">via {fix.agent}</span>
                    {fix.llm_model && (
                      <span className="text-2xs font-mono text-fg-faint" title="LLM model used">
                        {fix.llm_model}
                      </span>
                    )}
                    {ci && <Badge className={ci.className}>{ci.label}</Badge>}
                    {fix.review_passed === false && (
                      <Badge className="bg-warning-subtle text-warning" title="The agent flagged this for extra human review.">
                        Needs review
                      </Badge>
                    )}
                  </div>
                  <span className="text-2xs text-fg-muted tabular-nums">
                    <RelativeTime value={fix.started_at} />
                  </span>
                </div>

                {fix.summary && <p className="text-xs text-fg-secondary">{fix.summary}</p>}

                <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted font-mono">
                  <Link to={`/reports/${fix.report_id}`} className="hover:text-fg-secondary underline-offset-2 hover:underline">
                    Report: {fix.report_id.slice(0, 8)}…
                  </Link>
                  {fix.branch && <span title={fix.branch}>Branch: {fix.branch.length > 32 ? `${fix.branch.slice(0, 32)}…` : fix.branch}</span>}
                  {fix.lines_changed != null && <span>{fix.lines_changed} lines</span>}
                  {fix.files_changed && <span>{fix.files_changed.length} files</span>}
                  {totalTokens > 0 && (
                    <span title={`Input: ${fix.llm_input_tokens} · Output: ${fix.llm_output_tokens}`}>
                      {formatTokens(totalTokens)} tok
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {fix.pr_url && (
                    <a
                      href={fix.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:text-accent-hover underline"
                    >
                      View PR{fix.pr_number ? ` #${fix.pr_number}` : ''}
                    </a>
                  )}
                  {traceUrl && (
                    <a
                      href={traceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fg-muted hover:text-accent underline-offset-2 hover:underline"
                      title="Inspect this fix's LLM call in Langfuse — prompts, output, token cost"
                    >
                      Langfuse trace
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : fix.id)}
                    className="text-fg-muted hover:text-fg-primary underline-offset-2 hover:underline"
                  >
                    {isOpen ? 'Hide details' : 'Show details'}
                  </button>
                  {fix.status === 'failed' && (
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await apiFetch('/v1/admin/fixes/dispatch', {
                          method: 'POST',
                          body: JSON.stringify({ reportId: fix.report_id }),
                        })
                        if (res.ok) {
                          toast.push({ tone: 'success', message: 'Fix re-dispatched' })
                          loadFixes()
                        } else {
                          toast.push({ tone: 'error', message: res.error?.message ?? 'Re-dispatch failed' })
                        }
                      }}
                      className="text-warn hover:text-warn underline-offset-2 hover:underline"
                    >
                      Retry
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-1 pt-2 border-t border-border space-y-2">
                    {timeline ? (
                      <div>
                        <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-1">PDCA timeline</h4>
                        <FixGitGraph
                          events={timeline}
                          prUrl={fix.pr_url}
                          branchName={fix.branch}
                        />
                      </div>
                    ) : (
                      <p className="text-2xs text-fg-faint">Loading timeline…</p>
                    )}
                    {fix.rationale && (
                      <div>
                        <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-0.5">Rationale</h4>
                        <p className="text-xs text-fg-secondary whitespace-pre-wrap">{fix.rationale}</p>
                      </div>
                    )}
                    {fix.files_changed && fix.files_changed.length > 0 && (
                      <div>
                        <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-0.5">Files changed</h4>
                        <ul className="text-2xs font-mono text-fg-muted space-y-0.5">
                          {fix.files_changed.map(f => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {fix.error && (
                  <div className="rounded bg-danger-subtle/40 px-2 py-1.5 text-2xs text-danger">
                    <span className="font-mono uppercase tracking-wide">Error · </span>
                    <span className="font-mono">{fix.error}</span>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
