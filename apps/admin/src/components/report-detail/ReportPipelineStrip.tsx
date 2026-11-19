/**
 * FILE: apps/admin/src/components/report-detail/ReportPipelineStrip.tsx
 * PURPOSE: Where this report is in the pipeline, as one row of stages
 *          (console, 2026-11-19: "the user sees which stage, how long each
 *          took, the error in plain words, and a button that retries that
 *          stage"):
 *
 *            Pipeline  ✕ Failed at Quick check
 *            ✓ REPORTED  ✕ QUICK CHECK  ○ DIAGNOSIS  ○ FIX  ○ PR  ○ CI  ○ MERGED  ○ LIVE
 *              ▬           ▬▬▬▬ 5 min
 *            ✕ Quick check: The AI key or the internal worker token was refused.  attempt 2/3  [Retry triage]
 *            ▸ Details
 *
 *          Each stage is a glyph + a duration bar (square-root scale against
 *          the longest stage) + the time it took. Only the first failed (or
 *          stuck) stage is called out, with its one plain line, its retry and
 *          the raw, screened text behind Details. While triage runs the strip
 *          reads again every 8 s and tells the page when triage finished, so
 *          the classification shows without a reload.
 *
 * Data: GET /v1/admin/reports/:id/pipeline; retry POST …/pipeline/retry
 *       (lib/reportPipelineTrail.ts). A failed fix retries through the page's
 *       own dispatch (`onRetryDispatch`, with its gate); red CI points at the
 *       fix actions bar at the top (#report-fix-actions).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Btn, Card } from '../ui'
import { StatusMark, StatusPill, STATUS_FILL, STATUS_INK } from '../signal/StatusMark'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import {
  calloutStage,
  durationBarWidths,
  durationWords,
  reportTrailPath,
  retryButtonFor,
  retryReportTriage,
  trailIsTriaging,
  trailVerdict,
  type ReportTrail,
} from '../../lib/reportPipelineTrail'

interface Props {
  reportId: string
  /** The page's dispatch gate (useConfirmedDispatch): a failed fix's Retry goes through it. */
  onRetryDispatch: () => void
  dispatchBlock: { blocked: boolean; reason: string | null }
  /** The fix actions bar is on the page (open PR), so red CI points at it. */
  hasFixActions: boolean
  /** Triage moved past where it was stuck: the page reads the report again. */
  onReportChanged?: () => void
}

const POLL_MS = 8_000

