/**
 * FILE: apps/admin/src/components/FixProgressStream.tsx
 * PURPOSE: V5.3 §2.10 — visualize the live PDCA loop on a single report.
 *          Shows the agent's progress (queued → running → completed) with
 *          PR + Langfuse + CI links the moment the worker writes them.
 *          Also pulls the latest fix_attempts row so historic attempts and
 *          the rationale are visible alongside in-flight progress.
 */

import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePlatformIntegrations } from '../lib/usePlatformIntegrations'
import { Skeleton } from './ui'
import type { DispatchState } from '../lib/dispatchFix'

interface FixAttempt {
  id: string
  status: string
  agent: string
  branch?: string
  pr_url?: string
  pr_number?: number
  rationale?: string
  summary?: string
  files_changed?: string[]
  lines_changed?: number
  llm_model?: string | null
  llm_input_tokens?: number | null
  llm_output_tokens?: number | null
  langfuse_trace_id?: string | null
  check_run_status?: string | null
  check_run_conclusion?: string | null
  review_passed?: boolean
  error?: string
  started_at: string
  completed_at?: string
}

const STAGE_LABEL: Record<string, string> = {
  idle: 'Not started',
  queueing: 'Queueing',
  queued: 'Queued',
  running: 'Agent running',
  completed: 'Completed',
  failed: 'Failed',
}

const STAGE_TONE: Record<string, string> = {
  idle: 'bg-surface-overlay text-fg-muted',
  queueing: 'bg-info-subtle text-info',
  queued: 'bg-info-subtle text-info',
  running: 'bg-info-subtle text-info animate-pulse',
  completed: 'bg-ok-subtle text-ok',
  failed: 'bg-danger-subtle text-danger',
}

function totalTokens(a: FixAttempt | null): string | null {
  if (!a) return null
  const t = (a.llm_input_tokens ?? 0) + (a.llm_output_tokens ?? 0)
  if (t === 0) return null
  if (t >= 1_000) return `${(t / 1_000).toFixed(1)}k tokens`
  return `${t} tokens`
}

interface Props {
  reportId: string
  dispatchState: DispatchState
}

export function FixProgressStream({ reportId, dispatchState }: Props) {
  const [latest, setLatest] = useState<FixAttempt | null>(null)
  const [loading, setLoading] = useState(true)
  const platform = usePlatformIntegrations()

  // Hydrate the fix_attempts row for this report whenever the live SSE
  // dispatch stream advances. The dispatch SSE (consumed by useDispatchFix)
  // already pushes status updates in real time — so we only need to reload
  // the rich attempt metadata (rationale, files changed, tokens) on each
  // status transition, plus once on mount for any historic attempt. This
  // replaces the previous 5s poll, which kept hammering /v1/admin/fixes for
  // every visitor to a report page even when nothing was happening.
  const dispatchStatus = dispatchState.status
  useEffect(() => {
    let cancelled = false
    const fetchLatest = async () => {
      const res = await apiFetch<{ fixes: FixAttempt[] }>('/v1/admin/fixes')
      if (cancelled) return
      if (res.ok && res.data) {
        const mine = res.data.fixes.find(f => (f as FixAttempt & { report_id: string }).report_id === reportId)
        setLatest(mine ?? null)
      }
      setLoading(false)
    }
    void fetchLatest()
    return () => { cancelled = true }
  }, [reportId, dispatchStatus])

  const stage = dispatchState.status
  // while we fetch the historic attempt, show a layout-shaped
  // placeholder *only* if the live dispatch is in flight — the UI then
  // visibly reserves the row instead of silently popping in once the
  // network round-trip completes. Pre-dispatch reports stay clean.
  const isInFlightStage = stage === 'queueing' || stage === 'queued' || stage === 'running'
  if (loading) {
    if (!isInFlightStage) return null
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading fix progress"
        className="rounded-md border border-edge-subtle bg-surface-raised/40 px-3 py-2.5 mb-3 space-y-2"
      >
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20 rounded" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    )
  }
  if (stage === 'idle' && !latest) return null

  const traceUrl = platform.traceUrl(latest?.langfuse_trace_id)
  const isInFlight = isInFlightStage
  const tokenStr = totalTokens(latest)

  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised/40 px-3 py-2.5 mb-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${STAGE_TONE[stage] ?? STAGE_TONE.idle}`}>
            {STAGE_LABEL[stage] ?? stage}
          </span>
          <span className="text-2xs text-fg-faint uppercase tracking-wide">PDCA loop</span>
        </div>
        <div className="flex items-center gap-3 text-2xs">
          {latest?.llm_model && <span className="font-mono text-fg-faint">{latest.llm_model}</span>}
          {tokenStr && <span className="text-fg-faint">{tokenStr}</span>}
        </div>
      </div>

      {dispatchState.error && (
        <p className="text-2xs text-danger break-words">{dispatchState.error}</p>
      )}

      {isInFlight && (
        <p className="text-xs text-fg-secondary">
          The fix-worker is generating a structured patch with your BYOK key. Status updates stream in live; you can close this page without losing progress — the work continues server-side.
        </p>
      )}

      {latest?.summary && stage !== 'queueing' && (
        <p className="text-xs text-fg-secondary mt-1.5"><span className="font-medium">Proposed:</span> {latest.summary}</p>
      )}

      {latest?.rationale && (stage === 'completed' || latest.status === 'completed' || latest.status === 'failed') && (
        <details className="mt-1.5 text-xs text-fg-muted">
          <summary className="cursor-pointer hover:text-fg-secondary">Agent rationale</summary>
          <p className="mt-1 whitespace-pre-wrap text-fg-secondary">{latest.rationale}</p>
        </details>
      )}

      {latest?.files_changed && latest.files_changed.length > 0 && (
        <div className="mt-1.5 text-2xs text-fg-muted">
          <span className="text-fg-faint">Files:</span>{' '}
          <span className="font-mono">
            {latest.files_changed.slice(0, 3).join(', ')}
            {latest.files_changed.length > 3 && ` +${latest.files_changed.length - 3} more`}
          </span>
          {latest.lines_changed != null && <span className="text-fg-faint"> · {latest.lines_changed} lines</span>}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
        {(dispatchState.prUrl ?? latest?.pr_url) && (
          <a
            href={dispatchState.prUrl ?? latest?.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover underline"
          >
            View PR{latest?.pr_number ? ` #${latest.pr_number}` : ''}
          </a>
        )}
        {traceUrl && (
          <a
            href={traceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-muted hover:text-accent underline-offset-2 hover:underline"
            title="Inspect this fix's LLM call in Langfuse"
          >
            Langfuse trace
          </a>
        )}
        {latest?.check_run_conclusion && (
          <span className={`text-2xs font-mono ${latest.check_run_conclusion === 'success' ? 'text-ok' : 'text-danger'}`}>
            CI: {latest.check_run_conclusion}
          </span>
        )}
        {latest?.review_passed === false && (
          <span className="text-2xs text-warning">⚠ Agent flagged for extra review</span>
        )}
      </div>

      {latest?.error && stage !== 'failed' && (
        <p className="text-2xs text-danger mt-1 font-mono">{latest.error}</p>
      )}
    </div>
  )
}
