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
import { Card, Skeleton } from './ui'
import { ActionPill, ActionPillRow, ContainedBlock } from './report-detail/ReportSurface'
import type { DispatchState } from '../lib/dispatchFix'
import { CHIP_TONE } from '../lib/chipTone'

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
  queueing: CHIP_TONE.infoSubtle,
  queued: CHIP_TONE.infoSubtle,
  running: `${CHIP_TONE.infoSubtle} animate-pulse`,
  completed: CHIP_TONE.okSubtle,
  failed: CHIP_TONE.dangerSubtle,
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
    <Card  className="px-3 py-2.5 mb-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${STAGE_TONE[stage] ?? STAGE_TONE.idle}`}>
            {STAGE_LABEL[stage] ?? stage}
          </span>
          <abbr
            title="PDCA — Plan · Do · Check · Act. The four-stage loop each autofix follows from planning through review."
            className="text-2xs text-fg-faint uppercase tracking-wide underline decoration-dotted decoration-fg-faint/50 underline-offset-2 cursor-help"
          >
            PDCA loop
          </abbr>
        </div>
        <div className="flex items-center gap-3 text-2xs">
          {latest?.llm_model && <span className="font-mono text-fg-faint">{latest.llm_model}</span>}
          {tokenStr && <span className="text-fg-faint">{tokenStr}</span>}
        </div>
      </div>

      {dispatchState.error && (
        <ContainedBlock tone="warn" label="Dispatch error">
          <p className="text-2xs text-danger wrap-break-word text-pretty">{dispatchState.error}</p>
        </ContainedBlock>
      )}

      {isInFlight && (
        <ContainedBlock tone="info">
          <p className="text-xs text-fg-secondary leading-relaxed">
            The fix-worker is generating a structured patch with your BYOK key. Status updates stream in live; you can close this page without losing progress — the work continues server-side.
          </p>
        </ContainedBlock>
      )}

      {latest?.summary && stage !== 'queueing' && (
        <ContainedBlock label="Proposed fix" tone="neutral" className="mt-1.5">
          <p className="text-xs leading-relaxed text-fg-secondary text-pretty">{latest.summary}</p>
        </ContainedBlock>
      )}

      {latest?.rationale && (stage === 'completed' || latest.status === 'completed' || latest.status === 'failed') && (
        <details className="mt-1.5 rounded-md border border-edge-subtle/60 bg-surface-overlay/20 px-2.5 py-2 text-xs text-fg-muted">
          <summary className="cursor-pointer text-3xs font-medium uppercase tracking-wider text-fg-faint hover:text-fg-secondary">
            Agent rationale
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap text-fg-secondary leading-relaxed">{latest.rationale}</p>
        </details>
      )}

      {latest?.files_changed && latest.files_changed.length > 0 && (
        <div className="mt-1.5">
          <div className="mb-1 text-3xs font-medium uppercase tracking-wider text-fg-faint">Files touched</div>
          <div className="flex flex-wrap gap-1">
            {latest.files_changed.slice(0, 6).map((file) => (
              <code
                key={file}
                className="inline-flex max-w-full truncate rounded-sm border border-edge-subtle bg-surface-overlay/45 px-1.5 py-0.5 font-mono text-3xs text-fg-secondary"
                title={file}
              >
                {file}
              </code>
            ))}
            {latest.files_changed.length > 6 && (
              <span className="inline-flex items-center rounded-sm border border-edge-subtle bg-surface-overlay/30 px-1.5 py-0.5 text-3xs text-fg-faint">
                +{latest.files_changed.length - 6} more
              </span>
            )}
            {latest.lines_changed != null && (
              <span className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-3xs font-mono tabular-nums bg-brand/12 text-brand border border-brand/28">
                {latest.lines_changed} lines
              </span>
            )}
          </div>
        </div>
      )}

      <ActionPillRow className="mt-2">
        {(dispatchState.prUrl ?? latest?.pr_url) && (
          <ActionPill href={dispatchState.prUrl ?? latest?.pr_url} tone="brand">
            View PR{latest?.pr_number ? ` #${latest.pr_number}` : ''} ↗
          </ActionPill>
        )}
        {traceUrl && (
          <ActionPill href={traceUrl} tone="neutral">
            Langfuse trace ↗
          </ActionPill>
        )}
        {latest?.check_run_conclusion && (
          <ActionPill tone={latest.check_run_conclusion === 'success' ? 'ok' : 'danger'}>
            CI: {latest.check_run_conclusion}
          </ActionPill>
        )}
        {latest?.review_passed === false && (
          <ActionPill tone="warn">Extra review flagged</ActionPill>
        )}
      </ActionPillRow>

      {latest?.error && stage !== 'failed' && (
        <ContainedBlock tone="warn" label="Attempt error" className="mt-1.5">
          <p className="font-mono text-2xs text-danger">{latest.error}</p>
        </ContainedBlock>
      )}
    </Card>
  )
}