export function ReportPipelineStrip({ reportId, onRetryDispatch, dispatchBlock, hasFixActions, onReportChanged }: Props) {
  const toast = useToast()
  const { data, error, reload } = usePageData<ReportTrail>(reportTrailPath(reportId), { deps: [reportId] })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const triaging = trailIsTriaging(data)
  useEffect(() => {
    if (!triaging) return
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [triaging, reload])

  // When triage stops running, the report itself changed (classified, or failed again).
  const wasTriaging = useRef(false)
  useEffect(() => {
    if (wasTriaging.current && !triaging) onReportChanged?.()
    wasTriaging.current = triaging
  }, [triaging, onReportChanged])

  const widths = useMemo(() => (data ? durationBarWidths(data.stages) : []), [data])

  if (error && !data) {
    return (
      <p className="mb-3 text-2xs text-fg-muted" data-testid="report-pipeline-error">
        The pipeline trail did not load. <button type="button" className="font-medium text-brand hover:underline" onClick={reload}>Retry</button>
      </p>
    )
  }
  if (!data) return null

  const verdict = trailVerdict(data)
  const callout = calloutStage(data)
  const button = callout ? retryButtonFor(callout, { dispatchBlocked: dispatchBlock.blocked, dispatchReason: dispatchBlock.reason, hasFixActions }) : null

  const runTriage = async (stage: 'triage' | 'diagnosis') => {
    setBusy(true)
    setResult(null)
    try {
      const out = await retryReportTriage(reportId, stage)
      setResult({ ok: out.ok, message: out.message })
      ;(out.ok ? toast.success : toast.error)(out.ok ? (out.outcome === 'already' ? 'Already running' : 'Triage is running again') : 'Retry did not start', out.message)
    } finally {
      setBusy(false)
      reload()
    }
  }

  return (
    <Card className="mb-3 p-2.5" id="report-pipeline" data-testid="report-pipeline-strip">
      <div className="mb-1.5 flex flex-wrap items-center gap-2" data-failing={data.failing ?? undefined}>
        <h3 className="text-2xs font-semibold text-fg-secondary">Pipeline</h3>
        <StatusPill status={verdict.status} label={verdict.label} />
      </div>
      <ol className="grid grid-cols-4 gap-x-2 gap-y-2 sm:grid-cols-8" aria-label="Pipeline stages of this report">
        {data.stages.map((s, i) => {
          const dur = durationWords(s.durationMs)
          const open = s.state === 'running' || s.state === 'waiting' || s.state === 'slow'
          return (
            <li
              key={s.id}
              className="min-w-0"
              data-testid={`trail-stage-${s.id}`}
              data-state={s.state}
              title={[s.label, s.startedAt ? `started ${new Date(s.startedAt).toLocaleString()}` : null, s.endedAt ? `ended ${new Date(s.endedAt).toLocaleString()}` : null].filter(Boolean).join(' · ')}
            >
              <span className="flex min-w-0 items-center gap-1">
                <StatusMark status={s.state} size={11} label={`${s.label}: ${s.state}`} />
                <span className={`truncate text-3xs font-bold tracking-wider uppercase ${s.state === 'idle' ? 'text-fg-muted' : STATUS_INK[s.state]}`}>{s.label}</span>
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-sm bg-surface-overlay" aria-hidden="true">
                {widths[i]! > 0 && (
                  <span
                    className={`ci-grow-x block h-full rounded-sm ${s.state === 'running' ? 'st-run-bar ci-stripes' : STATUS_FILL[s.state]}`}
                    style={{ width: `${widths[i]}%` }}
                  />
                )}
              </span>
              <span className={`mt-0.5 block truncate font-mono text-3xs tabular-nums ${dur ? 'font-bold text-fg' : 'text-fg-faint'}`}>
                {dur ? (open ? `${dur} so far` : dur) : '—'}
              </span>
            </li>
          )
        })}
      </ol>

      {callout && (
        <div className={`mt-2 border-l-2 pl-2 ${callout.state === 'failed' ? 'border-st-failed' : 'border-st-slow'}`} data-testid="report-pipeline-callout" data-stage={callout.id}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusMark status={callout.state} />
            <span className={`text-xs font-semibold ${STATUS_INK[callout.state]}`}>{callout.label}:</span>
            <span className="min-w-0 text-xs text-fg">{callout.problem}</span>
            {callout.attempts && callout.attempts.used > 0 && (
              <span className="font-mono text-3xs tabular-nums text-fg-muted">
                attempt {callout.attempts.used}/{callout.attempts.max}
              </span>
            )}
            {button?.kind === 'jump' ? (
              <a href={button.to} className="text-2xs font-semibold text-brand hover:underline" data-testid="report-pipeline-jump">
                {button.label}
              </a>
            ) : button ? (
              <Btn
                size="sm"
                variant="primary"
                loading={busy}
                disabled={!button.enabled || busy}
                onClick={() => (button.kind === 'triage' ? void runTriage(callout.id === 'diagnosis' ? 'diagnosis' : 'triage') : onRetryDispatch())}
                data-testid="report-pipeline-retry"
              >
                {button.label}
              </Btn>
            ) : null}
            {button && 'enabled' in button && !button.enabled && button.why && (
              <span className="text-2xs text-fg-muted" data-testid="report-pipeline-retry-why">
                {button.why}
              </span>
            )}
            {result && (
              <span className={`text-2xs ${result.ok ? 'text-ok-foreground' : 'text-danger-foreground'}`} role="status" data-testid="report-pipeline-result">
                {result.message}
              </span>
            )}
          </div>
          {(callout.detail || data.jobs.length > 0) && (
            <details className="group mt-1" data-testid="report-pipeline-details">
              <summary className="cursor-pointer list-none text-2xs text-fg-secondary hover:text-fg">
                <span className="inline-block transition-transform group-open:rotate-90" aria-hidden="true">▸</span> Details
              </summary>
              {callout.detail && (
                <pre className="mt-1 max-h-40 overflow-auto rounded-sm border border-edge-subtle bg-surface-overlay p-1.5 font-mono text-3xs whitespace-pre-wrap text-fg-secondary wrap-anywhere">
                  {callout.detail}
                </pre>
              )}
              {data.jobs.length > 0 && (
                <ul className="mt-1 space-y-0.5 font-mono text-3xs text-fg-muted">
                  {data.jobs.map((j) => (
                    <li key={j.id} data-testid={`report-pipeline-job-${j.id}`}>
                      {j.stage} · {j.status} · attempts {j.attempts}/{j.maxAttempts} · queued {new Date(j.createdAt).toLocaleString()}
                      {j.completedAt ? ` · ended ${new Date(j.completedAt).toLocaleString()}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </div>
      )}
    </Card>
  )
}
